/**
 * KoW Tracker - Deep Module: Notification & Alerting Engine
 *
 * Encapsulates notification dispatching, template management,
 * scheduled morning event briefings, 4-day stale warehouse sweeps,
 * cooldowns, and smart silence alert routing.
 * Zero external dependencies.
 */

function createNotificationEngine({
  db,
  logic,
  telegram,
  getAppBaseUrl
} = {}) {
  if (!db) throw new Error('db is required for NotificationEngine');
  if (!logic) throw new Error('logic is required for NotificationEngine');

  const tg = telegram || require('./telegram.js');
  const resolveBaseUrl = getAppBaseUrl || (() => {
    const s = db.getAppSetting('app_base_url');
    return s ? s.replace(/\/+$/, '') : (process.env.APP_BASE_URL || 'http://localhost:3000');
  });

  async function dispatchNotification(eventKey, data = {}, options = {}) {
    try {
      const template = db.getNotificationTemplate(eventKey);
      if (!template) {
        console.warn(`[Notification] Template "${eventKey}" not found`);
        return { sent: false, reason: 'template_not_found' };
      }

      const token = db.getAppSetting('telegram_bot_token');
      if (!token) {
        return { sent: false, reason: 'no_bot_token' };
      }

      const renderedText = logic.renderTemplate(template.template, data);
      const parseMode = template.parse_mode || 'HTML';
      let replyMarkup = options.replyMarkup || undefined;
      if (!replyMarkup && eventKey === 'event_registration_opened' && data.eventId) {
        replyMarkup = logic.formatEventRegistrationKeyboard(data.eventId);
      }

      const mieruSettings = db.getMieruSettings ? db.getMieruSettings() : { enabled: false };
      const proxyUrl = options.proxyUrl || (mieruSettings.enabled ? `socks5://127.0.0.1:${mieruSettings.socks5Port || 1080}` : undefined);
      const sendOpts = proxyUrl ? { proxyUrl } : {};

      if (template.channel === 'staff') {
        let staffChatId = db.getAppSetting('telegram_staff_chat_id');
        if (!staffChatId) {
          return { sent: false, reason: 'no_staff_chat_id' };
        }
        if (staffChatId && !isNaN(Number(staffChatId))) {
          staffChatId = Number(staffChatId);
        }
        const res = await tg.sendTelegramMessage({
          token,
          chatId: staffChatId,
          text: renderedText,
          parseMode,
          replyMarkup
        }, sendOpts);
        return { sent: res.ok, result: res };
      }

      if (template.channel === 'personal') {
        if (options.userId) {
          const user = db.findUserById(options.userId);
          if (!user) {
            return { sent: false, reason: 'user_not_found' };
          }
          const userChatId = user.telegramChatId || user.telegram_chat_id;
          const userEnabled = (user.telegramNotificationsEnabled !== false) && (user.telegram_notifications_enabled !== 0);
          if (!userChatId || !userEnabled) {
            return { sent: false, reason: 'notifications_disabled_or_no_chat' };
          }
          const res = await tg.sendTelegramMessage({
            token,
            chatId: userChatId,
            text: renderedText,
            parseMode,
            replyMarkup
          }, sendOpts);
          return { sent: res.ok, result: res };
        }

        if (options.broadcast) {
          const users = db.getUsers ? db.getUsers() : [];
          const targets = users.filter(u => {
            const chatId = u.telegramChatId || u.telegram_chat_id;
            const enabled = (u.telegramNotificationsEnabled !== false) && (u.telegram_notifications_enabled !== 0);
            return u.is_approved !== 0 && chatId && enabled;
          });
          let sentCount = 0;
          for (const u of targets) {
            const chatId = u.telegramChatId || u.telegram_chat_id;
            const res = await tg.sendTelegramMessage({
              token,
              chatId,
              text: renderedText,
              parseMode,
              replyMarkup
            }, sendOpts);
            if (res.ok) sentCount++;
          }
          return { sent: true, sentCount, totalTargets: targets.length };
        }

        const directChatId = options.chatId || options.recipientChatId;
        if (directChatId) {
          const res = await tg.sendTelegramMessage({
            token,
            chatId: directChatId,
            text: renderedText,
            parseMode,
            replyMarkup
          }, sendOpts);
          return { sent: res.ok, result: res };
        }

        return { sent: false, reason: 'no_target_specified' };
      }

      return { sent: false, reason: 'unknown_channel' };
    } catch (err) {
      console.warn(`[Notification] Error dispatching "${eventKey}":`, err.message);
      return { sent: false, error: err.message };
    }
  }

  async function checkStaleStockReminders(req = null, options = {}) {
    try {
      const isScheduled = Boolean(options.isScheduled);
      const force = Boolean(options.force || !isScheduled);
      const forcePersonal = Boolean(options.forcePersonal);

      const schedule = db.getStaleAlertSchedule ? db.getStaleAlertSchedule() : {};
      const cooldownDays = schedule.personalCooldownDays !== undefined ? schedule.personalCooldownDays : 7;

      const players = db.getPlayers ? db.getPlayers() : [];
      const totalSectors = players.length;
      let freshCount = 0;
      let warningCount = 0;
      let staleCount = 0;
      let personalRemindersSent = 0;

      const baseUrl = resolveBaseUrl(req);
      const now = new Date();

      const staleSectors = [];

      for (const player of players) {
        const freshness = logic.getStockFreshness(player.stockUpdatedAt, now);
        if (freshness.status === 'fresh') {
          freshCount++;
        } else if (freshness.status === 'warning') {
          warningCount++;
        } else if (freshness.status === 'stale') {
          staleCount++;
          staleSectors.push({ player, freshness });
        }
      }

      // 1. Personal reminders to owners of stale sectors
      if (cooldownDays > 0 || forcePersonal) {
        for (const { player, freshness } of staleSectors) {
          if (player.userId) {
            if (!forcePersonal && player.lastStockReminderSentAt) {
              const lastSentTime = new Date(player.lastStockReminderSentAt).getTime();
              if (!isNaN(lastSentTime)) {
                const daysSince = (now.getTime() - lastSentTime) / (24 * 60 * 60 * 1000);
                if (daysSince < cooldownDays) {
                  continue; // Suppressed by cooldown
                }
              }
            }

            const user = db.findUserById(player.userId);
            const userChatId = user ? (user.telegramChatId || user.telegram_chat_id) : null;
            const userEnabled = user ? ((user.telegramNotificationsEnabled !== false) && (user.telegram_notifications_enabled !== 0)) : false;
            if (user && userChatId && userEnabled) {
              const res = await dispatchNotification('stock_reminder_personal', {
                username: user.username,
                sectorName: player.name || 'Сектор',
                daysOverdue: String(freshness.days ?? '14+'),
                link: `${baseUrl}/#cabinet`
              }, { userId: user.id, chatId: userChatId }).catch(err => {
                console.warn(`[Reminders] Error sending reminder to user ${user.id}:`, err.message);
                return { sent: false };
              });
              if (res && res.sent) {
                personalRemindersSent++;
                if (db.updatePlayerStockReminderTime) {
                  db.updatePlayerStockReminderTime(player.id, now.toISOString());
                }
              }
            }
          }
        }
      }

      // 2. Staff alert summary
      let staffAlertSent = false;
      const shouldSkipStaffDueToSilence = isScheduled && schedule.smartSilence && staleCount === 0 && !force;

      if (!shouldSkipStaffDueToSilence) {
        const staffRes = await dispatchNotification('staff_stale_stocks_alert', {
          totalSectors: String(totalSectors),
          freshCount: String(freshCount),
          warningCount: String(warningCount),
          staleCount: String(staleCount),
          link: `${baseUrl}/#sectors`
        }).catch(err => {
          console.warn('[Reminders] Error sending staff_stale_stocks_alert:', err.message);
          return { sent: false };
        });
        if (staffRes && staffRes.sent) {
          staffAlertSent = true;
        }
      } else {
        console.log('[Reminders] Smart silence active: 0 stale sectors, staff alert skipped');
      }

      const result = {
        totalSectors,
        freshCount,
        warningCount,
        staleCount,
        personalRemindersSent,
        staffAlertSent,
        silent: shouldSkipStaffDueToSilence
      };

      if (db.recordStaleAlertRun) {
        db.recordStaleAlertRun({ lastRunAt: now.toISOString(), status: result });
      }

      return result;
    } catch (err) {
      console.warn('[Reminders] Error in checkStaleStockReminders:', err.message);
      return {
        totalSectors: 0,
        freshCount: 0,
        warningCount: 0,
        staleCount: 0,
        personalRemindersSent: 0,
        staffAlertSent: false,
        silent: false,
        error: err.message
      };
    }
  }

  async function checkScheduledStaleStockReminders() {
    try {
      const schedule = db.getStaleAlertSchedule ? db.getStaleAlertSchedule() : null;
      if (!schedule || schedule.frequency === 'disabled') return;

      const now = new Date();
      const shouldRun = logic.shouldRunStaleStockAlert({
        frequency: schedule.frequency,
        time: schedule.time,
        lastRunAt: schedule.lastRunAt,
        now,
        timezoneOffset: schedule.timezoneOffset || 3
      });

      if (shouldRun) {
        console.log(`[Reminders] Triggering scheduled stale stock check (${schedule.frequency} at ${schedule.time})`);
        await checkStaleStockReminders(null, { isScheduled: true });
      }
    } catch (err) {
      console.error('[Reminders] Error in checkScheduledStaleStockReminders:', err);
    }
  }

  async function checkScheduledEventMorningReminders(req = null, options = {}) {
    try {
      const events = db.getEvents ? db.getEvents() : [];
      if (!events || !events.length) {
        return { eventsChecked: 0, remindersSent: 0 };
      }

      const eventTypes = db.getEventTypes ? db.getEventTypes() : [];
      const now = options.now ? new Date(options.now) : new Date();
      const baseUrl = resolveBaseUrl(req);
      let sentCount = 0;

      const nowTime = now.getTime();
      for (const ev of events) {
        const assignments = ev.assignments || [];
        if (!assignments.length) continue;

        if (!options.force && ev.dateFrom) {
          const evTime = new Date(ev.dateFrom).getTime();
          if (!isNaN(evTime) && Math.abs(evTime - nowTime) > 36 * 3600 * 1000) {
            continue;
          }
        }

        const et = eventTypes.find(t => t.id === ev.typeId);
        const effectivePlaces = et ? (typeof logic.resolveEventPlaces === 'function' ? logic.resolveEventPlaces(et, ev.dateFrom) : et.places) : [];

        for (const a of assignments) {
          if (!a.playerId || !a.place) continue;
          const player = db.getPlayerById(a.playerId);
          if (!player || !player.userId) continue;

          const user = db.findUserById(player.userId);
          const userChatId = user ? (user.telegramChatId || user.telegram_chat_id) : null;
          const userEnabled = user ? ((user.telegramNotificationsEnabled !== false) && (user.telegram_notifications_enabled !== 0)) : false;
          if (!user || !userChatId || !userEnabled) continue;

          const timezoneOffset = user.timezoneOffset !== undefined ? user.timezoneOffset : 3;
          const targetHour = options.targetHour !== undefined ? options.targetHour : 9;

          const shouldSend = logic.shouldSendMorningEventReminder({
            eventDateFrom: ev.dateFrom,
            now,
            timezoneOffset,
            targetHour
          });

          if (!shouldSend && !options.force) continue;

          const zonedParts = logic.getZonedDateParts(now, timezoneOffset);
          const reminderDate = zonedParts ? zonedParts.dateString : String(ev.dateFrom).slice(0, 10);

          if (!options.force && db.hasEventReminderBeenSent(ev.id, a.place, user.id, reminderDate)) {
            continue;
          }

          const placeInfo = (effectivePlaces || []).find(p => Number(p.place) === Number(a.place));
          const coupons = placeInfo ? (placeInfo.coupons || 0) : 0;

          let officerName = 'Любой';
          if (a.officerId) {
            const off = (player.officers || []).find(o => o.id === a.officerId || o.catalogId === a.officerId);
            if (off) officerName = off.name;
          }

          const link = `${baseUrl}/#event/${ev.id}`;
          await dispatchNotification('event_morning_briefing', {
            sectorName: player.name,
            eventName: et ? et.name : 'Событие альянса',
            place: String(a.place),
            coupons: String(coupons),
            officerName,
            link
          }, {
            userId: user.id,
            chatId: userChatId
          });

          if (db.recordEventReminderSent) {
            db.recordEventReminderSent(ev.id, a.place, user.id, reminderDate);
          }
          sentCount++;
        }
      }

      return { eventsChecked: events.length, remindersSent: sentCount };
    } catch (err) {
      console.warn('[MorningReminders] Error in checkScheduledEventMorningReminders:', err.message);
      return { eventsChecked: 0, remindersSent: 0, error: err.message };
    }
  }

  function getTemplates() {
    return db.getNotificationTemplates();
  }

  function getTemplate(key) {
    return db.getNotificationTemplate(key);
  }

  function saveTemplate(key, data) {
    return db.updateNotificationTemplate ? db.updateNotificationTemplate(key, data) : db.saveNotificationTemplate(key, data);
  }

  function resetTemplate(key) {
    return db.resetNotificationTemplate(key);
  }

  function testTemplate(key, samplePayload = {}) {
    const tpl = db.getNotificationTemplate(key);
    if (!tpl) return null;
    const rendered = logic.renderTemplate(tpl.template, samplePayload);
    return {
      template: tpl,
      sampleData: samplePayload,
      renderedText: rendered
    };
  }

  return {
    dispatchNotification,
    checkStaleStockReminders,
    checkScheduledStaleStockReminders,
    checkScheduledEventMorningReminders,
    getTemplates,
    getTemplate,
    saveTemplate,
    resetTemplate,
    testTemplate
  };
}

module.exports = {
  createNotificationEngine
};
