const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { URL } = require('node:url');
const db = require('./db.js');
const logic = require('./logic.js');
const s3 = require('./s3.js');
const telegram = require('./telegram.js');
const mieru = require('./mieru.js');

let APP_VERSION = '3.21.0';
try {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
  if (pkg.version) APP_VERSION = pkg.version;
} catch (_) {}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm'
};

let customOcrRunner = null;
function setServerOcrRunner(runner) {
  customOcrRunner = runner;
}

async function tryServerOcr(imageBufferOrPath) {
  if (typeof customOcrRunner === 'function') {
    try {
      const res = await customOcrRunner(imageBufferOrPath);
      return res;
    } catch (err) {
      console.warn('[OCR] Custom OCR runner error:', err.message);
      return null;
    }
  }

  try {
    const { execFile } = require('node:child_process');
    const os = require('node:os');

    let filePath = imageBufferOrPath;
    let tempCreated = false;
    if (Buffer.isBuffer(imageBufferOrPath)) {
      filePath = path.join(os.tmpdir(), `ocr_${Date.now()}_${Math.random().toString(36).slice(2)}.jpg`);
      await fs.promises.writeFile(filePath, imageBufferOrPath);
      tempCreated = true;
    }

    try {
      const ocrText = await new Promise((resolve, reject) => {
        execFile('tesseract', [filePath, 'stdout', '-l', 'eng+rus'], { timeout: 15000 }, (error, stdout) => {
          if (error) return reject(error);
          resolve(stdout || '');
        });
      });

      if (ocrText && ocrText.trim()) {
        const parsedStock = logic.parseWarehouseScreenshotText(ocrText);
        if (parsedStock && (parsedStock.coupons > 0 || parsedStock.puzzles > 0 || parsedStock.starCoupons > 0)) {
          return parsedStock;
        }
      }
      return null;
    } finally {
      if (tempCreated) {
        fs.promises.unlink(filePath).catch(() => {});
      }
    }
  } catch (ocrErr) {
    return null;
  }
}

function sendJson(res, statusCode, data) {
  const json = JSON.stringify(data);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
    'Pragma': 'no-cache',
    'Expires': '0',
    'Surrogate-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, Cache-Control, Pragma'
  });
  res.end(json);
}

function sendError(res, statusCode, code, message) {
  sendJson(res, statusCode, { error: code, message: message || code });
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => {
      data += chunk;
      if (data.length > 50 * 1024 * 1024) {
        req.destroy();
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      if (!data.trim()) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch (err) {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function authenticate(req) {
  let token = null;
  const authHeader = req.headers.authorization || req.headers.Authorization || '';
  if (authHeader.startsWith('Bearer ')) {
    token = authHeader.slice(7).trim();
  } else if (req.headers.cookie) {
    const match = req.headers.cookie.match(/(?:^|;\s*)token=([^;]+)/);
    if (match) {
      token = decodeURIComponent(match[1]);
    }
  }

  if (!token) {
    req.user = null;
    return null;
  }
  const user = db.verifySession(token);
  req.user = user || null;
  req.token = token;
  if (req.user && req.user.id) {
    db.touchUserActive(req.user.id);
  }
  return req.user;
}

function sanitizeSkills(skills) {
  if (!Array.isArray(skills)) return [1, 1, 1, 1];
  const arr = skills.slice(0, 4);
  while (arr.length < 4) arr.push(1);
  return arr.map(n => Math.max(1, Math.min(5, Math.floor(Number(n) || 1))));
}

function sanitizeInvested(invested) {
  if (!invested || typeof invested !== 'object') return { ...logic.INVESTED_ZERO };
  return logic.normalizeInvested(invested);
}

function sanitizeVipPoints(pts) {
  return Math.max(0, Math.floor(Number(pts) || 0));
}

function sanitizeStock(stock) {
  if (!stock || typeof stock !== 'object') return stock;
  if (stock.starCoupons !== undefined) {
    stock.starCoupons = Math.max(0, parseInt(stock.starCoupons, 10) || 0);
  }
  if (stock.legendaryStars1 !== undefined) {
    stock.legendaryStars1 = Math.max(0, parseInt(stock.legendaryStars1, 10) || 0);
  }
  if (stock.legendaryStars2 !== undefined) {
    stock.legendaryStars2 = Math.max(0, parseInt(stock.legendaryStars2, 10) || 0);
  }
  if (stock.legendaryStars3 !== undefined) {
    stock.legendaryStars3 = Math.max(0, parseInt(stock.legendaryStars3, 10) || 0);
  }
  if (stock.coupons !== undefined) {
    stock.coupons = Math.max(0, parseInt(stock.coupons, 10) || 0);
  }
  if (stock.puzzles !== undefined) {
    stock.puzzles = Math.max(0, parseInt(stock.puzzles, 10) || 0);
  }
  if (stock.chests !== undefined) {
    stock.chests = Math.max(0, parseInt(stock.chests, 10) || 0);
  }
  return stock;
}

function sanitizePersonalPuzzles(val) {
  const num = parseInt(val, 10);
  return isNaN(num) || num < 0 ? 0 : num;
}

function sanitizeEventTypePlaces(places) {
  if (!Array.isArray(places)) return [];
  return places.map((p, idx) => ({
    place: Math.max(1, parseInt(p.place) || (idx + 1)),
    label: String(p.label || `${p.place || (idx + 1)} место`).trim(),
    coupons: Math.max(0, parseInt(p.coupons) || 0)
  }));
}

function sanitizeEventType(data) {
  if (!data || typeof data !== 'object') return {};
  const isPeriodic = data.isPeriodic !== undefined ? (data.isPeriodic ? 1 : 0) : (data.is_periodic !== undefined ? (data.is_periodic ? 1 : 0) : 1);
  const startDayOfWeek = Math.max(1, Math.min(7, parseInt(data.startDayOfWeek ?? data.start_day_of_week) || 2));
  const endDayOfWeek = Math.max(1, Math.min(7, parseInt(data.endDayOfWeek ?? data.end_day_of_week) || 3));
  const activeWeeks = Math.max(1, parseInt(data.activeWeeks ?? data.active_weeks) || 1);
  const breakWeeks = Math.max(0, parseInt(data.breakWeeks ?? data.break_weeks) || 1);
  const weekOffset = Math.max(0, parseInt(data.weekOffset ?? data.week_offset) || 0);
  const places = data.places !== undefined ? sanitizeEventTypePlaces(data.places) : undefined;

  const result = {
    ...data,
    isPeriodic,
    startDayOfWeek,
    endDayOfWeek,
    activeWeeks,
    breakWeeks,
    weekOffset
  };
  if (places !== undefined) {
    result.places = places;
  }
  return result;
}

function requireAuth(req, res) {
  if (!req.user) {
    sendError(res, 401, 'UNAUTHORIZED', 'Требуется авторизация');
    return false;
  }
  return true;
}

function requireRole(roles) {
  return (req, res) => {
    if (!req.user) {
      sendError(res, 401, 'UNAUTHORIZED', 'Требуется авторизация');
      return false;
    }
    if (!roles.includes(req.user.rank)) {
      sendError(res, 403, 'FORBIDDEN', `Доступ запрещен для ранга ${req.user.rank}`);
      return false;
    }
    return true;
  };
}

function requirePermission(reqOrPerm, res, permission) {
  if (typeof reqOrPerm === 'string') {
    const perm = reqOrPerm;
    return (req, res) => requirePermission(req, res, perm);
  }
  const req = reqOrPerm;
  if (!req.user) {
    authenticate(req);
  }
  if (!req.user) {
    sendError(res, 401, 'UNAUTHORIZED', 'Требуется авторизация');
    return false;
  }
  if (logic.hasUserPermission(req.user, permission)) {
    return true;
  }
  sendError(res, 403, 'FORBIDDEN', `Недостаточно прав: требуется разрешение ${permission}`);
  return false;
}

function maskPlayerStockIfNeeded(player, user) {
  if (!player) return player;
  const isOwner = user && player.userId === user.id;
  const canViewStocks = user && logic.hasUserPermission(user, 'view_stocks');
  if (isOwner || canViewStocks) {
    return player;
  }
  return {
    ...player,
    stock: {
      coupons: 0,
      puzzles: 0,
      chests: 0,
      starCoupons: 0,
      legendaryStars1: 0,
      legendaryStars2: 0,
      legendaryStars3: 0,
      masked: true
    }
  };
}

function getAppBaseUrl(req = null) {
  const settingUrl = db.getAppSetting('app_base_url');
  if (settingUrl) return settingUrl.replace(/\/+$/, '');
  if (process.env.APP_BASE_URL) return process.env.APP_BASE_URL.replace(/\/+$/, '');
  if (req && req.headers && req.headers.host) {
    const proto = req.headers['x-forwarded-proto'] || 'http';
    return `${proto}://${req.headers.host}`;
  }
  return 'http://localhost:3000';
}

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

    const mieruSettings = db.getMieruSettings();
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
      const res = await telegram.sendTelegramMessage({
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
        if (!user.telegram_chat_id || user.telegram_notifications_enabled === 0) {
          return { sent: false, reason: 'notifications_disabled_or_no_chat' };
        }
        const res = await telegram.sendTelegramMessage({
          token,
          chatId: user.telegram_chat_id,
          text: renderedText,
          parseMode,
          replyMarkup
        }, sendOpts);
        return { sent: res.ok, result: res };
      }

      if (options.broadcast) {
        const users = db.getUsers();
        const targets = users.filter(u => u.is_approved !== 0 && u.telegram_chat_id && u.telegram_notifications_enabled !== 0);
        let sentCount = 0;
        for (const u of targets) {
          const res = await telegram.sendTelegramMessage({
            token,
            chatId: u.telegram_chat_id,
            text: renderedText,
            parseMode,
            replyMarkup
          });
          if (res.ok) sentCount++;
        }
        return { sent: true, sentCount, totalTargets: targets.length };
      }

      const directChatId = options.chatId || options.recipientChatId;
      if (directChatId) {
        const res = await telegram.sendTelegramMessage({
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

    const schedule = db.getStaleAlertSchedule();
    const cooldownDays = schedule.personalCooldownDays !== undefined ? schedule.personalCooldownDays : 7;

    const players = db.getPlayers();
    const totalSectors = players.length;
    let freshCount = 0;
    let warningCount = 0;
    let staleCount = 0;
    let personalRemindersSent = 0;

    const baseUrl = getAppBaseUrl(req);
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
          // Check personal cooldown
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
          if (user && user.telegram_chat_id && user.telegram_notifications_enabled !== 0) {
            const res = await dispatchNotification('stock_reminder_personal', {
              username: user.username,
              sectorName: player.name || 'Сектор',
              daysOverdue: String(freshness.days ?? '14+'),
              link: `${baseUrl}/#cabinet`
            }, { userId: user.id }).catch(err => {
              console.warn(`[Reminders] Error sending reminder to user ${user.id}:`, err.message);
              return { sent: false };
            });
            if (res && res.sent) {
              personalRemindersSent++;
              db.updatePlayerStockReminderTime(player.id, now.toISOString());
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

    db.recordStaleAlertRun({ lastRunAt: now.toISOString(), status: result });

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
    const schedule = db.getStaleAlertSchedule();
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
    const events = db.getEvents();
    if (!events || !events.length) {
      return { eventsChecked: 0, remindersSent: 0 };
    }

    const eventTypes = db.getEventTypes();
    const now = options.now ? new Date(options.now) : new Date();
    const baseUrl = getAppBaseUrl(req);
    let sentCount = 0;

    const nowTime = now.getTime();
    for (const ev of events) {
      const assignments = ev.assignments || [];
      if (!assignments.length) continue;

      // Ранний отсев архивных и далеких будущих событий (окно старта ±36 часов от текущего момента)
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
        if (!user || !user.telegramChatId || user.telegramNotificationsEnabled === false) continue;

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
          chatId: user.telegramChatId
        });

        db.recordEventReminderSent(ev.id, a.place, user.id, reminderDate);
        sentCount++;
      }
    }

    return { eventsChecked: events.length, remindersSent: sentCount };
  } catch (err) {
    console.warn('[MorningReminders] Error in checkScheduledEventMorningReminders:', err.message);
    return { eventsChecked: 0, remindersSent: 0, error: err.message };
  }
}

function getPlayerTargetOfficerDeficit(player) {
  if (!player) return { targetOfficer: null, targetDeficit: 0, deficitDetails: null };
  const pOfficers = Array.isArray(player.officers) ? player.officers : [];
  if (!pOfficers.length) return { targetOfficer: null, targetDeficit: 0, deficitDetails: null };

  const catalog = db.getCatalog ? db.getCatalog() : [];
  let target = pOfficers.find(o => {
    const skillsSum = Array.isArray(o.skills) ? o.skills.reduce((a, b) => a + Number(b), 0) : 4;
    return skillsSum < 20 || Number(o.stars || 0) < 5;
  }) || pOfficers[0];

  const catEntry = catalog.find(c => c.id === (target.catalogId || target.officerId || target.id)) || { name: target.name || 'Офицер', coupon_cost: 50 };
  const targetName = catEntry.name || target.name || 'Офицер';

  const defRes = logic.calculateOfficerDeficit(target, player.stock || {}, catEntry, true);
  return {
    targetOfficer: targetName,
    targetDeficit: defRes ? defRes.coupons : 0,
    deficitDetails: defRes
  };
}

// ─── TELEGRAM BOT MESSAGE & UPDATE PROCESSOR ─────────────────────────

async function handleTelegramUpdate(update) {
  if (!update || typeof update !== 'object') {
    return { ok: false, error: 'INVALID_UPDATE' };
  }

  const token = db.getAppSetting('telegram_bot_token');

  const resolveTelegramUser = (fromId, tgUsername) => {
    if (!fromId) return null;
    let user = db.findUserByTelegramChatId(fromId);
    if (!user && tgUsername) {
      const matched = db.findUserByTelegramUsername(tgUsername);
      if (matched && (!matched.telegram_chat_id || String(matched.telegram_chat_id) !== String(fromId))) {
        db.bindUserTelegram(matched.id, fromId, tgUsername);
        user = (typeof db.getUserById === 'function') ? db.getUserById(matched.id) : matched;
      }
    }
    return user;
  };

  // 1. Message update
  if (update.message) {
    const msg = update.message;
    const text = (msg.text || '').trim();
    const chatId = msg.chat?.id;

    if (!chatId) return { ok: true, ignored: true };

    // A) /start bind_<token> (also supports /start@bot bind_<token>)
    const bindMatch = text.match(/^\/start(?:@\w+)?\s+bind_([a-zA-Z0-9_-]+)/i);
    if (bindMatch) {
      const bindToken = bindMatch[1];
      const user = db.findUserByTelegramBindToken(bindToken);
      if (user) {
        const username = msg.from?.username || msg.from?.first_name || '';
        db.bindUserTelegram(user.id, chatId, username);
        if (token) {
          await telegram.sendTelegramMessage({
            token,
            chatId,
            text: '✅ <b>Ваш аккаунт KoW Tracker успешно подключен!</b>\nТеперь вы будете получать персональные уведомления о распределении мест и событиях альянса.'
          });
        }
        return { ok: true, bound: true, userId: user.id };
      } else {
        if (token) {
          await telegram.sendTelegramMessage({
            token,
            chatId,
            text: '❌ <b>Срок действия ссылки истек или токен недействителен.</b>\nПожалуйста, сгенерируйте новую ссылку для привязки в Личном кабинете KoW Tracker.'
          });
        }
        return { ok: true, bound: false, reason: 'token_expired_or_invalid' };
      }
    }

    // A2) /bind <login> <password> or /login <login> <password>
    const directBindMatch = text.match(/^\/(?:bind|login)(?:@\w+)?\s+(\S+)\s+(\S+)/i);
    if (directBindMatch && msg.chat?.type === 'private') {
      const login = directBindMatch[1].trim();
      const password = directBindMatch[2].trim();

      // Delete message with password for security
      if (token && msg.message_id) {
        try {
          await telegram.deleteTelegramMessage({ token, chatId, messageId: msg.message_id });
        } catch (_) {}
      }

      const authRes = db.loginUser(login, password);
      if (authRes && authRes.user && !authRes.error) {
        const username = msg.from?.username || msg.from?.first_name || '';
        db.bindUserTelegram(authRes.user.id, chatId, username);
        if (token) {
          const webAppUrl = db.getAppSetting('telegram_webapp_url') || db.getAppSetting('app_base_url') || null;
          const isStaff = authRes.user.rank === 'r4' || authRes.user.rank === 'r5';
          const keyboard = logic.getTelegramMainMenuKeyboard({ isStaff, webAppUrl });
          await telegram.sendTelegramMessage({
            token,
            chatId,
            text: `✅ <b>Аккаунт «${authRes.user.username}» успешно привязан к вашему Telegram!</b>\n` +
                  `Роль: <b>${(authRes.user.rank || 'r3').toUpperCase()}</b>\n\n` +
                  `Теперь вы будете получать персональные уведомления, сможете просматривать свой сектор и обновлять склад.\n` +
                  `<i>(Сообщение с паролем удалено в целях безопасности).</i>`,
            replyMarkup: keyboard
          });
        }
        return { ok: true, bound: true, userId: authRes.user.id, directBind: true };
      } else {
        if (token) {
          await telegram.sendTelegramMessage({
            token,
            chatId,
            text: '❌ <b>Неверный логин или пароль.</b>\n' +
                  'Проверьте правильность введенных данных учетной записи KoW Tracker и повторите попытку:\n' +
                  '<code>/bind &lt;ваш_логин&gt; &lt;ваш_пароль&gt;</code>'
          });
        }
        return { ok: true, bound: false, reason: 'invalid_credentials' };
      }
    }

    // A3) /bind or /login without parameters
    const bindHelpMatch = text.match(/^\/(?:bind|login)(?:@\w+)?(?:\s|$)/i);
    if (bindHelpMatch && msg.chat?.type === 'private') {
      if (token) {
        await telegram.sendTelegramMessage({
          token,
          chatId,
          text: 'ℹ️ <b>Привязка аккаунта KoW Tracker:</b>\n\n' +
                'Отправьте команду с вашим логином и паролем в трекере:\n' +
                '<code>/bind &lt;логин&gt; &lt;пароль&gt;</code>\n\n' +
                '<i>(Бот сразу удалит сообщение с паролем для вашей безопасности).</i>'
        });
      }
      return { ok: true, command: 'bind_help' };
    }

    // B) /connect_staff <PIN> (also supports /connect_staff@bot <PIN>)
    const staffMatch = text.match(/^\/connect_staff(?:@\w+)?\s+([a-zA-Z0-9_-]+)/i);
    if (staffMatch) {
      const pin = staffMatch[1].trim().toUpperCase();
      const bindRes = db.verifyAndBindStaffChat(pin, chatId);
      if (bindRes.success) {
        if (token) {
          await telegram.sendTelegramMessage({
            token,
            chatId,
            text: '✅ <b>Чат штаба успешно подключен к KoW Tracker!</b>\nОповещения для офицеров Р4/Р5 активированы.'
          });
        }
        return { ok: true, staffConnected: true, chatId };
      } else {
        if (token) {
          await telegram.sendTelegramMessage({
            token,
            chatId,
            text: '❌ <b>Неверный или истекший код привязки штаба.</b>\nСгенерируйте свежий PIN в настройках KoW Tracker (раздел Настройки ➔ Уведомления).'
          });
        }
        return { ok: true, staffConnected: false, reason: bindRes.reason };
      }
    }

    // B2) /connect_channel <PIN> (also supports /connect_channel@bot <PIN>)
    const channelMatch = text.match(/^\/connect_channel(?:@\w+)?\s+([a-zA-Z0-9_-]+)/i);
    if (channelMatch) {
      const pin = channelMatch[1].trim().toUpperCase();
      const bindRes = db.verifyAndBindChannelChat(pin, chatId);
      if (bindRes.success) {
        if (token) {
          await telegram.sendTelegramMessage({
            token,
            chatId,
            text: '✅ <b>Канал/чат анонсов успешно подключен к KoW Tracker!</b>\nПубличные анонсы и сетки событий будут транслироваться сюда.'
          });
        }
        return { ok: true, channelConnected: true, chatId };
      } else {
        if (token) {
          await telegram.sendTelegramMessage({
            token,
            chatId,
            text: '❌ <b>Неверный или истекший код привязки канала анонсов.</b>\nСгенерируйте свежий PIN в настройках KoW Tracker.'
          });
        }
        return { ok: true, channelConnected: false, reason: bindRes.reason };
      }
    }

    // C) /ping or /status
    if (/^\/(?:ping|status)(?:@\w+)?(?:\s|$)/i.test(text)) {
      if (token) {
        const staffChatId = db.getAppSetting('telegram_staff_chat_id');
        const isStaffChat = String(staffChatId) === String(chatId);
        const roleDesc = isStaffChat ? 'Чат штаба (Р4/Р5)' : (msg.chat?.type === 'private' ? 'Личный диалог' : 'Групповой чат');
        await telegram.sendTelegramMessage({
          token,
          chatId,
          text: `🏓 <b>KoW Tracker Bot онлайн!</b>\n• Статус: 🟢 Активен (Long Polling)\n• Чат ID: <code>${chatId}</code>\n• Тип: ${roleDesc}`
        });
      }
      return { ok: true, command: 'ping', chatId };
    }

    // D) /start or /help (without bind token)
    if (/^\/(?:start|help)(?:@\w+)?(?:\s|$)/i.test(text)) {
      if (token && msg.chat?.type === 'private') {
        const fromId = msg.from?.id;
        const user = fromId ? resolveTelegramUser(fromId, msg.from?.username) : null;
        if (user) {
          const isStaff = user && (user.rank === 'r4' || user.rank === 'r5');
          const webAppUrl = db.getAppSetting('telegram_webapp_url') || db.getAppSetting('app_base_url') || null;
          const keyboard = logic.getTelegramMainMenuKeyboard({ isStaff, webAppUrl });
          await telegram.sendTelegramMessage({
            token,
            chatId,
            text: `👋 <b>Здравствуйте, ${user.username}! Я официальный Telegram-бот KoW Tracker.</b>\n` +
                  `✅ Ваш аккаунт KoW Tracker подключен.\n\n` +
                  '📱 <b>Команды бойца:</b>\n' +
                  '• <code>/me</code> — профиль, склад и прогресс офицера\n' +
                  '• <code>/deficit</code> — расчет дефицита до максимума прокачки\n' +
                  '• <code>/events</code> — ваши места и ближайшие события альянса\n' +
                  '• <code>/stock &lt;купоны&gt; &lt;пазлы&gt;</code> — быстрое обновление склада\n' +
                  '• <code>/menu</code> — интерактивное меню кнопок\n\n' +
                  '📦 <b>Скриншоты склада:</b>\n' +
                  'Просто отправьте фото инвентаря для сохранения в журнале аудита.' +
                  (isStaff ? '\n\n🛡️ <b>Подключение чата штаба:</b>\n<code>/connect_staff &lt;PIN&gt;</code>' : ''),
            replyMarkup: keyboard
          });
          return { ok: true, command: 'start', userId: user.id, autoMatched: true, chatId };
        }

        const firstName = msg.from?.first_name || 'боец';
        await telegram.sendTelegramMessage({
          token,
          chatId,
          text: `👋 <b>Здравствуйте, ${firstName}! Я официальный Telegram-бот KoW Tracker.</b>\n\n` +
                '⚠️ <b>Ваш Telegram пока не привязан к аккаунту в KoW Tracker.</b>\n\n' +
                '🔗 <b>Как подключить аккаунт:</b>\n' +
                '1️⃣ <b>В Личном кабинете:</b> откройте трекер, перейдите в Личный кабинет и нажмите кнопку <b>«📱 Подключить Telegram»</b>.\n' +
                '2️⃣ <b>Прямо в этом чате:</b> отправьте команду с логином и паролем:\n' +
                '<code>/bind &lt;ваш_логин&gt; &lt;ваш_пароль&gt;</code>\n' +
                '<i>(Бот сразу удалит сообщение с паролем в целях безопасности).</i>'
        });
        return { ok: true, command: 'help', unbound: true, chatId };
      }
      return { ok: true, command: 'help', chatId };
    }

    // D1) /me or /профиль
    if (/^\/(?:me|профиль|profile)(?:@\w+)?(?:\s|$)/i.test(text)) {
      const fromId = msg.from?.id;
      const user = fromId ? resolveTelegramUser(fromId, msg.from?.username) : null;
      if (!user) {
        if (token) {
          await telegram.sendTelegramMessage({
            token,
            chatId,
            text: '⚠️ <b>Ваш Telegram не привязан к аккаунту в KoW Tracker.</b>\n\n' +
                  'Откройте <b>Личный кабинет</b> в трекере и нажмите кнопку <b>«📱 Подключить Telegram»</b>, ' +
                  'либо отправьте команду:\n<code>/bind &lt;логин&gt; &lt;пароль&gt;</code>'
          });
        }
        return { ok: true, command: 'me', error: 'user_not_bound' };
      }

      const sectors = db.getPlayersByUserId(user.id);
      const player = (user.player_id ? db.getPlayerById(user.player_id) : null) || sectors[0];
      const freshness = player?.stockUpdatedAt ? logic.getStockFreshness(player.stockUpdatedAt) : null;
      const { targetOfficer, targetDeficit } = getPlayerTargetOfficerDeficit(player);

      const replyText = logic.formatTelegramMeMessage({
        user,
        player,
        freshness,
        targetOfficer,
        targetDeficit
      });

      const keyboard = logic.getTelegramMainMenuKeyboard({ isStaff: user.rank === 'r4' || user.rank === 'r5' });

      if (token) {
        await telegram.sendTelegramMessage({
          token,
          chatId,
          text: replyText,
          replyMarkup: keyboard
        });
      }
      return { ok: true, command: 'me', userId: user.id, playerId: player?.id };
    }

    // D2) /deficit or /дефицит
    if (/^\/(?:deficit|дефицит)(?:@\w+)?(?:\s|$)/i.test(text)) {
      const fromId = msg.from?.id;
      const user = fromId ? resolveTelegramUser(fromId, msg.from?.username) : null;
      if (!user) {
        if (token) {
          await telegram.sendTelegramMessage({
            token,
            chatId,
            text: '⚠️ <b>Ваш Telegram не привязан к аккаунту в KoW Tracker.</b>\nПривяжите Telegram в Личном кабинете трекера или отправьте боту: <code>/bind &lt;логин&gt; &lt;пароль&gt;</code>'
          });
        }
        return { ok: true, command: 'deficit', error: 'user_not_bound' };
      }

      const sectors = db.getPlayersByUserId(user.id);
      const player = (user.player_id ? db.getPlayerById(user.player_id) : null) || sectors[0];
      const { targetOfficer, targetDeficit, deficitDetails } = getPlayerTargetOfficerDeficit(player);

      const vip = player?.vip !== undefined ? Number(player.vip) : (user.vip !== undefined ? Number(user.vip) : 10);
      const daily = logic.dailyRewards(vip, Number(player?.confidentiality || 0));
      const dailyCoupons = (daily?.coupons || 0) + ((daily?.puzzles || 0) * 50);
      const daysEstimate = (targetDeficit > 0 && dailyCoupons > 0) ? Math.ceil(targetDeficit / dailyCoupons) : (targetDeficit === 0 ? 0 : null);

      const replyText = logic.formatTelegramDeficitMessage({
        player,
        targetOfficer: targetOfficer || 'Офицер',
        deficit: deficitDetails,
        dailyRewards: daily,
        daysEstimate
      });

      const keyboard = logic.getTelegramMainMenuKeyboard({ isStaff: user.rank === 'r4' || user.rank === 'r5' });

      if (token) {
        await telegram.sendTelegramMessage({
          token,
          chatId,
          text: replyText,
          replyMarkup: keyboard
        });
      }
      return { ok: true, command: 'deficit', userId: user.id, playerId: player?.id };
    }

    // D3) /events or /ивенты
    if (/^\/(?:events|ивенты|события)(?:@\w+)?(?:\s|$)/i.test(text)) {
      const fromId = msg.from?.id;
      const user = fromId ? resolveTelegramUser(fromId, msg.from?.username) : null;
      if (!user) {
        if (token) {
          await telegram.sendTelegramMessage({
            token,
            chatId,
            text: '⚠️ <b>Ваш Telegram не привязан к аккаунту в KoW Tracker.</b>\nПривяжите Telegram в Личном кабинете трекера или отправьте боту: <code>/bind &lt;логин&gt; &lt;пароль&gt;</code>'
          });
        }
        return { ok: true, command: 'events', error: 'user_not_bound' };
      }

      const sectors = db.getPlayersByUserId(user.id);
      const player = (user.player_id ? db.getPlayerById(user.player_id) : null) || sectors[0];

      const allEvents = db.getEvents ? db.getEvents() : [];
      const eventTypes = db.getEventTypes ? db.getEventTypes() : [];
      const typesMap = new Map((eventTypes || []).map(t => [t.id, t]));
      const enrichedEvents = (allEvents || []).map(e => {
        const et = typesMap.get(e.typeId);
        return {
          ...e,
          title: et?.name || e.title || `Событие #${e.id}`,
          eventTypeName: et?.name,
          places: et?.places || []
        };
      });

      const nowIso = new Date().toISOString();
      const isPastRequested = /(?:past|прошедш|завершен|старые)/i.test(text);

      let eventsList = [];
      let mode = 'upcoming';

      if (isPastRequested) {
        mode = 'past';
        eventsList = enrichedEvents
          .filter(e => e.dateTo && e.dateTo < nowIso.slice(0, 10))
          .sort((a, b) => (b.dateFrom || '').localeCompare(a.dateFrom || ''));
      } else {
        eventsList = enrichedEvents
          .filter(e => !e.dateTo || e.dateTo >= nowIso.slice(0, 10))
          .sort((a, b) => (a.dateFrom || '').localeCompare(b.dateFrom || ''));
      }

      const replyText = logic.formatTelegramEventsListMessage({
        events: eventsList,
        playerId: player?.id,
        mode
      });

      const keyboard = logic.getTelegramEventsKeyboard
        ? logic.getTelegramEventsKeyboard({ events: eventsList, mode })
        : logic.getTelegramMainMenuKeyboard({ isStaff: user.rank === 'r4' || user.rank === 'r5' });

      if (token) {
        await telegram.sendTelegramMessage({
          token,
          chatId,
          text: replyText,
          replyMarkup: keyboard
        });
      }
      return { ok: true, command: 'events', userId: user.id, playerId: player?.id, mode };
    }

    // D4) /menu
    if (/^\/(?:menu|меню)(?:@\w+)?(?:\s|$)/i.test(text)) {
      const fromId = msg.from?.id;
      const user = fromId ? resolveTelegramUser(fromId, msg.from?.username) : null;
      const isStaff = user && (user.rank === 'r4' || user.rank === 'r5');
      const webAppUrl = db.getAppSetting('telegram_webapp_url') || db.getAppSetting('app_base_url') || null;
      const keyboard = logic.getTelegramMainMenuKeyboard({ isStaff, webAppUrl });

      if (token) {
        await telegram.sendTelegramMessage({
          token,
          chatId,
          text: '📱 <b>Главное меню KoW Tracker:</b>\nВыберите необходимое действие:',
          replyMarkup: keyboard
        });
      }
      return { ok: true, command: 'menu', userId: user?.id };
    }

    // Helper for checking officer access
    function isOfficerOrStaffChat(senderId, currentChatId) {
      const staffChatId = db.getAppSetting('telegram_staff_chat_id');
      if (staffChatId && String(staffChatId) === String(currentChatId)) {
        return true;
      }
      const user = senderId ? resolveTelegramUser(senderId, msg.from?.username) : null;
      if (!user) return false;
      return user.rank === 'r5' || user.rank === 'r4' || logic.hasUserPermission(user, 'view_sectors');
    }

    // D5) /who or /кто
    if (/^\/(?:who|кто|досье)(?:@\w+)?(?:\s+(.*))?$/i.test(text)) {
      const whoMatch = text.match(/^\/(?:who|кто|досье)(?:@\w+)?(?:\s+(.*))?$/i);
      const query = (whoMatch && whoMatch[1] ? whoMatch[1] : '').trim();

      const fromId = msg.from?.id;
      if (!isOfficerOrStaffChat(fromId, chatId)) {
        if (token) {
          await telegram.sendTelegramMessage({
            token,
            chatId,
            text: '⛔ <b>Доступ запрещен.</b>\nКоманда доступна только офицерам альянса (Р4/Р5) или в чате штаба.'
          });
        }
        return { ok: true, authorized: false, command: 'who' };
      }

      if (!query) {
        if (token) {
          await telegram.sendTelegramMessage({
            token,
            chatId,
            text: 'ℹ️ <b>Использование команды:</b> <code>/who &lt;сектор_или_ник&gt;</code>\n<i>Например: <code>/who Sector 1</code></i>'
          });
        }
        return { ok: true, command: 'who', error: 'missing_query' };
      }

      const allPlayers = db.getPlayers ? db.getPlayers() : [];
      const allUsers = db.getUsers ? db.getUsers() : [];
      const lowerQ = query.toLowerCase();

      let targetPlayer = allPlayers.find(p => (p.name || '').toLowerCase() === lowerQ);
      if (!targetPlayer) {
        targetPlayer = allPlayers.find(p => (p.name || '').toLowerCase().includes(lowerQ));
      }
      if (!targetPlayer) {
        const foundUser = allUsers.find(u => (u.username || '').toLowerCase().includes(lowerQ));
        if (foundUser) {
          const sectors = db.getPlayersByUserId(foundUser.id);
          targetPlayer = (foundUser.player_id ? db.getPlayerById(foundUser.player_id) : null) || sectors[0];
        }
      }

      if (!targetPlayer) {
        if (token) {
          await telegram.sendTelegramMessage({
            token,
            chatId,
            text: `⚠️ Сектор или игрок по запросу «<b>${logic.escapeHtml(query)}</b>» не найден.`
          });
        }
        return { ok: true, command: 'who', found: false };
      }

      const targetUser = targetPlayer.userId ? db.findUserById(targetPlayer.userId) : null;
      const freshness = targetPlayer.stockUpdatedAt ? logic.getStockFreshness(targetPlayer.stockUpdatedAt) : null;

      const allEvents = db.getEvents ? db.getEvents() : [];
      const recentEvents = [];
      (allEvents || []).forEach(e => {
        const a = (e.assignments || []).find(asgn => Number(asgn.playerId) === Number(targetPlayer.id));
        if (a) {
          recentEvents.push({
            title: e.title || e.name || 'Ивент',
            place: a.place,
            actualPlace: a.actualPlace,
            coupons: a.actualCoupons || a.coupons || 0
          });
        }
      });

      const whoMsg = logic.formatTelegramWhoMessage({
        player: targetPlayer,
        user: targetUser,
        freshness,
        recentEvents
      });

      if (token) {
        await telegram.sendTelegramMessage({ token, chatId, text: whoMsg });
      }
      return { ok: true, command: 'who', found: true, playerId: targetPlayer.id };
    }

    // D6) /stale or /должники
    if (/^\/(?:stale|должники)(?:@\w+)?(?:\s|$)/i.test(text)) {
      const fromId = msg.from?.id;
      if (!isOfficerOrStaffChat(fromId, chatId)) {
        if (token) {
          await telegram.sendTelegramMessage({
            token,
            chatId,
            text: '⛔ <b>Доступ запрещен.</b>\nКоманда доступна только офицерам альянса (Р4/Р5) или в чате штаба.'
          });
        }
        return { ok: true, authorized: false, command: 'stale' };
      }

      const allPlayers = db.getPlayers ? db.getPlayers() : [];
      const allUsers = db.getUsers ? db.getUsers() : [];
      const usersById = new Map(allUsers.map(u => [u.id, u]));

      const staleList = [];
      allPlayers.forEach(p => {
        const fr = p.stockUpdatedAt ? logic.getStockFreshness(p.stockUpdatedAt) : { status: 'stale', days: 30 };
        if (fr.status === 'stale') {
          const u = p.userId ? usersById.get(p.userId) : null;
          staleList.push({
            name: p.name,
            days: fr.days,
            username: u?.username || null
          });
        }
      });

      staleList.sort((a, b) => b.days - a.days);
      const staleMsg = logic.formatTelegramStaleReport({ stalePlayers: staleList });

      if (token) {
        await telegram.sendTelegramMessage({ token, chatId, text: staleMsg });
      }
      return { ok: true, command: 'stale', count: staleList.length };
    }

    // D7) /ping_stale or /пинг
    if (/^\/(?:ping_stale|пинг)(?:@\w+)?(?:\s|$)/i.test(text)) {
      const fromId = msg.from?.id;
      if (!isOfficerOrStaffChat(fromId, chatId)) {
        if (token) {
          await telegram.sendTelegramMessage({
            token,
            chatId,
            text: '⛔ <b>Доступ запрещен.</b>\nКоманда доступна только офицерам альянса (Р4/Р5).'
          });
        }
        return { ok: true, authorized: false, command: 'ping_stale' };
      }

      const res = await checkStaleStockReminders(null, { force: true, forcePersonal: true });
      const sentCount = res ? (res.personalRemindersSent || 0) : 0;
      const totalStale = res ? (res.staleCount || 0) : 0;

      const replyMsg = `📨 <b>Рассылка напоминаний завершена:</b>\n• Найдено устаревших складов: <b>${totalStale}</b>\n• Отправлено персональных сообщений в ЛС: <b>${sentCount}</b>`;

      if (token) {
        await telegram.sendTelegramMessage({ token, chatId, text: replyMsg });
      }
      return { ok: true, command: 'ping_stale', sentCount, totalStale };
    }

    // D8) /digest or /сводка
    if (/^\/(?:digest|дайджест|сводка)(?:@\w+)?(?:\s|$)/i.test(text)) {
      const fromId = msg.from?.id;
      if (!isOfficerOrStaffChat(fromId, chatId)) {
        if (token) {
          await telegram.sendTelegramMessage({
            token,
            chatId,
            text: '⛔ <b>Доступ запрещен.</b>\nКоманда доступна только офицерам альянса (Р4/Р5) или в чате штаба.'
          });
        }
        return { ok: true, authorized: false, command: 'digest' };
      }

      const allPlayers = db.getPlayers ? db.getPlayers() : [];
      const freshnessStats = { fresh: 0, warning: 0, stale: 0 };
      allPlayers.forEach(p => {
        const fr = p.stockUpdatedAt ? logic.getStockFreshness(p.stockUpdatedAt) : { status: 'stale' };
        freshnessStats[fr.status] = (freshnessStats[fr.status] || 0) + 1;
      });

      const allEvents = db.getEvents ? db.getEvents() : [];
      const nowIso = new Date().toISOString();
      const nextEv = (allEvents || [])
        .filter(e => !e.dateTo || e.dateTo >= nowIso.slice(0, 10))
        .sort((a, b) => (a.dateFrom || '').localeCompare(b.dateFrom || ''))[0] || null;

      let nextEvInfo = null;
      if (nextEv) {
        const regs = db.getRegistrationsByEventId ? db.getRegistrationsByEventId(nextEv.id) : (nextEv.registrations || []);
        nextEvInfo = {
          title: nextEv.title || nextEv.name,
          dateFrom: nextEv.dateFrom,
          assignedCount: (nextEv.assignments || []).length,
          totalPlaces: 5,
          registrationsCount: regs.length
        };
      }

      const pendingUsers = db.getPendingUsers ? db.getPendingUsers() : [];

      const digestMsg = logic.formatTelegramDigestMessage({
        totalSectors: allPlayers.length,
        freshnessStats,
        nextEvent: nextEvInfo,
        pendingUsersCount: pendingUsers.length
      });

      if (token) {
        await telegram.sendTelegramMessage({ token, chatId, text: digestMsg });
      }
      return { ok: true, command: 'digest' };
    }

    // E) /stock or /склад text command
    const stockParsed = logic.parseTelegramStockCommand(text);
    if (stockParsed) {
      const fromId = msg.from?.id;
      const user = fromId ? resolveTelegramUser(fromId, msg.from?.username) : null;
      if (!user) {
        if (token) {
          await telegram.sendTelegramMessage({
            token,
            chatId,
            text: '⚠️ <b>Ваш Telegram не привязан к аккаунту в KoW Tracker.</b>\nПривяжите ваш Telegram-аккаунт в Личном кабинете трекера или отправьте: <code>/bind &lt;логин&gt; &lt;пароль&gt;</code>'
          });
        }
        return { ok: true, command: 'stock', error: 'user_not_bound' };
      }

      const sectors = db.getPlayersByUserId(user.id);
      const player = (user.player_id ? db.getPlayerById(user.player_id) : null) || sectors[0];
      if (!player) {
        if (token) {
          await telegram.sendTelegramMessage({
            token,
            chatId,
            text: '⚠️ <b>Сектор не найден.</b>\nУ вашего аккаунта нет активного сектора в KoW Tracker.'
          });
        }
        return { ok: true, command: 'stock', error: 'no_player' };
      }

      const before = player.stock || {};
      const after = {
        ...before,
        ...stockParsed
      };
      const diff = logic.calculateStockDiff(before, after);
      const now = new Date().toISOString();

      db.recordStockHistory({
        playerId: player.id,
        userId: user.id,
        source: 'telegram_command',
        snapshotBefore: before,
        snapshotAfter: after,
        diffSummary: diff.summary,
        screenshotPath: null,
        createdAt: now
      });

      db.updatePlayer(player.id, {
        stock: after,
        stockUpdatedAt: now,
        stockUpdateSource: 'telegram_command',
        recordHistory: false
      });

      if (token) {
        const replyText = logic.formatStockUpdateSuccessMessage(diff, after, {
          sectorName: player.name
        });
        await telegram.sendTelegramMessage({
          token,
          chatId,
          text: replyText
        });
      }

      return { ok: true, command: 'stock', playerId: player.id, stock: after };
    }

    // F) Photo or Document screenshot upload
    const hasPhoto = Array.isArray(msg.photo) && msg.photo.length > 0;
    const hasDocImage = msg.document && (
      (msg.document.mime_type && msg.document.mime_type.startsWith('image/')) ||
      (msg.document.file_name && /\.(jpe?g|png|webp)$/i.test(msg.document.file_name))
    );

    if (hasPhoto || hasDocImage) {
      const fromId = msg.from?.id;
      const user = fromId ? resolveTelegramUser(fromId, msg.from?.username) : null;
      if (!user) {
        if (token) {
          await telegram.sendTelegramMessage({
            token,
            chatId,
            text: '⚠️ <b>Ваш Telegram не привязан к аккаунту в KoW Tracker.</b>\nПривяжите Telegram в Личном кабинете или отправьте боту: <code>/bind &lt;логин&gt; &lt;пароль&gt;</code>'
          });
        }
        return { ok: true, photo: true, error: 'user_not_bound' };
      }

      const sectors = db.getPlayersByUserId(user.id);
      const player = (user.player_id ? db.getPlayerById(user.player_id) : null) || sectors[0];
      if (!player) {
        if (token) {
          await telegram.sendTelegramMessage({
            token,
            chatId,
            text: '⚠️ <b>Сектор не найден.</b>\nУ вашего аккаунта нет активного сектора в KoW Tracker.'
          });
        }
        return { ok: true, photo: true, error: 'no_player' };
      }

      // Pick file_id (highest resolution photo or document)
      const fileId = hasPhoto ? msg.photo[msg.photo.length - 1].file_id : msg.document.file_id;

      let screenshotPath = null;
      let downloadedFileBuf = null;
      if (token && fileId) {
        try {
          const fileInfo = await telegram.getTelegramFile(token, fileId);
          if (fileInfo && fileInfo.ok && fileInfo.result?.file_path) {
            const fileBuf = await telegram.downloadTelegramFile(token, fileInfo.result.file_path);
            if (fileBuf && fileBuf.length > 0) {
              downloadedFileBuf = fileBuf;
              const yyyyMm = new Date().toISOString().slice(0, 7);
              const screenshotsDir = path.join(__dirname, 'data', 'screenshots', yyyyMm);
              if (!fs.existsSync(screenshotsDir)) {
                fs.mkdirSync(screenshotsDir, { recursive: true });
              }

              const rawExt = (path.extname(fileInfo.result.file_path) || '').toLowerCase();
              const ext = ['.jpg', '.jpeg', '.png', '.webp'].includes(rawExt) ? rawExt : '.jpg';
              const hash = crypto.createHash('sha256').update(fileBuf).digest('hex').slice(0, 8);
              const filename = `${player.id}_${Date.now()}_${hash}${ext}`;
              const fullPath = path.join(screenshotsDir, filename);
              await fs.promises.writeFile(fullPath, fileBuf);
              screenshotPath = `${yyyyMm}/${filename}`;
            }
          }
        } catch (downloadErr) {
          console.warn('[Telegram] Error downloading photo:', downloadErr.message);
        }
      }

      const caption = (msg.caption || '').trim();
      let photoStockParsed = logic.parseTelegramStockCommand(caption);
      if (!photoStockParsed && caption) {
        photoStockParsed = logic.parseTelegramStockCommand('/stock ' + caption);
      }

      const before = player.stock || {};
      const now = new Date().toISOString();

      if (photoStockParsed) {
        const after = {
          ...before,
          ...photoStockParsed
        };
        const diff = logic.calculateStockDiff(before, after);

        db.recordStockHistory({
          playerId: player.id,
          userId: user.id,
          source: 'telegram_photo',
          snapshotBefore: before,
          snapshotAfter: after,
          diffSummary: diff.summary,
          screenshotPath,
          createdAt: now
        });

        db.updatePlayer(player.id, {
          stock: after,
          stockUpdatedAt: now,
          stockUpdateSource: 'telegram_photo',
          recordHistory: false
        });

        if (token) {
          const replyText = logic.formatStockUpdateSuccessMessage(diff, after, {
            sectorName: player.name
          });
          await telegram.sendTelegramMessage({
            token,
            chatId,
            text: replyText
          });
        }

        return { ok: true, photo: true, updated: true, playerId: player.id, stock: after };
      } else {
        // Try server-side OCR on downloaded screenshot
        let recognizedStock = null;
        if (downloadedFileBuf && downloadedFileBuf.length > 0) {
          recognizedStock = await tryServerOcr(downloadedFileBuf);
        }

        if (recognizedStock && (recognizedStock.coupons > 0 || recognizedStock.puzzles > 0 || recognizedStock.starCoupons > 0)) {
          const recStockFull = {
            coupons: Number(recognizedStock.coupons) || 0,
            puzzles: Number(recognizedStock.puzzles) || 0,
            starCoupons: Number(recognizedStock.starCoupons) || 0,
            legendaryStars1: Number(recognizedStock.legendaryStars1) || 0,
            legendaryStars2: Number(recognizedStock.legendaryStars2) || 0,
            legendaryStars3: Number(recognizedStock.legendaryStars3) || 0,
            chests: before.chests || 0
          };

          const diff = logic.calculateStockDiff(before, recStockFull);

          const historyRecord = db.recordStockHistory({
            playerId: player.id,
            userId: user.id,
            source: 'telegram_photo',
            snapshotBefore: before,
            snapshotAfter: recStockFull,
            diffSummary: `${diff.summary} (ожидает подтверждения OCR)`,
            screenshotPath,
            createdAt: now
          });

          if (token) {
            const ocrMsg = logic.formatTelegramOcrConfirmationMessage({
              player,
              recognizedStock: recStockFull
            });
            const ocrKb = logic.getTelegramOcrConfirmationKeyboard(historyRecord.id);
            await telegram.sendTelegramMessage({
              token,
              chatId,
              text: ocrMsg,
              replyMarkup: ocrKb
            });
          }

          return {
            ok: true,
            photo: true,
            ocr: true,
            historyId: historyRecord.id,
            recognizedStock: recStockFull,
            playerId: player.id,
            screenshotPath
          };
        } else {
          db.recordStockHistory({
            playerId: player.id,
            userId: user.id,
            source: 'telegram_photo',
            snapshotBefore: before,
            snapshotAfter: before,
            diffSummary: 'Скриншот склада прикреплен',
            screenshotPath,
            createdAt: now
          });

          if (token) {
            const fallbackKb = logic.getTelegramStockFallbackKeyboard();
            await telegram.sendTelegramMessage({
              token,
              chatId,
              text: `📸 <b>Скриншот склада получен и сохранен в журнале аудита!</b>\n` +
                    `👤 Сектор: <b>${logic.escapeHtml(player.name)}</b>\n\n` +
                    `Если данные склада не изменились, подтвердите их актуальность кнопкой ниже.\n` +
                    `Чтобы обновить остатки вручную, отправьте команду:\n` +
                    `<code>/stock &lt;купоны&gt; &lt;пазлы&gt;</code>\n` +
                    `<i>(Например: <code>/stock 15000 350</code>)</i>`,
              replyMarkup: fallbackKb
            });
          }

          return { ok: true, photo: true, updated: false, fallback: true, playerId: player.id, screenshotPath };
        }
      }
    }
  }

  // 2. Callback query update (interactive buttons)
  if (update.callback_query) {
    const cq = update.callback_query;
    const cqId = cq.id;
    const data = cq.data || '';
    const fromId = cq.from?.id;
    const chatMsg = cq.message;

    // A) Main Menu callbacks
    if (data === 'cmd_me' || data === 'cmd_deficit' || data === 'cmd_events' || data === 'cmd_events_upcoming' || data === 'cmd_events_past' || data === 'cmd_menu' || data === 'cmd_stock_help' || data === 'cmd_digest' || data === 'cmd_stale' || data.startsWith('cmd_ev_view:')) {
      const user = fromId ? resolveTelegramUser(fromId, cq.from?.username) : null;
      if (!user) {
        if (token) {
          await telegram.answerTelegramCallback({
            token,
            callbackQueryId: cqId,
            text: '⚠️ Ваш Telegram не привязан к аккаунту в KoW Tracker. Отправьте боту: /bind <логин> <пароль>',
            showAlert: true
          });
        }
        return { ok: true, action: data, error: 'user_not_bound' };
      }

      if (token) {
        await telegram.answerTelegramCallback({ token, callbackQueryId: cqId });
      }

      const sectors = db.getPlayersByUserId(user.id);
      const player = (user.player_id ? db.getPlayerById(user.player_id) : null) || sectors[0];
      const isStaff = user.rank === 'r4' || user.rank === 'r5';
      const webAppUrl = db.getAppSetting('telegram_webapp_url') || db.getAppSetting('app_base_url') || null;
      const keyboard = logic.getTelegramMainMenuKeyboard({ isStaff, webAppUrl });
      const targetChatId = chatMsg?.chat?.id || fromId;

      if (data === 'cmd_menu') {
        if (token) {
          await telegram.sendTelegramMessage({
            token,
            chatId: targetChatId,
            text: '📱 <b>Главное меню KoW Tracker:</b>\nВыберите необходимое действие:',
            replyMarkup: keyboard
          });
        }
        return { ok: true, action: 'cmd_menu', userId: user.id };
      }

      if (data === 'cmd_me') {
        const freshness = player?.stockUpdatedAt ? logic.getStockFreshness(player.stockUpdatedAt) : null;
        const { targetOfficer, targetDeficit } = getPlayerTargetOfficerDeficit(player);
        const replyText = logic.formatTelegramMeMessage({ user, player, freshness, targetOfficer, targetDeficit });
        if (token) {
          await telegram.sendTelegramMessage({ token, chatId: targetChatId, text: replyText, replyMarkup: keyboard });
        }
        return { ok: true, action: 'cmd_me', userId: user.id };
      }

      if (data === 'cmd_deficit') {
        const { targetOfficer, targetDeficit, deficitDetails } = getPlayerTargetOfficerDeficit(player);
        const vip = player?.vip !== undefined ? Number(player.vip) : (user.vip !== undefined ? Number(user.vip) : 10);
        const daily = logic.dailyRewards(vip, Number(player?.confidentiality || 0));
        const dailyCoupons = (daily?.coupons || 0) + ((daily?.puzzles || 0) * 50);
        const daysEstimate = (targetDeficit > 0 && dailyCoupons > 0) ? Math.ceil(targetDeficit / dailyCoupons) : (targetDeficit === 0 ? 0 : null);
        const replyText = logic.formatTelegramDeficitMessage({ player, targetOfficer: targetOfficer || 'Офицер', deficit: deficitDetails, dailyRewards: daily, daysEstimate });
        if (token) {
          await telegram.sendTelegramMessage({ token, chatId: targetChatId, text: replyText, replyMarkup: keyboard });
        }
        return { ok: true, action: 'cmd_deficit', userId: user.id };
      }

      if (data === 'cmd_events' || data === 'cmd_events_upcoming') {
        const allEvents = db.getEvents ? db.getEvents() : [];
        const eventTypes = db.getEventTypes ? db.getEventTypes() : [];
        const typesMap = new Map((eventTypes || []).map(t => [t.id, t]));
        const enrichedEvents = (allEvents || []).map(e => {
          const et = typesMap.get(e.typeId);
          return {
            ...e,
            title: et?.name || e.title || `Событие #${e.id}`,
            eventTypeName: et?.name,
            places: et?.places || []
          };
        });

        const nowIso = new Date().toISOString();
        const upcomingEvents = enrichedEvents
          .filter(e => !e.dateTo || e.dateTo >= nowIso.slice(0, 10))
          .sort((a, b) => (a.dateFrom || '').localeCompare(b.dateFrom || ''));
        const replyText = logic.formatTelegramEventsListMessage({ events: upcomingEvents, playerId: player?.id, mode: 'upcoming' });
        const eventsMarkup = logic.getTelegramEventsKeyboard
          ? logic.getTelegramEventsKeyboard({ events: upcomingEvents, mode: 'upcoming' })
          : keyboard;
        if (token) {
          await telegram.sendTelegramMessage({ token, chatId: targetChatId, text: replyText, replyMarkup: eventsMarkup });
        }
        return { ok: true, action: data, userId: user.id };
      }

      if (data === 'cmd_events_past') {
        const allEvents = db.getEvents ? db.getEvents() : [];
        const eventTypes = db.getEventTypes ? db.getEventTypes() : [];
        const typesMap = new Map((eventTypes || []).map(t => [t.id, t]));
        const enrichedEvents = (allEvents || []).map(e => {
          const et = typesMap.get(e.typeId);
          return {
            ...e,
            title: et?.name || e.title || `Событие #${e.id}`,
            eventTypeName: et?.name,
            places: et?.places || []
          };
        });

        const nowIso = new Date().toISOString();
        const pastEvents = enrichedEvents
          .filter(e => e.dateTo && e.dateTo < nowIso.slice(0, 10))
          .sort((a, b) => (b.dateFrom || '').localeCompare(a.dateFrom || ''));
        const replyText = logic.formatTelegramEventsListMessage({ events: pastEvents, playerId: player?.id, mode: 'past' });
        const eventsMarkup = logic.getTelegramEventsKeyboard
          ? logic.getTelegramEventsKeyboard({ events: pastEvents, mode: 'past' })
          : keyboard;
        if (token) {
          await telegram.sendTelegramMessage({ token, chatId: targetChatId, text: replyText, replyMarkup: eventsMarkup });
        }
        return { ok: true, action: 'cmd_events_past', userId: user.id };
      }

      if (data.startsWith('cmd_ev_view:')) {
        const eventId = Number(data.split(':')[1]);
        const ev = db.getEventById ? db.getEventById(eventId) : null;
        if (!ev) {
          if (token) {
            await telegram.sendTelegramMessage({ token, chatId: targetChatId, text: '⚠️ Событие не найдено или было удалено.', replyMarkup: keyboard });
          }
          return { ok: true, action: 'cmd_ev_view', error: 'not_found' };
        }
        const et = db.getEventTypeById ? db.getEventTypeById(ev.typeId) : null;
        const reg = player ? (db.getUserRegistration ? db.getUserRegistration(eventId, player.id) : null) : null;
        const assign = (ev.assignments || []).find(a => Number(a.playerId) === Number(player?.id));
        const detailText = logic.formatTelegramEventDetailMessage({ event: ev, eventType: et, registration: reg, assignment: assign });
        const detailKb = logic.formatEventDetailRegistrationKeyboard({ eventId, eventType: et, registration: reg });
        if (token) {
          await telegram.sendTelegramMessage({ token, chatId: targetChatId, text: detailText, replyMarkup: detailKb });
        }
        return { ok: true, action: 'cmd_ev_view', eventId, userId: user.id };
      }

      if (data === 'cmd_stock_help') {
        const freshness = player?.stockUpdatedAt ? logic.getStockFreshness(player.stockUpdatedAt) : { label: 'нет данных' };
        const couponsStr = (player?.coupons || 0).toLocaleString('ru-RU');
        const puzzlesStr = (player?.puzzles || 0).toLocaleString('ru-RU');
        const starCouponsStr = (player?.starCoupons || 0).toLocaleString('ru-RU');
        const helpText = `📦 <b>Склад сектора [${logic.escapeHtml(player?.name || '—')}]:</b>\n\n` +
          `• Универсальные купоны: <b>${couponsStr} 🎟️</b>\n` +
          `• Фрагменты офицеров: <b>${puzzlesStr} 🧩</b>\n` +
          `• Звёздные купоны: <b>${starCouponsStr} ⭐</b>\n` +
          `• Давность обновления: <i>${freshness.label}</i>\n\n` +
          `<b>Как обновить остатки склада:</b>\n` +
          `1. 📷 <b>Скриншот склада:</b> просто отправьте фото инвентаря в этот диалог — бот распознает остатки через OCR.\n` +
          `2. ⚡ <b>Текстовая команда:</b> <code>/stock &lt;купоны&gt; &lt;пазлы&gt;</code> (например: <code>/stock 15k 350</code>).\n` +
          (webAppUrl ? `3. 🚀 <b>В приложении:</b> нажмите кнопку ниже для ввода через Mini App.` : '');

        const stockKb = [];
        if (webAppUrl) {
          stockKb.push([{ text: '🚀 Открыть склад в Mini App', web_app: { url: webAppUrl } }]);
        }
        stockKb.push([{ text: '◀️ Главное меню', callback_data: 'cmd_menu' }]);

        if (token) {
          await telegram.sendTelegramMessage({ token, chatId: targetChatId, text: helpText, replyMarkup: { inline_keyboard: stockKb } });
        }
        return { ok: true, action: 'cmd_stock_help', userId: user.id };
      }

      if (data === 'cmd_digest') {
        if (!isStaff) {
          if (token) {
            await telegram.answerTelegramCallback({ token, callbackQueryId: cqId, text: '⛔ Доступ запрещен (только Р4/Р5)', showAlert: true });
          }
          return { ok: true, action: 'cmd_digest', authorized: false };
        }
        const allPlayers = db.getPlayers ? db.getPlayers() : [];
        const freshnessStats = { fresh: 0, warning: 0, stale: 0 };
        allPlayers.forEach(p => {
          const fr = p.stockUpdatedAt ? logic.getStockFreshness(p.stockUpdatedAt) : { status: 'stale' };
          freshnessStats[fr.status] = (freshnessStats[fr.status] || 0) + 1;
        });
        const allEvents = db.getEvents ? db.getEvents() : [];
        const eventTypes = db.getEventTypes ? db.getEventTypes() : [];
        const typesMap = new Map((eventTypes || []).map(t => [t.id, t]));
        const nowIso = new Date().toISOString();
        const nextEv = (allEvents || [])
          .filter(e => !e.dateTo || e.dateTo >= nowIso.slice(0, 10))
          .sort((a, b) => (a.dateFrom || '').localeCompare(b.dateFrom || ''))[0] || null;

        let nextEvInfo = null;
        if (nextEv) {
          const et = typesMap.get(nextEv.typeId);
          const regs = db.getRegistrationsByEventId ? db.getRegistrationsByEventId(nextEv.id) : (nextEv.registrations || []);
          nextEvInfo = {
            title: et?.name || nextEv.title || nextEv.name,
            dateFrom: nextEv.dateFrom,
            assignedCount: (nextEv.assignments || []).length,
            totalPlaces: (et?.places || []).length || 5,
            registrationsCount: regs.length
          };
        }
        const pendingUsers = db.getPendingUsers ? db.getPendingUsers() : [];
        const digestMsg = logic.formatTelegramDigestMessage({
          totalSectors: allPlayers.length,
          freshnessStats,
          nextEvent: nextEvInfo,
          pendingUsersCount: pendingUsers.length
        });
        if (token) {
          await telegram.sendTelegramMessage({ token, chatId: targetChatId, text: digestMsg, replyMarkup: keyboard });
        }
        return { ok: true, action: 'cmd_digest', userId: user.id };
      }

      if (data === 'cmd_stale') {
        if (!isStaff) {
          if (token) {
            await telegram.answerTelegramCallback({ token, callbackQueryId: cqId, text: '⛔ Доступ запрещен (только Р4/Р5)', showAlert: true });
          }
          return { ok: true, action: 'cmd_stale', authorized: false };
        }
        const allPlayers = db.getPlayers ? db.getPlayers() : [];
        const allUsers = db.getUsers ? db.getUsers() : [];
        const usersById = new Map(allUsers.map(u => [u.id, u]));

        const staleList = [];
        allPlayers.forEach(p => {
          const fr = p.stockUpdatedAt ? logic.getStockFreshness(p.stockUpdatedAt) : { status: 'stale', days: 30 };
          if (fr.status === 'stale') {
            const u = p.userId ? usersById.get(p.userId) : null;
            staleList.push({ name: p.name, days: fr.days, username: u?.username || null });
          }
        });
        staleList.sort((a, b) => b.days - a.days);
        const staleMsg = logic.formatTelegramStaleReport({ stalePlayers: staleList });
        if (token) {
          await telegram.sendTelegramMessage({ token, chatId: targetChatId, text: staleMsg, replyMarkup: keyboard });
        }
        return { ok: true, action: 'cmd_stale', userId: user.id };
      }
    }

    const approveMatch = data.match(/^approve_user:(\d+)$/);
    const rejectMatch = data.match(/^reject_user:(\d+)$/);

    if (approveMatch || rejectMatch) {
      const targetUserId = Number((approveMatch || rejectMatch)[1]);
      const isApprove = Boolean(approveMatch);

      const officer = resolveTelegramUser(fromId, cq.from?.username);
      const isStaff = officer && (officer.rank === 'r5' || officer.rank === 'r4' || logic.hasUserPermission(officer, 'approve_users'));

      if (!isStaff) {
        if (token) {
          await telegram.answerTelegramCallback({
            token,
            callbackQueryId: cqId,
            text: '⛔ Доступ запрещен. У вас нет прав офицера для одобрения новичков.',
            showAlert: true
          });
        }
        return { ok: true, authorized: false };
      }

      const targetUser = db.findUserById(targetUserId);
      const targetName = targetUser?.username || `ID ${targetUserId}`;
      const officerHandle = cq.from?.username ? `@${cq.from.username}` : (officer.username || 'Офицер');
      const officerRank = (officer.rank || 'r4').toUpperCase();

      if (isApprove) {
        db.approveUser(targetUserId, 'r3');
        if (token) {
          await telegram.answerTelegramCallback({
            token,
            callbackQueryId: cqId,
            text: '✅ Пользователь одобрен (Р3)'
          });
          if (chatMsg?.chat?.id && chatMsg?.message_id) {
            await telegram.editTelegramMessageText({
              token,
              chatId: chatMsg.chat.id,
              messageId: chatMsg.message_id,
              text: `✅ Пользователь <b>@${targetName}</b> одобрен офицером <b>${officerHandle}</b> (${officerRank})`,
              replyMarkup: { inline_keyboard: [] }
            });
          }
        }
        return { ok: true, action: 'approved', userId: targetUserId };
      } else {
        db.rejectUser(targetUserId);
        if (token) {
          await telegram.answerTelegramCallback({
            token,
            callbackQueryId: cqId,
            text: '❌ Пользователь отклонен'
          });
          if (chatMsg?.chat?.id && chatMsg?.message_id) {
            await telegram.editTelegramMessageText({
              token,
              chatId: chatMsg.chat.id,
              messageId: chatMsg.message_id,
              text: `❌ Пользователь <b>@${targetName}</b> отклонен офицером <b>${officerHandle}</b> (${officerRank})`,
              replyMarkup: { inline_keyboard: [] }
            });
          }
        }
        return { ok: true, action: 'rejected', userId: targetUserId };
      }
    }

    const regMatch = data.match(/^reg_event:(\d+):(\d+)$/);
    if (regMatch) {
      const eventId = Number(regMatch[1]);
      const desiredPlace = Number(regMatch[2]);

      const user = fromId ? resolveTelegramUser(fromId, cq.from?.username) : null;
      if (!user) {
        if (token) {
          await telegram.answerTelegramCallback({
            token,
            callbackQueryId: cqId,
            text: '⚠️ Ваш Telegram не привязан к аккаунту в KoW Tracker.',
            showAlert: true
          });
        }
        return { ok: true, action: 'reg_event', error: 'user_not_bound' };
      }

      const sectors = db.getPlayersByUserId(user.id);
      const player = (user.player_id ? db.getPlayerById(user.player_id) : null) || sectors[0];
      if (!player) {
        if (token) {
          await telegram.answerTelegramCallback({
            token,
            callbackQueryId: cqId,
            text: '⚠️ У вас нет активного сектора в KoW Tracker.',
            showAlert: true
          });
        }
        return { ok: true, action: 'reg_event', error: 'no_player' };
      }

      const ev = db.getEventById(eventId);
      if (!ev) {
        if (token) {
          await telegram.answerTelegramCallback({
            token,
            callbackQueryId: cqId,
            text: '⚠️ Событие не найдено или удалено.',
            showAlert: true
          });
        }
        return { ok: true, action: 'reg_event', error: 'event_not_found' };
      }

      const pOfficers = Array.isArray(player.officers) ? player.officers : [];
      const officer = pOfficers.find(o => !o.onlyPersonalPuzzles) || pOfficers[0];
      const officerId = (officer ? (officer.catalogId || officer.id) : '') || '';

      db.registerForEvent({
        eventId,
        playerId: player.id,
        officerId,
        desiredPlace
      });

      if (token) {
        const placeStr = desiredPlace > 0 ? `#${desiredPlace}` : 'любое подходящее';
        await telegram.answerTelegramCallback({
          token,
          callbackQueryId: cqId,
          text: `✅ Заявка принята! Желаемое место: ${placeStr}`
        });

        if (chatMsg?.chat?.id && chatMsg?.message_id) {
          const et = db.getEventTypeById ? db.getEventTypeById(ev.typeId) : null;
          const reg = db.getUserRegistration ? db.getUserRegistration(eventId, player.id) : null;
          const assign = (ev.assignments || []).find(a => Number(a.playerId) === Number(player?.id));
          const updatedText = logic.formatTelegramEventDetailMessage({ event: ev, eventType: et, registration: reg, assignment: assign });
          const updatedKb = logic.formatEventDetailRegistrationKeyboard({ eventId, eventType: et, registration: reg });
          await telegram.editTelegramMessageText({
            token,
            chatId: chatMsg.chat.id,
            messageId: chatMsg.message_id,
            text: updatedText,
            replyMarkup: updatedKb
          }).catch(() => {});
        }
      }

      return { ok: true, action: 'registered', eventId, desiredPlace, playerId: player.id };
    }

    const unregMatch = data.match(/^unreg_event:(\d+)$/);
    if (unregMatch) {
      const eventId = Number(unregMatch[1]);
      const user = fromId ? resolveTelegramUser(fromId, cq.from?.username) : null;
      if (!user) {
        if (token) {
          await telegram.answerTelegramCallback({
            token,
            callbackQueryId: cqId,
            text: '⚠️ Ваш Telegram не привязан к аккаунту в KoW Tracker.',
            showAlert: true
          });
        }
        return { ok: true, action: 'unreg_event', error: 'user_not_bound' };
      }

      const sectors = db.getPlayersByUserId(user.id);
      const player = (user.player_id ? db.getPlayerById(user.player_id) : null) || sectors[0];
      const ev = db.getEventById(eventId);
      if (!ev) {
        if (token) {
          await telegram.answerTelegramCallback({
            token,
            callbackQueryId: cqId,
            text: '⚠️ Событие не найдено.',
            showAlert: true
          });
        }
        return { ok: true, action: 'unreg_event', error: 'event_not_found' };
      }

      if (player) {
        db.unregisterFromEvent(eventId, player.id);
      }

      if (token) {
        await telegram.answerTelegramCallback({
          token,
          callbackQueryId: cqId,
          text: '❌ Ваша заявка отозвана.'
        });

        if (chatMsg?.chat?.id && chatMsg?.message_id) {
          const et = db.getEventTypeById ? db.getEventTypeById(ev.typeId) : null;
          const assign = (ev.assignments || []).find(a => Number(a.playerId) === Number(player?.id));
          const updatedText = logic.formatTelegramEventDetailMessage({ event: ev, eventType: et, registration: null, assignment: assign });
          const updatedKb = logic.formatEventDetailRegistrationKeyboard({ eventId, eventType: et, registration: null });
          await telegram.editTelegramMessageText({
            token,
            chatId: chatMsg.chat.id,
            messageId: chatMsg.message_id,
            text: updatedText,
            replyMarkup: updatedKb
          }).catch(() => {});
        }
      }

      return { ok: true, action: 'unregistered', eventId, playerId: player?.id };
    }

    const rsvpMatch = data.match(/^rsvp_event:(confirm|decline):(\d+):(\d+)$/);
    if (rsvpMatch) {
      const action = rsvpMatch[1];
      const eventId = Number(rsvpMatch[2]);
      const placeNum = Number(rsvpMatch[3]);

      const user = resolveTelegramUser(fromId, cq.from?.username);
      if (!user) {
        if (token) {
          await telegram.answerTelegramCallback({
            token,
            callbackQueryId: cqId,
            text: '⚠️ Ваш Telegram не привязан к аккаунту в KoW Tracker.',
            showAlert: true
          });
        }
        return { ok: true, error: 'user_not_bound' };
      }

      const ev = db.getEventById(eventId);
      if (!ev) {
        if (token) {
          await telegram.answerTelegramCallback({
            token,
            callbackQueryId: cqId,
            text: '⚠️ Событие не найдено или удалено.',
            showAlert: true
          });
        }
        return { ok: true, error: 'event_not_found' };
      }

      const assignment = (ev.assignments || []).find(a => Number(a.place) === placeNum);
      if (!assignment) {
        if (token) {
          await telegram.answerTelegramCallback({
            token,
            callbackQueryId: cqId,
            text: '⚠️ Назначение на это место не найдено.',
            showAlert: true
          });
        }
        return { ok: true, error: 'assignment_not_found' };
      }

      const player = db.getPlayerById(assignment.playerId);
      const isOwner = player && player.userId === user.id;
      const isStaff = user.rank === 'r4' || user.rank === 'r5';

      if (!isOwner && !isStaff) {
        if (token) {
          await telegram.answerTelegramCallback({
            token,
            callbackQueryId: cqId,
            text: '⛔ Вы не назначены на это призовое место.',
            showAlert: true
          });
        }
        return { ok: true, error: 'unauthorized_assignment' };
      }

      const isConfirm = action === 'confirm';
      assignment.rsvpStatus = isConfirm ? 'confirmed' : 'declined';
      assignment.rsvpAt = new Date().toISOString();
      db.saveEvent(ev);

      if (token) {
        await telegram.answerTelegramCallback({
          token,
          callbackQueryId: cqId,
          text: isConfirm ? '✅ Участие подтверждено!' : '❌ Вы отказались от участия. Место освобождено.'
        });

        if (chatMsg?.chat?.id && chatMsg?.message_id) {
          const statusText = isConfirm
            ? '\n\n<b>Статус: ✅ Участие подтверждено</b>'
            : '\n\n<b>Статус: ❌ Отказ от участия (место освобождено)</b>';
          const originalText = chatMsg.text || '';
          await telegram.editTelegramMessageText({
            token,
            chatId: chatMsg.chat.id,
            messageId: chatMsg.message_id,
            text: originalText + statusText,
            replyMarkup: { inline_keyboard: [] }
          }).catch(() => {});
        }
      }

      if (!isConfirm) {
        const et = db.getEventTypes().find(t => t.id === ev.typeId);
        let staffChatId = db.getAppSetting('telegram_staff_chat_id');
        if (staffChatId && token) {
          if (!isNaN(Number(staffChatId))) staffChatId = Number(staffChatId);
          const staffAlertText = `⚠️ <b>Отказ от участия в событии!</b>\n\nБоец: <b>@${user.username || 'боец'}</b>\nСектор: <b>${player?.name || 'Сектор'}</b>\nСобытие: <b>${et?.name || 'Событие'}</b>\nОсвобождено место: <b>#${placeNum}</b>\n\n<i>Место свободно для повторного распределения или резервиста!</i>`;
          await telegram.sendTelegramMessage({
            token,
            chatId: staffChatId,
            text: staffAlertText,
            parseMode: 'HTML'
          }).catch(() => {});
        }
      }

      return { ok: true, action: isConfirm ? 'confirmed' : 'declined', eventId, place: placeNum };
    }

    const resultMatch = data.match(/^event_result:submit:(\d+):(\d+)$/);
    if (resultMatch) {
      const eventId = Number(resultMatch[1]);
      const actualPlace = Number(resultMatch[2]);

      const user = resolveTelegramUser(fromId, cq.from?.username);
      if (!user) {
        if (token) {
          await telegram.answerTelegramCallback({
            token,
            callbackQueryId: cqId,
            text: '⚠️ Ваш Telegram не привязан к аккаунту в KoW Tracker.',
            showAlert: true
          });
        }
        return { ok: true, error: 'user_not_bound' };
      }

      const ev = db.getEventById(eventId);
      if (!ev) {
        if (token) {
          await telegram.answerTelegramCallback({
            token,
            callbackQueryId: cqId,
            text: '⚠️ Событие не найдено.',
            showAlert: true
          });
        }
        return { ok: true, error: 'event_not_found' };
      }

      const assignment = (ev.assignments || []).find(a => {
        const p = db.getPlayerById(a.playerId);
        return p && p.userId === user.id;
      });

      if (!assignment) {
        if (token) {
          await telegram.answerTelegramCallback({
            token,
            callbackQueryId: cqId,
            text: '⛔ Вы не являетесь участником этого события.',
            showAlert: true
          });
        }
        return { ok: true, error: 'not_participant' };
      }

      if (assignment.accrued) {
        if (token) {
          await telegram.answerTelegramCallback({
            token,
            callbackQueryId: cqId,
            text: 'ℹ️ Результат и награды уже зафиксированы ранее.',
            showAlert: true
          });
        }
        return { ok: true, error: 'already_accrued' };
      }

      const player = db.getPlayerById(assignment.playerId);
      const et = db.getEventTypes().find(t => t.id === ev.typeId);
      const places = et ? (typeof logic.resolveEventPlaces === 'function' ? logic.resolveEventPlaces(et, ev.dateFrom) : et.places) : [];
      const placeInfo = actualPlace > 0 ? places.find(p => Number(p.place) === actualPlace) : null;
      const prizeCoupons = placeInfo ? (Number(placeInfo.coupons) || 0) : 0;

      assignment.actualPlace = actualPlace;
      assignment.actualCoupons = prizeCoupons;
      assignment.resultStatus = 'confirmed';
      assignment.accrued = true;
      assignment.resultSubmittedAt = new Date().toISOString();
      assignment.submittedBy = 'telegram';

      if (player && prizeCoupons > 0) {
        const curStock = player.stock || {};
        const oldCoupons = Number(curStock.coupons) || 0;
        const newStock = { ...curStock, coupons: oldCoupons + prizeCoupons };
        db.updatePlayer(player.id, { stock: newStock });
        db.recordStockHistory({
          playerId: player.id,
          userId: user.id,
          source: 'event_reward',
          snapshotBefore: curStock,
          snapshotAfter: newStock,
          diffSummary: `Награда за событие ${et?.name || 'ивент'}: +${prizeCoupons} купонов (место #${actualPlace})`,
          screenshotPath: null,
          createdAt: new Date().toISOString()
        });
      }

      db.saveEvent(ev);

      if (token) {
        const callbackMsg = actualPlace > 0
          ? `✅ Место #${actualPlace} зафиксировано! Начислено +${prizeCoupons} купонов на склад 🎟️`
          : `✅ Результат зафиксирован (без наград).`;
        await telegram.answerTelegramCallback({
          token,
          callbackQueryId: cqId,
          text: callbackMsg
        });

        if (chatMsg?.chat?.id && chatMsg?.message_id) {
          const appendMsg = actualPlace > 0
            ? `\n\n<b>Результат: место #${actualPlace} (+${prizeCoupons} купонов начислено на склад 🎟️)</b>`
            : `\n\n<b>Результат: не участвовал</b>`;
          await telegram.editTelegramMessageText({
            token,
            chatId: chatMsg.chat.id,
            messageId: chatMsg.message_id,
            text: (chatMsg.text || '') + appendMsg,
            replyMarkup: { inline_keyboard: [] }
          }).catch(() => {});
        }
      }

      return { ok: true, action: 'result_submitted', eventId, actualPlace, prizeCoupons };
    }

    const confirmOcrMatch = data.match(/^confirm_ocr_stock:(\d+)$/);
    if (confirmOcrMatch) {
      const historyId = Number(confirmOcrMatch[1]);
      const user = fromId ? resolveTelegramUser(fromId, cq.from?.username) : null;
      if (!user) {
        if (token) {
          await telegram.answerTelegramCallback({
            token,
            callbackQueryId: cqId,
            text: '⚠️ Ваш Telegram не привязан к аккаунту в KoW Tracker.',
            showAlert: true
          });
        }
        return { ok: true, action: 'confirm_ocr_stock', error: 'user_not_bound' };
      }

      const rec = db.getStockHistoryRecordById(historyId);
      if (!rec) {
        if (token) {
          await telegram.answerTelegramCallback({
            token,
            callbackQueryId: cqId,
            text: '⚠️ Запись распознавания не найдена или устарела.',
            showAlert: true
          });
        }
        return { ok: true, action: 'confirm_ocr_stock', error: 'record_not_found' };
      }

      const isStaff = user.rank === 'r5' || user.rank === 'r4';
      if (rec.userId !== user.id && !isStaff) {
        if (token) {
          await telegram.answerTelegramCallback({
            token,
            callbackQueryId: cqId,
            text: '⛔ Вы можете подтверждать остатки только для своего сектора.',
            showAlert: true
          });
        }
        return { ok: true, action: 'confirm_ocr_stock', error: 'forbidden' };
      }

      const player = db.getPlayerById(rec.playerId);
      if (!player) {
        if (token) {
          await telegram.answerTelegramCallback({
            token,
            callbackQueryId: cqId,
            text: '⚠️ Сектор не найден.',
            showAlert: true
          });
        }
        return { ok: true, action: 'confirm_ocr_stock', error: 'player_not_found' };
      }

      const now = new Date().toISOString();
      const diff = logic.calculateStockDiff(rec.snapshotBefore, rec.snapshotAfter);

      db.updatePlayer(player.id, {
        stock: rec.snapshotAfter,
        stockUpdatedAt: now,
        stockUpdateSource: 'telegram_photo',
        recordHistory: false
      });

      db.updateStockHistoryRecord(rec.id, {
        diffSummary: `${diff.summary} (подтверждено по OCR)`
      });

      if (token) {
        await telegram.answerTelegramCallback({
          token,
          callbackQueryId: cqId,
          text: '✅ Изменения склада успешно применены!'
        });

        if (chatMsg?.chat?.id && chatMsg?.message_id) {
          const successMsg = logic.formatStockUpdateSuccessMessage(diff, rec.snapshotAfter, {
            sectorName: player.name
          });
          await telegram.editTelegramMessageText({
            token,
            chatId: chatMsg.chat.id,
            messageId: chatMsg.message_id,
            text: successMsg,
            replyMarkup: { inline_keyboard: [] }
          }).catch(() => {});
        }
      }

      return { ok: true, action: 'confirm_ocr_stock', historyId, playerId: player.id, stock: rec.snapshotAfter };
    }

    if (data === 'confirm_current_stock') {
      const user = fromId ? resolveTelegramUser(fromId, cq.from?.username) : null;
      if (!user) {
        if (token) {
          await telegram.answerTelegramCallback({
            token,
            callbackQueryId: cqId,
            text: '⚠️ Ваш Telegram не привязан к аккаунту в KoW Tracker.',
            showAlert: true
          });
        }
        return { ok: true, action: 'confirm_current_stock', error: 'user_not_bound' };
      }

      const sectors = db.getPlayersByUserId(user.id);
      const player = (user.player_id ? db.getPlayerById(user.player_id) : null) || sectors[0];
      if (!player) {
        if (token) {
          await telegram.answerTelegramCallback({
            token,
            callbackQueryId: cqId,
            text: '⚠️ Сектор не найден.',
            showAlert: true
          });
        }
        return { ok: true, action: 'confirm_current_stock', error: 'no_player' };
      }

      db.confirmPlayerStock(player.id, user.id, 'manual_confirm');

      if (token) {
        await telegram.answerTelegramCallback({
          token,
          callbackQueryId: cqId,
          text: '✅ Склад подтвержден как актуальный!'
        });

        if (chatMsg?.chat?.id && chatMsg?.message_id) {
          const nowFormatted = new Date().toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
          const confirmedText = `✅ <b>Склад подтвержден как актуальный!</b>\n` +
            `👤 Сектор: <b>${logic.escapeHtml(player.name)}</b>\n` +
            `📅 Дата актуальности: <b>${nowFormatted}</b>\n\n` +
            `<i>Остатки в базе данных не изменялись, таймер устаревания сброшен.</i>`;

          await telegram.editTelegramMessageText({
            token,
            chatId: chatMsg.chat.id,
            messageId: chatMsg.message_id,
            text: confirmedText,
            replyMarkup: { inline_keyboard: [] }
          }).catch(() => {});
        }
      }

      return { ok: true, action: 'confirm_current_stock', playerId: player.id };
    }
  }

  return { ok: true };
}

async function syncTelegramBotInfoAndPolling() {
  const token = db.getAppSetting('telegram_bot_token');
  if (!token) {
    telegram.stopTelegramPolling();
    return;
  }

  try {
    const meRes = await telegram.getTelegramMe(token);
    if (meRes.ok && meRes.result && meRes.result.username) {
      const liveUsername = meRes.result.username.replace(/^@+/, '');
      const existingUsername = db.getAppSetting('telegram_bot_username');
      if (!existingUsername || existingUsername !== liveUsername) {
        db.setAppSetting('telegram_bot_username', liveUsername);
      }
    }

    const webAppUrl = db.getAppSetting('telegram_webapp_url') || db.getAppSetting('app_base_url');
    if (webAppUrl) {
      telegram.setTelegramChatMenuButton(token, {
        text: 'KoW Tracker',
        url: webAppUrl
      }).catch(err => {
        console.warn('[Telegram] Could not set chat menu button:', err.message);
      });
    }
  } catch (err) {
    console.warn('[Telegram] Could not sync bot info:', err.message);
  }

  telegram.startTelegramPolling({
    getBotToken: () => db.getAppSetting('telegram_bot_token'),
    getProxyUrl: () => telegram.getDefaultProxyUrl(),
    onUpdate: async (update) => {
      await handleTelegramUpdate(update);
    },
    onError: (err) => {
      console.warn('[Telegram Polling] Warning:', err.message || err);
    }
  });
}

const FORBIDDEN_FILES = new Set([
  'package.json',
  'package-lock.json',
  'server.js',
  'db.js',
  's3.js',
  'dockerfile',
  'docker-compose.yml',
  'readme.md'
]);

function isForbiddenFile(basename) {
  const lower = basename.toLowerCase();
  if (lower.startsWith('.')) return true;
  if (lower.endsWith('.db') || lower.endsWith('.test.js') || lower.endsWith('.md')) return true;
  return FORBIDDEN_FILES.has(lower);
}

function serveStaticFile(req, res, staticDir, pathname) {
  const rawUrl = req.url || '';
  if (rawUrl.includes('..') || rawUrl.includes('%2e%2e') || rawUrl.includes('%2E%2E')) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Forbidden');
  }

  const safeBase = path.resolve(staticDir);
  const relativePath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const targetPath = path.resolve(safeBase, relativePath);

  // Path traversal protection
  if (!targetPath.startsWith(safeBase)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Forbidden');
  }

  // Prevent serving sensitive backend files
  if (isForbiddenFile(path.basename(targetPath))) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Forbidden');
  }

  fs.stat(targetPath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Not Found');
    }

    const ext = path.extname(targetPath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    const headers = {
      'Content-Type': contentType,
      'Content-Length': stats.size
    };

    if (pathname === '/sw.js') {
      headers['Content-Type'] = 'application/javascript; charset=UTF-8';
      headers['Service-Worker-Allowed'] = '/';
      headers['Cache-Control'] = 'no-cache, no-store, must-revalidate';
    } else if (pathname === '/manifest.json') {
      headers['Content-Type'] = 'application/manifest+json; charset=UTF-8';
    }

    res.writeHead(200, headers);

    if (req.method === 'HEAD') {
      return res.end();
    }

    const stream = fs.createReadStream(targetPath);
    stream.pipe(res);
  });
}

// Sliding in-memory cache for deduplicating rapid duplicate event creation requests (double-clicks / retries)
const recentCreatedEventsCache = [];

function getRecentCreatedEvent(dedupeKey, ttlMs = 5000) {
  const now = Date.now();
  while (recentCreatedEventsCache.length > 0 && (now - recentCreatedEventsCache[0].timestamp > 15000)) {
    recentCreatedEventsCache.shift();
  }
  const found = recentCreatedEventsCache.find(r => r.key === dedupeKey && (now - r.timestamp < ttlMs));
  if (!found || !found.saved || !found.saved.id) return null;
  try {
    const existingInDb = db.getEventById(Number(found.saved.id));
    if (!existingInDb) return null;
  } catch (e) {
    return null;
  }
  return found;
}

function recordRecentCreatedEvent(dedupeKey, saved) {
  recentCreatedEventsCache.push({ key: dedupeKey, saved, timestamp: Date.now() });
}

function createRequestHandler(staticDir, s3Manager = null) {
  return async (req, res) => {
    try {
      // Automatic S3 synchronization for mutating API requests
      if (s3Manager && s3Manager.getStatus().enabled) {
        res.on('finish', () => {
          if (
            res.statusCode >= 200 &&
            res.statusCode < 400 &&
            ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)
          ) {
            const pathName = req.url ? req.url.split('?')[0] : '';
            if (pathName !== '/api/admin/s3-sync') {
              s3Manager.pushDebounced();
            }
          }
        });
      }

      // CORS Preflight
      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization'
        });
        return res.end();
      }

      const parsedUrl = new URL(req.url, 'http://localhost');
      const pathname = parsedUrl.pathname;

      // Attach user from token if present
      authenticate(req);

      // Non-API routes -> Static files
      if (!pathname.startsWith('/api/')) {
        if (req.method === 'GET' || req.method === 'HEAD') {
          return serveStaticFile(req, res, staticDir, pathname);
        }
        res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end('Method Not Allowed');
      }

      // Parse body for write operations
      let body = {};
      if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
        try {
          body = await readJsonBody(req);
        } catch (err) {
          return sendError(res, 400, 'INVALID_JSON', 'Некорректный JSON в теле запроса');
        }
      }

      // ─────────────────────────────────────────────────────────
      // AUTH & SYSTEM ENDPOINTS
      // ─────────────────────────────────────────────────────────
      if (pathname === '/api/version' && req.method === 'GET') {
        return sendJson(res, 200, { version: APP_VERSION });
      }

      if (pathname === '/api/auth/status' && req.method === 'GET') {
        const isDefault = db.isDefaultAdminPassword();
        return sendJson(res, 200, {
          hasDefaultAdminPassword: isDefault,
          demoAccessEnabled: isDefault
        });
      }

      if (pathname === '/api/auth/candidate-players' && req.method === 'GET') {
        return sendJson(res, 200, db.getCandidatePlayers());
      }

      if (pathname === '/api/auth/register' && req.method === 'POST') {
        const { username, password, playerId, playerName } = body;
        if (!username || !password) {
          return sendError(res, 400, 'MISSING_FIELDS', 'Логин и пароль обязательны');
        }
        const regRes = db.registerUser({ username, password, playerId, playerName });
        if (regRes.error) {
          return sendError(res, 400, regRes.error, regRes.message || 'Ошибка при регистрации');
        }

        if (regRes.pendingApproval || !regRes.is_approved) {
          try {
            let sectorName = playerName || 'Не привязан';
            let power = '0';
            let vip = '0';
            const targetPlayerId = regRes.playerId || playerId;
            if (targetPlayerId) {
              const p = db.getPlayerById(targetPlayerId);
              if (p) {
                sectorName = p.name || sectorName;
                vip = p.vip !== undefined ? String(p.vip) : '0';
                const rawPower = Number(p.power) || 0;
                if (rawPower >= 1000000) {
                  power = (rawPower / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
                } else if (rawPower >= 1000) {
                  power = (rawPower / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
                } else {
                  power = String(rawPower);
                }
              }
            }

            const baseUrl = getAppBaseUrl(req);
            await dispatchNotification('staff_new_user_pending', {
              username,
              sectorName,
              power,
              vip,
              link: `${baseUrl}/#pending`
            }, {
              replyMarkup: {
                inline_keyboard: [
                  [
                    { text: '🛡️ Одобрить (Р3)', callback_data: `approve_user:${regRes.userId}` },
                    { text: '❌ Отклонить', callback_data: `reject_user:${regRes.userId}` }
                  ]
                ]
              }
            }).catch(err => {
              console.warn('[Notification] Error dispatching staff_new_user_pending:', err.message);
            });
          } catch (notifErr) {
            console.warn('[Notification] Error preparing staff_new_user_pending:', notifErr.message);
          }
        }

        return sendJson(res, 200, {
          success: true,
          pendingApproval: regRes.pendingApproval,
          userId: regRes.userId,
          is_approved: regRes.is_approved
        });
      }

    if (pathname === '/api/auth/telegram-webapp' && req.method === 'POST') {
      const botToken = db.getAppSetting('telegram_bot_token');
      if (!botToken) {
        return sendError(res, 503, 'BOT_NOT_CONFIGURED', 'Токен Telegram-бота не настроен на сервере');
      }

      const initData = body && (body.initData || body.init_data);
      if (!initData || typeof initData !== 'string') {
        return sendError(res, 400, 'VALIDATION_ERROR', 'Параметр initData обязателен');
      }

      const validation = logic.validateTelegramWebAppData(initData, botToken);
      if (!validation.valid) {
        return sendError(res, 401, 'INVALID_TELEGRAM_DATA', `Ошибка валидации Telegram WebApp: ${validation.error}`);
      }

      const tgUserId = validation.user?.id;
      if (!tgUserId) {
        return sendError(res, 400, 'MISSING_TELEGRAM_USER', 'Не найден объект пользователя Telegram в initData');
      }

      let user = db.findUserByTelegramChatId(tgUserId);
      if (!user && validation.user?.username) {
        const matched = db.findUserByTelegramUsername(validation.user.username);
        if (matched && (!matched.telegram_chat_id || String(matched.telegram_chat_id) !== String(tgUserId))) {
          db.bindUserTelegram(matched.id, tgUserId, validation.user.username);
          user = (typeof db.getUserById === 'function') ? db.getUserById(matched.id) : matched;
        }
      }
      if (!user) {
        return sendError(res, 404, 'USER_NOT_BOUND', 'Пользователь с данным Telegram ID не найден в KoW Tracker. Привяжите Telegram в личном кабинете.');
      }

      if (user.is_approved === 0) {
        return sendError(res, 403, 'PENDING_APPROVAL', 'Ваш аккаунт ожидает подтверждения офицером');
      }

      if (user.is_active === 0) {
        return sendError(res, 403, 'ACCOUNT_BLOCKED', 'Ваш аккаунт заблокирован администрацией');
      }

      const sessionToken = db.createSession(user.id);
      db.touchUserActive(user.id);

      const cookieHeader = `token=${encodeURIComponent(sessionToken)}; HttpOnly; SameSite=Lax; Path=/`;
      res.setHeader('Set-Cookie', cookieHeader);

      const player = user.player_id ? db.getPlayerById(user.player_id) : (db.getPlayersByUserId(user.id)[0] || null);

      return sendJson(res, 200, {
        success: true,
        token: sessionToken,
        user: {
          id: user.id,
          username: user.username,
          rank: user.rank,
          playerId: user.player_id || (player ? player.id : null),
          permissions: user.permissions || [],
          telegramChatId: user.telegram_chat_id || null,
          telegramUsername: user.telegram_username || null,
          hasDefaultAdminPassword: user.username === 'admin' ? db.isDefaultAdminPassword() : false
        },
        player,
        telegramUser: validation.user
      });
    }

    if (pathname === '/api/auth/login' && req.method === 'POST') {
      const { username, password } = body;
      if (!username || !password) {
        return sendError(res, 400, 'MISSING_FIELDS', 'Логин и пароль обязательны');
      }
      const loginRes = db.loginUser(username, password);
      if (loginRes.error === 'ACCOUNT_BLOCKED') {
        return sendError(res, 403, 'ACCOUNT_BLOCKED', 'Доступ к аккаунту заблокирован руководством гильдии');
      }
      if (loginRes.error === 'PENDING_APPROVAL') {
        return sendError(res, 403, 'PENDING_APPROVAL', 'Аккаунт ожидает подтверждения Главой (Р5) или Чиновником (Р4)');
      }
      if (loginRes.error) {
        return sendError(res, 401, loginRes.error, 'Неверный логин или пароль');
      }
      return sendJson(res, 200, {
        token: loginRes.token,
        user: {
          ...loginRes.user,
          hasDefaultAdminPassword: loginRes.user.username === 'admin' ? db.isDefaultAdminPassword() : false
        }
      });
    }

    if (pathname === '/api/auth/logout' && req.method === 'POST') {
      if (!requireAuth(req, res)) return;
      if (req.token) {
        db.deleteSession(req.token);
      }
      return sendJson(res, 200, { success: true });
    }

    if (pathname === '/api/auth/me' && req.method === 'GET') {
      if (!requireAuth(req, res)) return;
      const player = req.user.playerId ? db.getPlayerById(req.user.playerId) : null;
      return sendJson(res, 200, {
        user: {
          ...req.user,
          hasDefaultAdminPassword: req.user.username === 'admin' ? db.isDefaultAdminPassword() : false
        },
        player
      });
    }

    if (pathname === '/api/auth/change-password' && req.method === 'POST') {
      if (!requireAuth(req, res)) return;
      const { newPassword, oldPassword } = body;
      if (!newPassword) {
        return sendError(res, 400, 'MISSING_PASSWORD', 'Новый пароль обязателен');
      }
      if (oldPassword) {
        const u = db.findUserById(req.user.id);
        if (!u || !db.verifyPassword(oldPassword, u.password_hash)) {
          return sendError(res, 400, 'INVALID_PASSWORD', 'Текущий пароль неверен');
        }
      }
      db.changePassword(req.user.id, newPassword);
      return sendJson(res, 200, { success: true });
    }

    // ─────────────────────────────────────────────────────────
    // USER APPROVALS & USERS (R4, R5)
    // ─────────────────────────────────────────────────────────
    if (pathname === '/api/users/pending' && req.method === 'GET') {
      if (!requirePermission(req, res, 'approve_users')) return;
      return sendJson(res, 200, db.getPendingUsers());
    }

    const approveMatch = pathname.match(/^\/api\/users\/(\d+)\/approve$/);
    if (approveMatch && req.method === 'POST') {
      if (!requirePermission(req, res, 'approve_users')) return;
      const targetUserId = Number(approveMatch[1]);
      let rank = body.rank === 'r4' ? 'r4' : 'r3';
      if (req.user.rank !== 'r5' && body.rank && body.rank !== 'r3') {
        return sendJson(res, 403, { error: 'Только глава альянса (Р5) может назначать ранг выше Р3' });
      }
      if (req.user.rank === 'r5' && ['r3', 'r4'].includes(body.rank)) {
        rank = body.rank;
      }
      const updatedUser = db.approveUser(targetUserId, rank);
      return sendJson(res, 200, { success: true, user: updatedUser });
    }

    const rejectMatch = pathname.match(/^\/api\/users\/(\d+)\/reject$/);
    if (rejectMatch && req.method === 'POST') {
      if (!requirePermission(req, res, 'approve_users')) return;
      const targetUserId = Number(rejectMatch[1]);
      db.rejectUser(targetUserId);
      return sendJson(res, 200, { success: true });
    }

    if (pathname === '/api/users' && req.method === 'GET') {
      if (!requireRole(['r4', 'r5'])(req, res)) return;
      return sendJson(res, 200, db.getUsers());
    }

    const userPatchMatch = pathname.match(/^\/api\/users\/(\d+)$/);
    if (userPatchMatch && req.method === 'PATCH') {
      if (!requireRole(['r5'])(req, res)) return;
      const targetUserId = Number(userPatchMatch[1]);
      if (body.password) {
        db.changePassword(targetUserId, body.password);
      }
      const updated = db.updateUser(targetUserId, body);
      if (body.rank && updated && updated.player_id) {
        db.updatePlayer(updated.player_id, { rank: body.rank });
      }
      return sendJson(res, 200, { success: true, user: updated });
    }

    const userBlockMatch = pathname.match(/^\/api\/users\/(\d+)\/block$/);
    if (userBlockMatch && req.method === 'POST') {
      if (!requireRole(['r5'])(req, res)) return;
      const targetUserId = Number(userBlockMatch[1]);
      if (targetUserId === req.user.id) {
        return sendError(res, 400, 'SELF_BLOCK_FORBIDDEN', 'Вы не можете заблокировать собственный аккаунт');
      }
      const targetUser = db.findUserById(targetUserId);
      if (!targetUser) {
        return sendError(res, 404, 'USER_NOT_FOUND', 'Пользователь не найден');
      }
      const isBlocked = body && body.blocked !== undefined ? Boolean(body.blocked) : true;
      const updated = db.blockUser(targetUserId, isBlocked);
      return sendJson(res, 200, { success: true, user: updated });
    }

    const userDeleteMatch = pathname.match(/^\/api\/users\/(\d+)$/);
    if (userDeleteMatch && req.method === 'DELETE') {
      if (!requireRole(['r5'])(req, res)) return;
      const targetUserId = Number(userDeleteMatch[1]);
      if (targetUserId === req.user.id) {
        return sendError(res, 400, 'SELF_DELETE_FORBIDDEN', 'Вы не можете удалить собственный аккаунт');
      }
      const targetUser = db.findUserById(targetUserId);
      if (!targetUser) {
        return sendError(res, 404, 'USER_NOT_FOUND', 'Пользователь не найден');
      }
      if (targetUser.username === 'admin') {
        return sendError(res, 400, 'ADMIN_DELETE_FORBIDDEN', 'Главного администратора (admin) нельзя удалить');
      }
      const deleteSectors = Boolean(body && body.deleteSectors);
      const result = db.deleteUser(targetUserId, { deleteSectors });
      return sendJson(res, 200, result);
    }

    // ─────────────────────────────────────────────────────────
    // PLAYER CABINET & SECTORS (/api/my-profile, /api/my-sectors)
    // ─────────────────────────────────────────────────────────
    function resolveUserPlayerId(req) {
      if (req.user && req.user.playerId) return req.user.playerId;
      if (!req.user || !req.user.id) return null;
      const sectors = db.getPlayersByUserId(req.user.id);
      if (sectors && sectors.length > 0) {
        req.user.playerId = sectors[0].id;
        db.setUserActiveSector(req.user.id, sectors[0].id);
        return req.user.playerId;
      }
      return null;
    }

    if (pathname === '/api/my-profile' && req.method === 'GET') {
      if (!requireAuth(req, res)) return;
      let sectors = db.getPlayersByUserId(req.user.id);
      let activeSector = null;
      const requestedSectorId = parsedUrl.searchParams.get('sectorId')
        ? Number(parsedUrl.searchParams.get('sectorId'))
        : null;

      if (requestedSectorId && sectors.some(s => s.id === requestedSectorId)) {
        activeSector = sectors.find(s => s.id === requestedSectorId);
      } else if (req.user.playerId && sectors.some(s => s.id === req.user.playerId)) {
        activeSector = sectors.find(s => s.id === req.user.playerId);
      } else if (sectors.length > 0) {
        activeSector = sectors[0];
      }

      if (activeSector && req.user.playerId !== activeSector.id) {
        req.user.playerId = activeSector.id;
        db.setUserActiveSector(req.user.id, activeSector.id);
      }

      return sendJson(res, 200, {
        ...(activeSector ? activeSector : {}),
        user: {
          id: req.user.id,
          username: req.user.username,
          rank: req.user.rank,
          permissions: Array.isArray(req.user.permissions) ? req.user.permissions : [],
          telegram_chat_id: req.user.telegram_chat_id,
          telegram_username: req.user.telegram_username,
          telegram_notifications_enabled: req.user.telegram_notifications_enabled !== 0,
          telegramChatId: req.user.telegram_chat_id,
          telegramUsername: req.user.telegram_username,
          telegramNotificationsEnabled: req.user.telegram_notifications_enabled !== 0,
          timezone: req.user.timezone || 'Europe/Moscow',
          timezoneOffset: (req.user.timezoneOffset !== undefined && req.user.timezoneOffset !== null) ? Number(req.user.timezoneOffset) : 3
        },
        sectors,
        activeSectorId: activeSector ? activeSector.id : null,
        sector: activeSector ? activeSector.sector : null,
        stock: activeSector ? activeSector.stock : null,
        officers: activeSector ? (activeSector.officers || []) : []
      });
    }

    if (pathname === '/api/my-profile/timezone' && req.method === 'PUT') {
      if (!requireAuth(req, res)) return;
      const timezone = body.timezone ? String(body.timezone).trim() : 'Europe/Moscow';
      const timezoneOffset = body.timezoneOffset !== undefined && body.timezoneOffset !== null
        ? Number(body.timezoneOffset)
        : (body.timezone_offset !== undefined && body.timezone_offset !== null ? Number(body.timezone_offset) : 3);

      if (isNaN(timezoneOffset) || timezoneOffset < -12 || timezoneOffset > 14) {
        return sendError(res, 400, 'INVALID_TIMEZONE_OFFSET', 'Смещение часового пояса должно быть от -12 до +14');
      }

      db.updateUserTimezone(req.user.id, { timezone, timezoneOffset });
      req.user.timezone = timezone;
      req.user.timezoneOffset = timezoneOffset;
      return sendJson(res, 200, {
        success: true,
        timezone,
        timezoneOffset
      });
    }

    if (pathname === '/api/my-profile/active-sector' && req.method === 'POST') {
      if (!requireAuth(req, res)) return;
      const sectorId = Number(body.sectorId);
      if (!sectorId) {
        return sendError(res, 400, 'VALIDATION_ERROR', 'Укажите ID сектора');
      }
      const result = db.setUserActiveSector(req.user.id, sectorId);
      if (!result.ok) {
        return sendError(res, 403, 'FORBIDDEN', 'Вы не являетесь владельцем этого сектора');
      }
      req.user.playerId = sectorId;
      return sendJson(res, 200, { success: true, activeSectorId: sectorId });
    }

    if (pathname === '/api/my-sectors' && req.method === 'POST') {
      if (!requireAuth(req, res)) return;
      if (!body.name || !body.name.trim()) {
        return sendError(res, 400, 'VALIDATION_ERROR', 'Укажите название сектора');
      }
      if (body.sector && body.sector.vipPoints !== undefined) {
        body.sector.vipPoints = sanitizeVipPoints(body.sector.vipPoints);
      }
      if (body.vipPoints !== undefined) {
        body.vipPoints = sanitizeVipPoints(body.vipPoints);
      }
      if (body.stock) {
        sanitizeStock(body.stock);
      }
      const created = db.createPlayer({
        ...body,
        name: body.name.trim(),
        userId: req.user.id,
        rank: req.user.rank === 'r4' || req.user.rank === 'r5' ? (body.rank || 'r3') : 'r3'
      });

      const currentUser = db.findUserById(req.user.id);
      if (!currentUser || !currentUser.player_id) {
        db.setUserActiveSector(req.user.id, created.id);
        req.user.playerId = created.id;
      }
      return sendJson(res, 201, created);
    }

    if (pathname === '/api/my-profile' && req.method === 'PUT') {
      if (!requireAuth(req, res)) return;
      const activePlayerId = resolveUserPlayerId(req);
      if (!activePlayerId) {
        return sendError(res, 404, 'NO_LINKED_PLAYER', 'К вашему аккаунту не привязан профиль игрока');
      }
      delete body.rank;
      delete body.id;

      if (body.sector && body.sector.vipPoints !== undefined) {
        body.sector.vipPoints = sanitizeVipPoints(body.sector.vipPoints);
      }
      if (body.vipPoints !== undefined) {
        body.vipPoints = sanitizeVipPoints(body.vipPoints);
      }
      if (body.stock) {
        sanitizeStock(body.stock);
      }

      if (body.telegramNotificationsEnabled !== undefined || body.telegram_notifications_enabled !== undefined) {
        const en = (body.telegramNotificationsEnabled ?? body.telegram_notifications_enabled) !== false;
        db.toggleTelegramNotifications(req.user.id, en);
      }

      if (Array.isArray(body.officers)) {
        for (const o of body.officers) {
          if (o.skills !== undefined) {
            o.skills = sanitizeSkills(o.skills);
          }
          if (o.invested !== undefined) {
            o.invested = sanitizeInvested(o.invested);
          }
          if (o.personalPuzzles !== undefined || o.personal_puzzles !== undefined) {
            o.personalPuzzles = sanitizePersonalPuzzles(o.personalPuzzles ?? o.personal_puzzles);
          }
          if (o.onlyPersonalPuzzles !== undefined || o.only_personal_puzzles !== undefined) {
            o.onlyPersonalPuzzles = Boolean(o.onlyPersonalPuzzles ?? o.only_personal_puzzles);
          }
          if (o.id) {
            const updatedOff = db.updatePlayerOfficer(activePlayerId, o.id, o);
            if (!updatedOff) {
              db.addPlayerOfficer(activePlayerId, o);
            }
          } else {
            db.addPlayerOfficer(activePlayerId, o);
          }
        }
      }

      const updated = db.updatePlayer(activePlayerId, { ...body, editorUserId: req.user.id });
      if (body.stock) {
        db.recordStockHistory(activePlayerId, body.stock);
      }
      return sendJson(res, 200, updated);
    }

    if (pathname === '/api/my-profile/confirm-stock' && req.method === 'POST') {
      if (!requireAuth(req, res)) return;
      const activePlayerId = resolveUserPlayerId(req);
      if (!activePlayerId) {
        return sendError(res, 404, 'NO_LINKED_PLAYER', 'К вашему аккаунту не привязан сектор');
      }
      const updated = db.confirmPlayerStock(activePlayerId, req.user.id);
      if (!updated) {
        return sendError(res, 404, 'PLAYER_NOT_FOUND', 'Сектор не найден');
      }
      return sendJson(res, 200, {
        success: true,
        player: updated,
        stockUpdatedAt: updated.stockUpdatedAt,
        stockUpdateSource: updated.stockUpdateSource
      });
    }

    if (pathname === '/api/my-profile/officers' && req.method === 'POST') {
      if (!requireAuth(req, res)) return;
      const activePlayerId = resolveUserPlayerId(req);
      if (!activePlayerId) {
        return sendError(res, 404, 'NO_LINKED_PLAYER', 'К вашему аккаунту не привязан профиль игрока');
      }
      if (body.skills !== undefined) {
        body.skills = sanitizeSkills(body.skills);
      }
      if (body.invested !== undefined) {
        body.invested = sanitizeInvested(body.invested);
      }
      if (body.personalPuzzles !== undefined || body.personal_puzzles !== undefined) {
        body.personalPuzzles = sanitizePersonalPuzzles(body.personalPuzzles ?? body.personal_puzzles);
      }
      if (body.onlyPersonalPuzzles !== undefined || body.only_personal_puzzles !== undefined) {
        body.onlyPersonalPuzzles = Boolean(body.onlyPersonalPuzzles ?? body.only_personal_puzzles);
      }
      const off = db.addPlayerOfficer(activePlayerId, body);
      return sendJson(res, 200, off);
    }

    const myOfficerMatch = pathname.match(/^\/api\/my-profile\/officers\/([^/]+)$/);
    if (myOfficerMatch && req.method === 'PUT') {
      if (!requireAuth(req, res)) return;
      const activePlayerId = resolveUserPlayerId(req);
      if (!activePlayerId) {
        return sendError(res, 404, 'NO_LINKED_PLAYER', 'К вашему аккаунту не привязан профиль игрока');
      }
      const officerId = myOfficerMatch[1];
      if (body.skills !== undefined) {
        body.skills = sanitizeSkills(body.skills);
      }
      if (body.invested !== undefined) {
        body.invested = sanitizeInvested(body.invested);
      }
      if (body.personalPuzzles !== undefined || body.personal_puzzles !== undefined) {
        body.personalPuzzles = sanitizePersonalPuzzles(body.personalPuzzles ?? body.personal_puzzles);
      }
      if (body.onlyPersonalPuzzles !== undefined || body.only_personal_puzzles !== undefined) {
        body.onlyPersonalPuzzles = Boolean(body.onlyPersonalPuzzles ?? body.only_personal_puzzles);
      }
      const off = db.updatePlayerOfficer(activePlayerId, officerId, body);
      if (!off) {
        return sendError(res, 404, 'OFFICER_NOT_FOUND', 'Офицер не найден');
      }
      return sendJson(res, 200, off);
    }

    if (myOfficerMatch && req.method === 'DELETE') {
      if (!requireAuth(req, res)) return;
      const activePlayerId = resolveUserPlayerId(req);
      if (!activePlayerId) {
        return sendError(res, 404, 'NO_LINKED_PLAYER', 'К вашему аккаунту не привязан профиль игрока');
      }
      const officerId = myOfficerMatch[1];
      db.deletePlayerOfficer(activePlayerId, officerId);
      return sendJson(res, 200, { success: true });
    }

    // ─────────────────────────────────────────────────────────
    // PLAYERS MANAGEMENT (R4, R5)
    // ─────────────────────────────────────────────────────────
    if (pathname === '/api/players' && req.method === 'GET') {
      if (!requireAuth(req, res)) return;
      const canViewPlayers = logic.hasUserPermission(req.user, 'view_sectors') || logic.hasUserPermission(req.user, 'view_matrix');
      if (!canViewPlayers) {
        return sendError(res, 403, 'FORBIDDEN', 'Требуется разрешение на просмотр секторов или матрицы');
      }
      const players = db.getPlayers().map(p => maskPlayerStockIfNeeded(p, req.user));
      return sendJson(res, 200, players);
    }

    if (pathname === '/api/players' && req.method === 'POST') {
      if (!requireRole(['r4', 'r5'])(req, res)) return;
      if (body.sector && body.sector.vipPoints !== undefined) {
        body.sector.vipPoints = sanitizeVipPoints(body.sector.vipPoints);
      }
      if (body.vipPoints !== undefined) {
        body.vipPoints = sanitizeVipPoints(body.vipPoints);
      }
      if (body.stock) {
        sanitizeStock(body.stock);
      }
      if (Array.isArray(body.officers)) {
        for (const o of body.officers) {
          if (o.skills !== undefined) {
            o.skills = sanitizeSkills(o.skills);
          }
          if (o.invested !== undefined) {
            o.invested = sanitizeInvested(o.invested);
          }
          if (o.personalPuzzles !== undefined || o.personal_puzzles !== undefined) {
            o.personalPuzzles = sanitizePersonalPuzzles(o.personalPuzzles ?? o.personal_puzzles);
          }
          if (o.onlyPersonalPuzzles !== undefined || o.only_personal_puzzles !== undefined) {
            o.onlyPersonalPuzzles = Boolean(o.onlyPersonalPuzzles ?? o.only_personal_puzzles);
          }
        }
      }
      const created = db.createPlayer(body);
      return sendJson(res, 200, created);
    }

    function checkSectorAccess(targetPlayerId, isRead = false) {
      if (!req.user) {
        return { ok: false, status: 401, error: 'UNAUTHORIZED', message: 'Требуется авторизация' };
      }
      const player = db.getPlayerById(targetPlayerId);
      if (!player) {
        return { ok: false, status: 404, error: 'PLAYER_NOT_FOUND', message: 'Сектор не найден' };
      }
      const isLeader = req.user.rank === 'r4' || req.user.rank === 'r5';
      const isOwner = player.userId === req.user.id;
      if (isRead) {
        const canRead = isLeader || isOwner || logic.hasUserPermission(req.user, 'view_sectors');
        if (!canRead) {
          return { ok: false, status: 403, error: 'FORBIDDEN', message: 'Вы не являетесь владельцем этого сектора' };
        }
        const maskedPlayer = maskPlayerStockIfNeeded(player, req.user);
        return { ok: true, player: maskedPlayer, isLeader, isOwner };
      }
      if (!isLeader && !isOwner) {
        return { ok: false, status: 403, error: 'FORBIDDEN', message: 'Вы не являетесь владельцем этого сектора' };
      }
      return { ok: true, player, isLeader, isOwner };
    }

    const playerMatch = pathname.match(/^\/api\/players\/(\d+)$/);
    if (playerMatch && req.method === 'GET') {
      const targetPlayerId = Number(playerMatch[1]);
      const check = checkSectorAccess(targetPlayerId, true);
      if (!check.ok) return sendError(res, check.status, check.error, check.message);
      return sendJson(res, 200, check.player);
    }

    if (playerMatch && req.method === 'PUT') {
      const targetPlayerId = Number(playerMatch[1]);
      const check = checkSectorAccess(targetPlayerId);
      if (!check.ok) return sendError(res, check.status, check.error, check.message);

      if (!check.isLeader) {
        delete body.rank;
        delete body.id;
        delete body.userId;
        delete body.user_id;
      }
      if (body.sector && body.sector.vipPoints !== undefined) {
        body.sector.vipPoints = sanitizeVipPoints(body.sector.vipPoints);
      }
      if (body.vipPoints !== undefined) {
        body.vipPoints = sanitizeVipPoints(body.vipPoints);
      }
      if (body.stock) {
        sanitizeStock(body.stock);
      }
      if (Array.isArray(body.officers)) {
        const existingPlayer = check.player;
        if (existingPlayer && Array.isArray(existingPlayer.officers)) {
          const keepIds = new Set(body.officers.map(o => o && o.id).filter(Boolean));
          for (const oldOff of existingPlayer.officers) {
            if (!keepIds.has(oldOff.id)) {
              db.deletePlayerOfficer(targetPlayerId, oldOff.id);
            }
          }
        }
        for (const o of body.officers) {
          if (o.skills !== undefined) {
            o.skills = sanitizeSkills(o.skills);
          }
          if (o.invested !== undefined) {
            o.invested = sanitizeInvested(o.invested);
          }
          if (o.personalPuzzles !== undefined || o.personal_puzzles !== undefined) {
            o.personalPuzzles = sanitizePersonalPuzzles(o.personalPuzzles ?? o.personal_puzzles);
          }
          if (o.onlyPersonalPuzzles !== undefined || o.only_personal_puzzles !== undefined) {
            o.onlyPersonalPuzzles = Boolean(o.onlyPersonalPuzzles ?? o.only_personal_puzzles);
          }
          if (o.id) {
            const updatedOff = db.updatePlayerOfficer(targetPlayerId, o.id, o);
            if (!updatedOff) {
              db.addPlayerOfficer(targetPlayerId, o);
            }
          } else {
            db.addPlayerOfficer(targetPlayerId, o);
          }
        }
      }
      const updated = db.updatePlayer(targetPlayerId, { ...body, editorUserId: req.user.id });
      if (body.stock) {
        db.recordStockHistory(targetPlayerId, body.stock);
      }
      return sendJson(res, 200, updated);
    }

    if (playerMatch && req.method === 'DELETE') {
      if (!requireRole(['r4', 'r5'])(req, res)) return;
      db.deletePlayer(Number(playerMatch[1]));
      return sendJson(res, 200, { success: true });
    }

    const stockHistoryMatch = pathname.match(/^\/api\/players\/(\d+)\/stock-history$/);
    if (stockHistoryMatch && req.method === 'GET') {
      if (!authenticate(req)) {
        return sendError(res, 401, 'UNAUTHORIZED', 'Требуется авторизация');
      }
      const targetPlayerId = Number(stockHistoryMatch[1]);
      const player = db.getPlayerById(targetPlayerId);
      if (!player) {
        return sendError(res, 404, 'PLAYER_NOT_FOUND', 'Сектор не найден');
      }

      const isStaff = req.user.rank === 'r4' || req.user.rank === 'r5';
      const isOwner = player.userId === req.user.id || req.user.player_id === targetPlayerId;
      const hasPerm = logic.hasUserPermission(req.user, 'view_sectors') || logic.hasUserPermission(req.user, 'view_stocks');

      if (!isStaff && !isOwner && !hasPerm) {
        return sendError(res, 403, 'FORBIDDEN', 'Недостаточно прав для просмотра истории склада этого сектора');
      }

      const records = db.getStockHistory(targetPlayerId, 50);
      return sendJson(res, 200, { records });
    }

    if (stockHistoryMatch && req.method === 'POST') {
      if (!authenticate(req)) {
        return sendError(res, 401, 'UNAUTHORIZED', 'Требуется авторизация');
      }
      const targetPlayerId = Number(stockHistoryMatch[1]);
      const check = checkSectorAccess(targetPlayerId);
      if (!check.ok) return sendError(res, check.status, check.error, check.message);

      const { source = 'manual_edit', snapshotBefore, snapshotAfter, screenshotBase64 } = body;
      const validSource = source === 'ocr_scan' ? 'ocr_scan' : 'manual_edit';

      const before = snapshotBefore ? logic.normalizeStock(snapshotBefore) : check.player.stock;
      const after = snapshotAfter ? logic.normalizeStock(snapshotAfter) : before;

      const diff = logic.calculateStockDiff(before, after);

      let screenshotPath = null;
      if (screenshotBase64 && typeof screenshotBase64 === 'string' && screenshotBase64.trim()) {
        const yyyyMm = new Date().toISOString().slice(0, 7);
        const screenshotsDir = path.join(__dirname, 'data', 'screenshots', yyyyMm);
        if (!fs.existsSync(screenshotsDir)) {
          fs.mkdirSync(screenshotsDir, { recursive: true });
        }

        let ext = '.jpg';
        let b64 = screenshotBase64;
        const match = screenshotBase64.match(/^data:(image\/(jpeg|jpg|webp|png));base64,(.+)$/);
        if (match) {
          const mime = match[1] === 'image/jpg' ? 'image/jpeg' : match[1];
          ext = mime === 'image/webp' ? '.webp' : (mime === 'image/png' ? '.png' : '.jpg');
          b64 = match[3];
        }

        const buf = Buffer.from(b64, 'base64');
        const hash = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 8);
        const filename = `${targetPlayerId}_${Date.now()}_${hash}${ext}`;
        const fullPath = path.join(screenshotsDir, filename);
        fs.writeFileSync(fullPath, buf);
        screenshotPath = `${yyyyMm}/${filename}`;
      }

      const now = new Date().toISOString();
      const record = db.recordStockHistory({
        playerId: targetPlayerId,
        userId: req.user.id,
        source: validSource,
        snapshotBefore: before,
        snapshotAfter: after,
        diffSummary: diff.summary,
        screenshotPath,
        createdAt: now
      });

      if (snapshotAfter) {
        db.updatePlayer(targetPlayerId, {
          stock: after,
          stockUpdatedAt: now,
          stockUpdateSource: validSource,
          recordHistory: false
        });
      }

      return sendJson(res, 201, record);
    }

    const playerOfficersMatch = pathname.match(/^\/api\/players\/(\d+)\/officers$/);
    if (playerOfficersMatch && req.method === 'POST') {
      const targetPlayerId = Number(playerOfficersMatch[1]);
      const check = checkSectorAccess(targetPlayerId);
      if (!check.ok) return sendError(res, check.status, check.error, check.message);

      if (body.skills !== undefined) {
        body.skills = sanitizeSkills(body.skills);
      }
      if (body.invested !== undefined) {
        body.invested = sanitizeInvested(body.invested);
      }
      if (body.personalPuzzles !== undefined || body.personal_puzzles !== undefined) {
        body.personalPuzzles = sanitizePersonalPuzzles(body.personalPuzzles ?? body.personal_puzzles);
      }
      if (body.onlyPersonalPuzzles !== undefined || body.only_personal_puzzles !== undefined) {
        body.onlyPersonalPuzzles = Boolean(body.onlyPersonalPuzzles ?? body.only_personal_puzzles);
      }
      const off = db.addPlayerOfficer(targetPlayerId, body);
      return sendJson(res, 201, off);
    }

    const playerOfficerDetailMatch = pathname.match(/^\/api\/players\/(\d+)\/officers\/([^/]+)$/);
    if (playerOfficerDetailMatch && req.method === 'PUT') {
      const targetPlayerId = Number(playerOfficerDetailMatch[1]);
      const offId = playerOfficerDetailMatch[2];
      const check = checkSectorAccess(targetPlayerId);
      if (!check.ok) return sendError(res, check.status, check.error, check.message);

      if (body.skills !== undefined) {
        body.skills = sanitizeSkills(body.skills);
      }
      if (body.invested !== undefined) {
        body.invested = sanitizeInvested(body.invested);
      }
      if (body.personalPuzzles !== undefined || body.personal_puzzles !== undefined) {
        body.personalPuzzles = sanitizePersonalPuzzles(body.personalPuzzles ?? body.personal_puzzles);
      }
      if (body.onlyPersonalPuzzles !== undefined || body.only_personal_puzzles !== undefined) {
        body.onlyPersonalPuzzles = Boolean(body.onlyPersonalPuzzles ?? body.only_personal_puzzles);
      }
      const off = db.updatePlayerOfficer(targetPlayerId, offId, body);
      if (!off) {
        return sendError(res, 404, 'OFFICER_NOT_FOUND', 'Офицер не найден');
      }
      return sendJson(res, 200, off);
    }

    if (playerOfficerDetailMatch && req.method === 'DELETE') {
      const targetPlayerId = Number(playerOfficerDetailMatch[1]);
      const offId = playerOfficerDetailMatch[2];
      const check = checkSectorAccess(targetPlayerId);
      if (!check.ok) return sendError(res, check.status, check.error, check.message);

      db.deletePlayerOfficer(targetPlayerId, offId);
      return sendJson(res, 200, { success: true });
    }

    // ─────────────────────────────────────────────────────────
    // VIP TIERS
    // ─────────────────────────────────────────────────────────
    if (pathname === '/api/vip-tiers' && req.method === 'GET') {
      if (!authenticate(req, res)) return;
      return sendJson(res, 200, db.getVipTiers());
    }

    if (pathname === '/api/vip-tiers' && req.method === 'PUT') {
      if (!requirePermission(req, res, 'manage_catalog')) return;
      const tiersInput = Array.isArray(body) ? body : (Array.isArray(body?.tiers) ? body.tiers : null);
      if (!tiersInput) {
        return sendError(res, 400, 'INVALID_PAYLOAD', 'Ожидается массив уровней VIP');
      }
      const updated = db.setVipTiers(tiersInput);
      return sendJson(res, 200, updated);
    }

    // ─────────────────────────────────────────────────────────
    // CATALOG
    // ─────────────────────────────────────────────────────────
    if (pathname === '/api/catalog' && req.method === 'GET') {
      return sendJson(res, 200, db.getCatalog());
    }

    if (pathname === '/api/catalog' && req.method === 'POST') {
      if (!requirePermission(req, res, 'manage_catalog')) return;
      const upgradeType = body.upgradeType === 'special' ? 'special' : 'standard';
      const medalsBeforeTraining = Math.max(0, parseInt(body.medalsBeforeTraining ?? body.medals_before_training) || 480);
      const medalsTraining = Math.max(0, parseInt(body.medalsTraining ?? body.medals_training) || 900);
      const medalsTotal = Math.max(0, parseInt(body.medalsTotal ?? body.medals_total) || (medalsBeforeTraining + medalsTraining));
      const starCouponCost = Math.max(0, parseInt(body.starCouponCost ?? body.star_coupon_cost) || 360);
      const couponPerPuzzle = Math.max(0, parseInt(body.couponPerPuzzle ?? body.coupon_per_puzzle) || 720);
      const generation = Math.max(1, parseInt(body.generation) || 8);
      const type = ['Танк', 'Пехота', 'ПТ-Сау', 'Горнизон', 'Осада'].includes(body.type) ? body.type : (body.type || 'Пехота');

      const saved = db.saveCatalogItem({
        ...body,
        id: body.id || ('off_' + Date.now()),
        name: String(body.name || '').trim(),
        type,
        generation,
        couponPerPuzzle,
        starCouponCost,
        medalsBeforeTraining,
        medalsTraining,
        medalsTotal,
        upgradeType
      });
      return sendJson(res, 200, saved);
    }

    if (pathname === '/api/catalog/batch' && req.method === 'POST') {
      if (!requirePermission(req, res, 'manage_catalog')) return;
      const officers = Array.isArray(body) ? body : (Array.isArray(body?.officers) ? body.officers : null);
      if (!officers) {
        return sendError(res, 400, 'INVALID_PAYLOAD', 'Ожидается массив офицеров');
      }
      const savedList = [];
      for (const off of officers) {
        if (!off || !off.name) continue;
        const upgradeType = off.upgradeType === 'special' ? 'special' : 'standard';
        const medalsBeforeTraining = Math.max(0, parseInt(off.medalsBeforeTraining ?? off.medals_before_training) || 480);
        const medalsTraining = Math.max(0, parseInt(off.medalsTraining ?? off.medals_training) || 900);
        const medalsTotal = Math.max(0, parseInt(off.medalsTotal ?? off.medals_total) || (medalsBeforeTraining + medalsTraining));
        const starCouponCost = Math.max(0, parseInt(off.starCouponCost ?? off.star_coupon_cost) || 360);
        const couponPerPuzzle = Math.max(0, parseInt(off.couponPerPuzzle ?? off.coupon_per_puzzle) || 720);
        const generation = Math.max(1, parseInt(off.generation) || 8);
        const type = ['Танк', 'Пехота', 'ПТ-Сау', 'Горнизон', 'Осада'].includes(off.type) ? off.type : (off.type || 'Пехота');

        const saved = db.saveCatalogItem({
          ...off,
          id: off.id || ('off_' + Math.random().toString(36).slice(2, 9)),
          name: String(off.name).trim(),
          type,
          generation,
          couponPerPuzzle,
          starCouponCost,
          medalsBeforeTraining,
          medalsTraining,
          medalsTotal,
          upgradeType
        });
        savedList.push(saved);
      }
      return sendJson(res, 200, { success: true, count: savedList.length, officers: savedList });
    }

    const catMatch = pathname.match(/^\/api\/catalog\/([^/]+)$/);
    if (catMatch && req.method === 'PUT') {
      if (!requirePermission(req, res, 'manage_catalog')) return;
      const upgradeType = body.upgradeType === 'special' ? 'special' : (body.upgradeType || 'standard');
      const medalsBeforeTraining = Math.max(0, parseInt(body.medalsBeforeTraining ?? body.medals_before_training) || 480);
      const medalsTraining = Math.max(0, parseInt(body.medalsTraining ?? body.medals_training) || 900);
      const medalsTotal = Math.max(0, parseInt(body.medalsTotal ?? body.medals_total) || (medalsBeforeTraining + medalsTraining));
      const starCouponCost = Math.max(0, parseInt(body.starCouponCost ?? body.star_coupon_cost) || 360);
      const couponPerPuzzle = Math.max(0, parseInt(body.couponPerPuzzle ?? body.coupon_per_puzzle) || 720);
      const generation = Math.max(1, parseInt(body.generation) || 8);
      const type = ['Танк', 'Пехота', 'ПТ-Сау', 'Горнизон', 'Осада'].includes(body.type) ? body.type : (body.type || 'Пехота');

      const saved = db.saveCatalogItem({
        ...body,
        id: catMatch[1],
        type,
        generation,
        couponPerPuzzle,
        starCouponCost,
        medalsBeforeTraining,
        medalsTraining,
        medalsTotal,
        upgradeType
      });
      return sendJson(res, 200, saved);
    }

    if (catMatch && req.method === 'DELETE') {
      if (!requirePermission(req, res, 'manage_catalog')) return;
      const id = catMatch[1];
      if (!logic.canDeleteOfficer(id, db.getPlayers()).ok) {
        return sendError(res, 400, 'OFFICER_IN_USE', 'Офицер используется игроками');
      }
      db.deleteCatalogItem(id);
      return sendJson(res, 200, { success: true });
    }

    // ─────────────────────────────────────────────────────────
    // EVENT TYPES
    // ─────────────────────────────────────────────────────────
    if (pathname === '/api/event-types' && req.method === 'GET') {
      return sendJson(res, 200, db.getEventTypes());
    }

    if (pathname === '/api/event-types/bulk-rewards' && req.method === 'POST') {
      if (!requirePermission(req, res, 'manage_catalog')) return;
      const typeIds = Array.isArray(body?.typeIds) ? body.typeIds.map(Number).filter(n => !isNaN(n) && n > 0) : [];
      if (!typeIds.length) {
        return sendError(res, 400, 'INVALID_PAYLOAD', 'Ожидается непустой массив ID типов событий (typeIds)');
      }
      if (!Array.isArray(body?.places)) {
        return sendError(res, 400, 'INVALID_PAYLOAD', 'Ожидается массив наград (places)');
      }
      const places = sanitizeEventTypePlaces(body.places);
      const updatedCount = db.updateBulkEventTypeRewards(typeIds, places);
      return sendJson(res, 200, { ok: true, success: true, updatedCount, places });
    }

    if (pathname === '/api/event-types' && req.method === 'POST') {
      if (!requirePermission(req, res, 'manage_catalog')) return;
      const sanitized = sanitizeEventType(body);
      const saved = db.saveEventType(sanitized);
      return sendJson(res, 200, saved);
    }

    const etMatch = pathname.match(/^\/api\/event-types\/(\d+)$/);
    if (etMatch && req.method === 'PUT') {
      if (!requirePermission(req, res, 'manage_catalog')) return;
      const sanitized = sanitizeEventType({ ...body, id: Number(etMatch[1]) });
      const saved = db.saveEventType(sanitized);
      return sendJson(res, 200, saved);
    }

    if (etMatch && req.method === 'DELETE') {
      if (!requirePermission(req, res, 'manage_catalog')) return;
      db.deleteEventType(Number(etMatch[1]));
      return sendJson(res, 200, { success: true });
    }

    // ─────────────────────────────────────────────────────────
    // EVENTS & REGISTRATIONS & AUTOPICK
    // ─────────────────────────────────────────────────────────
    if (pathname === '/api/events' && req.method === 'GET') {
      const events = db.getEvents();
      const canManageEvents = Boolean(req.user && logic.hasUserPermission(req.user, 'manage_events'));
      const userSectors = req.user ? db.getPlayersByUserId(req.user.id) : [];
      const userSectorIds = new Set(userSectors.map(s => s.id));
      const activeSectorId = req.user?.playerId;

      const enriched = events.map(ev => {
        const item = { ...ev };
        const eventRegs = (canManageEvents || userSectors.length > 0) ? db.getRegistrationsByEventId(ev.id) : [];
        if (canManageEvents) {
          item.registrations = eventRegs;
        }
        if (req.user) {
          item.myRegistrations = eventRegs.filter(r => userSectorIds.has(r.playerId));
          item.myRegistration = item.myRegistrations.find(r => r.playerId === activeSectorId) || item.myRegistrations[0] || null;
        }
        return item;
      });

      return sendJson(res, 200, enriched);
    }

    if (pathname === '/api/events' && req.method === 'POST') {
      if (!requirePermission(req, res, 'manage_events')) return;
      const isNew = !body.id;

      // Idempotent deduplication for rapid double-clicks on event creation
      const dedupeKey = isNew
        ? `${Number(body.typeId)}_${String(body.dateFrom)}_${String(body.dateTo)}_${Number(req.user?.id || 0)}`
        : null;

      if (isNew && dedupeKey) {
        const existing = getRecentCreatedEvent(dedupeKey, 5000);
        if (existing && existing.saved) {
          console.log(`[Events] Deduplicated duplicate creation request for key: ${dedupeKey} (event #${existing.saved.id})`);
          return sendJson(res, 200, existing.saved);
        }
      }

      const previousEvent = body.id ? db.getEventById(Number(body.id)) : null;
      const previousAssignments = previousEvent ? (previousEvent.assignments || []) : [];

      const saved = db.saveEvent(body);

      if (isNew && saved && saved.id) {
        if (dedupeKey) {
          recordRecentCreatedEvent(dedupeKey, saved);
        }
        try {
          const eventTypes = db.getEventTypes();
          const et = eventTypes.find(t => t.id === saved.typeId);
          const effectivePlaces = et ? (typeof logic.resolveEventPlaces === 'function' ? logic.resolveEventPlaces(et, saved.dateFrom) : et.places) : [];
          const totalPlaces = effectivePlaces ? effectivePlaces.length : (et?.places?.length || 0);
          const baseUrl = getAppBaseUrl(req);

          await dispatchNotification('event_registration_opened', {
            eventName: et?.name || 'Событие',
            eventDate: saved.dateFrom || '',
            totalPlaces: String(totalPlaces),
            link: `${baseUrl}/#event/${saved.id}`
          }, { broadcast: true }).catch(err => {
            console.warn('[Notification] Error broadcasting event_registration_opened:', err.message);
          });
        } catch (notifErr) {
          console.warn('[Notification] Error preparing event_registration_opened:', notifErr.message);
        }
      }

      // Notifications on saveEvent: personal alerts for assigned places & staff summary
      try {
        const savedAssignments = (saved && saved.assignments) ? saved.assignments : [];
        const assignedList = savedAssignments.filter(a => a.playerId && Number(a.place) > 0);

        if (assignedList.length > 0) {
          const eventTypes = db.getEventTypes();
          const et = eventTypes.find(t => t.id === saved.typeId);
          const places = et ? (typeof logic.resolveEventPlaces === 'function' ? logic.resolveEventPlaces(et, saved.dateFrom) : et.places) : [];
          const baseUrl = getAppBaseUrl(req);
          const players = db.getPlayers();

          let newAssignmentsCount = 0;
          for (const a of assignedList) {
            const prevA = previousAssignments.find(pa => pa.playerId === a.playerId && Number(pa.place) === Number(a.place));
            if (prevA) continue; // Already assigned to this place earlier
            newAssignmentsCount++;

            const player = db.getPlayerById(a.playerId);
            if (player && player.userId) {
              const user = db.findUserById(player.userId);
              if (user) {
                const coupons = a.coupons !== undefined ? a.coupons : (places.find(p => Number(p.place) === Number(a.place))?.coupons || 0);
                const rsvpMarkup = {
                  inline_keyboard: [
                    [
                      { text: '✅ Подтверждаю участие', callback_data: `rsvp_event:confirm:${saved.id}:${a.place}` },
                      { text: '❌ Не смогу участвовать', callback_data: `rsvp_event:decline:${saved.id}:${a.place}` }
                    ]
                  ]
                };
                await dispatchNotification('event_place_assigned', {
                  username: user.username,
                  sectorName: player.name || a.playerName || 'Сектор',
                  eventName: et?.name || 'Событие',
                  eventDate: saved.dateFrom || '',
                  place: String(a.place),
                  coupons: String(coupons),
                  link: `${baseUrl}/#event/${saved.id}`
                }, { userId: user.id, replyMarkup: rsvpMarkup }).catch(err => {
                  console.warn(`[Notification] Error sending event_place_assigned to user ${user.id}:`, err.message);
                });
              }
            }
          }

          if (newAssignmentsCount > 0 || isNew) {
            const topFormatted = assignedList
              .sort((x, y) => Number(x.place) - Number(y.place))
              .slice(0, 5)
              .map((a, idx) => {
                const p = players.find(pl => pl.id === a.playerId);
                const vipStr = (p && p.vip !== undefined) ? ` (VIP ${p.vip})` : '';
                const safeName = String(a.playerName || p?.name || 'Сектор')
                  .replace(/&/g, '&amp;')
                  .replace(/</g, '&lt;')
                  .replace(/>/g, '&gt;');
                return `${idx + 1}. #${a.place}: ${safeName}${vipStr}`;
              })
              .join('\n');

            await dispatchNotification('staff_event_autopick_summary', {
              eventName: et?.name || 'Событие',
              assignedCount: String(assignedList.length),
              availablePlaces: String(places.length),
              topAssignmentsList: topFormatted || 'Назначений нет',
              link: `${baseUrl}/#event/${saved.id}`
            }).catch(err => {
              console.warn('[Notification] Error sending staff_event_autopick_summary:', err.message);
            });
          }
        }
      } catch (assignNotifErr) {
        console.warn('[Notification] Error in assignment notifications on saveEvent:', assignNotifErr.message);
      }

      return sendJson(res, 200, saved);
    }

    if (pathname === '/api/events/schedule-season' && req.method === 'POST') {
      if (!requirePermission(req, res, 'manage_events')) return;

      let cachedEventTypes = db.getEventTypes();
      function ensureEventType(identifier, defaultColor) {
        const search = String(identifier || '').trim().toLowerCase();
        let found = cachedEventTypes.find(t => t.name && t.name.trim().toLowerCase() === search);

        const preset = (logic.EVENT_PRESETS || []).find(p => p.id === search || p.name.trim().toLowerCase() === search);
        if (!found && preset) {
          found = cachedEventTypes.find(t => t.name && t.name.trim().toLowerCase() === preset.name.trim().toLowerCase());
        }

        if (!found) {
          const typeName = preset ? preset.name : (identifier || 'Событие');
          let color = defaultColor || (preset ? preset.color : '#8b5cf6');
          if (preset?.id === 'king-of-war') color = '#8b5cf6';
          else if (preset?.id === 'mighty-forces') color = '#10b981';
          else if (preset?.id === 'power-of-time') color = '#f59e0b';

          found = db.saveEventType({
            name: typeName,
            color: color || '#8b5cf6',
            isPeriodic: 1,
            startDayOfWeek: preset?.startDayOfWeek || 2,
            endDayOfWeek: preset?.endDayOfWeek || 3,
            activeWeeks: preset?.activeWeeks || 1,
            breakWeeks: preset?.breakWeeks || 1,
            weekOffset: preset?.weekOffset || 0,
            places: [
              { place: 1, label: '🥇 1 место', coupons: 12500 },
              { place: 2, label: '🥈 2 место', coupons: 6500 },
              { place: 3, label: '🥉 3 место', coupons: 3500 },
              { place: 4, label: '4–10 место', coupons: 2750 },
            ]
          });
          cachedEventTypes.push(found);
        }
        return found;
      }

      const createdEvents = [];

      if (Array.isArray(body?.events)) {
        // 1. Ready-made events array from UI preview (with possible deletions/edits)
        for (const item of body.events) {
          if (!item || !item.dateFrom || !item.dateTo) continue;
          let et = null;
          if (item.typeId && typeof item.typeId === 'number') {
            const allTypes = db.getEventTypes();
            et = allTypes.find(t => t.id === item.typeId);
          }
          if (!et) {
            et = ensureEventType(item.typeName || item.name || item.typeId, item.color);
          }
          const saved = db.saveEvent({
            typeId: et.id,
            dateFrom: item.dateFrom,
            dateTo: item.dateTo,
            note: item.note || '',
            assignments: []
          });
          createdEvents.push(saved);
        }
      } else if (body?.rules || body?.totalWeeks) {
        // 2. Multi-rule season generation
        const scheduleItems = logic.generateSeasonSchedule({
          startDate: body.startDate || new Date().toISOString().slice(0, 10),
          totalWeeks: body.totalWeeks,
          rules: body.rules
        });

        for (const item of scheduleItems) {
          const et = ensureEventType(item.typeName || item.name || item.typeId, item.color);
          const saved = db.saveEvent({
            typeId: et.id,
            dateFrom: item.dateFrom,
            dateTo: item.dateTo,
            note: item.note || '',
            assignments: []
          });
          createdEvents.push(saved);
        }
      } else {
        // 3. Legacy fallback (presetId, startDate, cyclesCount)
        const { presetId = 'king-of-war', startDate, cyclesCount = 1 } = body || {};
        const preset = (logic.EVENT_PRESETS || []).find(p => p.id === presetId) || (logic.EVENT_PRESETS && logic.EVENT_PRESETS[0]) || {
          id: 'king-of-war',
          name: 'Король Войны',
          cycleDays: 14,
          durationDays: 2
        };

        const eventType = ensureEventType(preset.name, preset.color);
        const count = Math.max(1, Number(cyclesCount) || 1);
        const scheduleItems = logic.generateSeasonSchedule({
          startDate: startDate || new Date().toISOString().slice(0, 10),
          cyclesCount: count,
          presetId: preset.id
        });

        for (const item of scheduleItems) {
          const saved = db.saveEvent({
            typeId: eventType.id,
            dateFrom: item.dateFrom,
            dateTo: item.dateTo,
            note: item.note || '',
            assignments: []
          });
          createdEvents.push(saved);
        }
      }

      return sendJson(res, 201, {
        success: true,
        count: createdEvents.length,
        createdCount: createdEvents.length,
        events: createdEvents
      });
    }

    const eventRegMatch = pathname.match(/^\/api\/events\/(\d+)\/register$/);
    if (eventRegMatch && req.method === 'POST') {
      if (!requireAuth(req, res)) return;
      const eventId = Number(eventRegMatch[1]);
      const targetSectorId = body.sectorId
        ? Number(body.sectorId)
        : (req.user.playerId ? Number(req.user.playerId) : null);

      if (!targetSectorId) {
        return sendError(res, 400, 'NO_LINKED_PLAYER', 'К вашему аккаунту не привязан профиль игрока');
      }
      const player = db.getPlayerById(targetSectorId);
      if (!player) {
        return sendError(res, 404, 'PLAYER_NOT_FOUND', 'Сектор не найден');
      }
      const isLeader = req.user.rank === 'r4' || req.user.rank === 'r5';
      if (!isLeader && player.userId !== req.user.id) {
        return sendError(res, 403, 'FORBIDDEN', 'Вы не являетесь владельцем этого сектора');
      }

      const { officerId, desiredPlace } = body;
      if (officerId) {
        const off = (player.officers || []).find(o => String(o.id) === String(officerId));
        if (off && Boolean(off.onlyPersonalPuzzles || off.only_personal_puzzles)) {
          return sendError(res, 400, 'OFFICER_ONLY_PERSONAL_PUZZLES', 'Этот офицер качается только за счет личных пазлов и не участвует в распределении ивентов');
        }
      }

      const reg = db.registerForEvent({
        eventId,
        playerId: targetSectorId,
        officerId: officerId || '',
        desiredPlace: desiredPlace !== undefined ? Number(desiredPlace) : 0
      });
      return sendJson(res, 200, { success: true, registration: reg });
    }

    if (eventRegMatch && req.method === 'DELETE') {
      if (!requireAuth(req, res)) return;
      const eventId = Number(eventRegMatch[1]);
      const sectorIdParam = parsedUrl.searchParams.get('sectorId');
      const targetSectorId = sectorIdParam
        ? Number(sectorIdParam)
        : (body && body.sectorId ? Number(body.sectorId) : (req.user.playerId ? Number(req.user.playerId) : null));

      if (!targetSectorId) {
        return sendError(res, 400, 'NO_LINKED_PLAYER', 'К вашему аккаунту не привязан профиль игрока');
      }
      const player = db.getPlayerById(targetSectorId);
      if (!player) {
        return sendError(res, 404, 'PLAYER_NOT_FOUND', 'Сектор не найден');
      }
      const isLeader = req.user.rank === 'r4' || req.user.rank === 'r5';
      if (!isLeader && player.userId !== req.user.id) {
        return sendError(res, 403, 'FORBIDDEN', 'Вы не являетесь владельцем этого сектора');
      }

      db.unregisterFromEvent(eventId, targetSectorId);
      return sendJson(res, 200, { success: true });
    }

    const autopickMatch = pathname.match(/^\/api\/events\/(\d+)\/(?:autopick|auto-pick)$/);
    if (autopickMatch && req.method === 'POST') {
      if (!requirePermission(req, res, 'manage_events')) return;
      const eventId = Number(autopickMatch[1]);
      const ev = db.getEventById(eventId);
      if (!ev) {
        return sendError(res, 404, 'EVENT_NOT_FOUND', 'Ивент не найден');
      }
      const eventTypes = db.getEventTypes();
      const et = eventTypes.find(t => t.id === ev.typeId);
      const places = et ? (typeof logic.resolveEventPlaces === 'function' ? logic.resolveEventPlaces(et, ev.dateFrom) : et.places) : [];

      const players = db.getPlayers();
      const officerCatalog = db.getCatalog();
      const registrations = db.getRegistrationsByEventId(eventId);
      const recentWinners = typeof db.getRecentWinners === 'function'
        ? db.getRecentWinners(ev.typeId || ev.type_id, 2, ev.id)
        : [];

      const result = logic.smartAutoPickWithRegistrations({
        event: { ...ev, places },
        players,
        registrations,
        officerCatalog,
        eventDate: ev.dateFrom,
        recentWinners
      });

      // Dry-run preview: do not mutate db or send notifications until saveEvent is submitted
      return sendJson(res, 200, {
        success: true,
        assignments: result.assignments,
        unassignedCandidates: result.unassignedCandidates
      });
    }

    const eventMatch = pathname.match(/^\/api\/events\/(\d+)$/);
    if (eventMatch && req.method === 'GET') {
      const ev = db.getEventById(Number(eventMatch[1]));
      if (!ev) return sendError(res, 404, 'EVENT_NOT_FOUND');
      const canManageEvents = Boolean(req.user && logic.hasUserPermission(req.user, 'manage_events'));
      const userSectors = req.user ? db.getPlayersByUserId(req.user.id) : [];
      const userSectorIds = new Set(userSectors.map(s => s.id));
      const eventRegs = (canManageEvents || userSectors.length > 0) ? db.getRegistrationsByEventId(ev.id) : [];
      if (canManageEvents) {
        ev.registrations = eventRegs;
      }
      if (req.user) {
        ev.myRegistrations = eventRegs.filter(r => userSectorIds.has(r.playerId));
        ev.myRegistration = ev.myRegistrations.find(r => r.playerId === req.user.playerId) || ev.myRegistrations[0] || null;
      }
      return sendJson(res, 200, ev);
    }

    if (eventMatch && req.method === 'PUT') {
      if (!requirePermission(req, res, 'manage_events')) return;
      const eventId = Number(eventMatch[1]);
      const prevEvent = db.getEventById(eventId);
      const prevAssignments = prevEvent?.assignments || [];

      const saved = db.saveEvent({ ...body, id: eventId });

      try {
        const newAssignments = Array.isArray(body.assignments) ? body.assignments : [];
        if (newAssignments.length > 0) {
          const eventTypes = db.getEventTypes();
          const et = eventTypes.find(t => t.id === (saved.typeId || prevEvent?.typeId));
          const places = et ? (typeof logic.resolveEventPlaces === 'function' ? logic.resolveEventPlaces(et, saved.dateFrom || prevEvent?.dateFrom) : et.places) : [];
          const baseUrl = getAppBaseUrl(req);

          for (const a of newAssignments) {
            if (a.playerId && Number(a.place) > 0) {
              const already = prevAssignments.some(pa => pa.playerId === a.playerId && Number(pa.place) === Number(a.place));
              if (!already) {
                const player = db.getPlayerById(a.playerId);
                if (player && player.userId) {
                  const user = db.findUserById(player.userId);
                  if (user) {
                    const coupons = a.coupons !== undefined ? a.coupons : (places.find(p => Number(p.place) === Number(a.place))?.coupons || 0);
                    const rsvpMarkup = {
                      inline_keyboard: [
                        [
                          { text: '✅ Подтверждаю участие', callback_data: `rsvp_event:confirm:${saved.id}:${a.place}` },
                          { text: '❌ Не смогу участвовать', callback_data: `rsvp_event:decline:${saved.id}:${a.place}` }
                        ]
                      ]
                    };
                    await dispatchNotification('event_place_assigned', {
                      username: user.username,
                      sectorName: player.name || a.playerName || 'Сектор',
                      eventName: et?.name || 'Событие',
                      eventDate: saved.dateFrom || prevEvent?.dateFrom || '',
                      place: String(a.place),
                      coupons: String(coupons),
                      link: `${baseUrl}/#event/${saved.id}`
                    }, { userId: user.id, replyMarkup: rsvpMarkup }).catch(() => {});
                  }
                }
              }
            }
          }
        }
      } catch (err) {
        console.warn('[Notification] Error in PUT /api/events/:id place notifications:', err.message);
      }

      return sendJson(res, 200, saved);
    }

    if (eventMatch && req.method === 'DELETE') {
      if (!requirePermission(req, res, 'manage_events')) return;
      db.deleteEvent(Number(eventMatch[1]));
      return sendJson(res, 200, { success: true });
    }

    const rsvpEventMatch = pathname.match(/^\/api\/events\/(\d+)\/rsvp$/);
    if (rsvpEventMatch && req.method === 'POST') {
      if (!requireAuth(req, res)) return;
      const eventId = Number(rsvpEventMatch[1]);
      const ev = db.getEventById(eventId);
      if (!ev) return sendError(res, 404, 'EVENT_NOT_FOUND', 'Событие не найдено');

      const placeNum = Number(body && body.place);
      const status = String(body && body.status); // 'confirmed' | 'declined'
      if (!['confirmed', 'declined'].includes(status)) {
        return sendError(res, 400, 'VALIDATION_ERROR', 'Статус должен быть confirmed или declined');
      }

      const assignment = (ev.assignments || []).find(a => Number(a.place) === placeNum);
      if (!assignment) {
        return sendError(res, 404, 'ASSIGNMENT_NOT_FOUND', 'Назначение на это место не найдено');
      }

      const player = db.getPlayerById(assignment.playerId);
      const isOwner = player && player.userId === req.user.id;
      const isStaff = logic.hasUserPermission(req.user, 'manage_events');

      if (!isOwner && !isStaff) {
        return sendError(res, 403, 'FORBIDDEN', 'Вы не назначены на это призовое место');
      }

      assignment.rsvpStatus = status;
      assignment.rsvpAt = new Date().toISOString();
      const saved = db.saveEvent(ev);

      if (status === 'declined') {
        const et = db.getEventTypes().find(t => t.id === ev.typeId);
        const token = db.getAppSetting('telegram_bot_token');
        let staffChatId = db.getAppSetting('telegram_staff_chat_id');
        if (staffChatId && token) {
          if (!isNaN(Number(staffChatId))) staffChatId = Number(staffChatId);
          const staffAlertText = `⚠️ <b>Отказ от участия в событии!</b>\n\nБоец: <b>@${req.user.username || 'боец'}</b>\nСектор: <b>${player?.name || 'Сектор'}</b>\nСобытие: <b>${et?.name || 'Событие'}</b>\nОсвобождено место: <b>#${placeNum}</b>\n\n<i>Место свободно для повторного распределения или резервиста!</i>`;
          telegram.sendTelegramMessage({
            token,
            chatId: staffChatId,
            text: staffAlertText,
            parseMode: 'HTML'
          }).catch(() => {});
        }
      }

      return sendJson(res, 200, { success: true, event: saved });
    }

    const submitResultMatch = pathname.match(/^\/api\/events\/(\d+)\/submit-result$/);
    if (submitResultMatch && req.method === 'POST') {
      if (!requireAuth(req, res)) return;
      const eventId = Number(submitResultMatch[1]);
      const ev = db.getEventById(eventId);
      if (!ev) return sendError(res, 404, 'EVENT_NOT_FOUND', 'Событие не найдено');

      const placeNum = Number(body && body.place);
      const actualPlace = Number(body && body.actualPlace);

      const assignment = (ev.assignments || []).find(a => Number(a.place) === placeNum);
      if (!assignment) {
        return sendError(res, 404, 'ASSIGNMENT_NOT_FOUND', 'Назначение на это место не найдено');
      }

      const player = db.getPlayerById(assignment.playerId);
      const isOwner = player && player.userId === req.user.id;
      const isStaff = logic.hasUserPermission(req.user, 'manage_events');

      if (!isOwner && !isStaff) {
        return sendError(res, 403, 'FORBIDDEN', 'Вы не назначены на это место');
      }

      const et = db.getEventTypes().find(t => t.id === ev.typeId);
      const places = et ? (typeof logic.resolveEventPlaces === 'function' ? logic.resolveEventPlaces(et, ev.dateFrom) : et.places) : [];
      const placeInfo = actualPlace > 0 ? places.find(p => Number(p.place) === actualPlace) : null;
      const prizeCoupons = placeInfo ? (Number(placeInfo.coupons) || 0) : 0;

      const previousCoupons = (assignment.accrued && assignment.actualCoupons !== undefined)
        ? (Number(assignment.actualCoupons) || 0)
        : 0;
      const couponDiff = assignment.accrued
        ? (prizeCoupons - previousCoupons)
        : prizeCoupons;

      if (player && couponDiff !== 0) {
        const curStock = player.stock || {};
        const oldCoupons = Number(curStock.coupons) || 0;
        const newStock = { ...curStock, coupons: Math.max(0, oldCoupons + couponDiff) };
        db.updatePlayer(player.id, { stock: newStock });
        db.recordStockHistory({
          playerId: player.id,
          userId: req.user.id,
          source: 'event_reward',
          snapshotBefore: curStock,
          snapshotAfter: newStock,
          diffSummary: assignment.accrued
            ? `Корректировка награды за ${et?.name || 'ивент'}: ${couponDiff > 0 ? '+' : ''}${couponDiff} куп. (место #${actualPlace})`
            : `Награда за событие ${et?.name || 'ивент'}: +${prizeCoupons} купонов (место #${actualPlace})`,
          screenshotPath: null,
          createdAt: new Date().toISOString()
        });
      }

      assignment.actualPlace = actualPlace;
      assignment.actualCoupons = prizeCoupons;
      assignment.resultStatus = 'confirmed';
      assignment.accrued = true;
      assignment.resultSubmittedAt = new Date().toISOString();
      assignment.submittedBy = isOwner ? 'owner' : (isStaff ? 'staff' : 'user');

      const saved = db.saveEvent(ev);
      return sendJson(res, 200, { success: true, event: saved, accruedCoupons: prizeCoupons });
    }

    const finishEventMatch = pathname.match(/^\/api\/events\/(\d+)\/finish$/);
    if (finishEventMatch && req.method === 'POST') {
      if (!requirePermission(req, res, 'manage_events')) return;
      const eventId = Number(finishEventMatch[1]);
      const ev = db.getEventById(eventId);
      if (!ev) return sendError(res, 404, 'EVENT_NOT_FOUND', 'Событие не найдено');

      const baseUrl = getAppBaseUrl(req);
      const et = db.getEventTypes().find(t => t.id === ev.typeId);
      let sentCount = 0;

      for (const a of (ev.assignments || [])) {
        if (!a.resultStatus || a.resultStatus === 'pending') {
          const player = db.getPlayerById(a.playerId);
          if (player && player.userId) {
            const user = db.findUserById(player.userId);
            if (user && user.telegram_chat_id && user.telegram_notifications_enabled !== 0) {
              const buttons = {
                inline_keyboard: [
                  [
                    { text: '🥇 1 место', callback_data: `event_result:submit:${ev.id}:1` },
                    { text: '🥈 2 место', callback_data: `event_result:submit:${ev.id}:2` },
                    { text: '🥉 3 место', callback_data: `event_result:submit:${ev.id}:3` }
                  ],
                  [
                    { text: '🏅 4–10 место', callback_data: `event_result:submit:${ev.id}:4` },
                    { text: '❌ Не участвовал', callback_data: `event_result:submit:${ev.id}:0` }
                  ]
                ]
              };
              await dispatchNotification('event_result_prompt', {
                eventName: et?.name || 'Событие',
                sectorName: player.name || 'Сектор',
                assignedPlace: String(a.place),
                link: `${baseUrl}/#event/${ev.id}`
              }, { userId: user.id, replyMarkup: buttons }).catch(() => {});
              sentCount++;
            }
          }
        }
      }

      return sendJson(res, 200, { success: true, sentCount });
    }

    const summaryEventMatch = pathname.match(/^\/api\/events\/(\d+)\/summary$/);
    if (summaryEventMatch && req.method === 'POST') {
      if (!requirePermission(req, res, 'manage_events')) return;
      const eventId = Number(summaryEventMatch[1]);
      const ev = db.getEventById(eventId);
      if (!ev) return sendError(res, 404, 'EVENT_NOT_FOUND', 'Событие не найдено');

      const baseUrl = getAppBaseUrl(req);
      const et = db.getEventTypes().find(t => t.id === ev.typeId);
      const totalAssigned = (ev.assignments || []).length;
      const confirmedCount = (ev.assignments || []).filter(a => a.resultStatus === 'confirmed').length;
      const unconfirmedCount = totalAssigned - confirmedCount;
      const totalCoupons = (ev.assignments || []).reduce((sum, a) => sum + (Number(a.actualCoupons) || 0), 0);

      await dispatchNotification('staff_event_completed_summary', {
        eventName: et?.name || 'Событие',
        totalAssigned: String(totalAssigned),
        confirmedCount: String(confirmedCount),
        unconfirmedCount: String(unconfirmedCount),
        totalCoupons: String(totalCoupons),
        link: `${baseUrl}/#event/${ev.id}`
      });

      return sendJson(res, 200, { success: true, totalAssigned, confirmedCount, unconfirmedCount, totalCoupons });
    }

    const shareGridEventMatch = pathname.match(/^\/api\/events\/(\d+)\/share-grid$/);
    if (shareGridEventMatch && req.method === 'POST') {
      if (!requirePermission(req, res, 'manage_events')) return;
      const eventId = Number(shareGridEventMatch[1]);
      const ev = db.getEventById(eventId);
      if (!ev) return sendError(res, 404, 'EVENT_NOT_FOUND', 'Событие не найдено');

      const imageBase64 = body && (body.imageBase64 || body.image_base64);
      if (!imageBase64 || typeof imageBase64 !== 'string') {
        return sendError(res, 400, 'VALIDATION_ERROR', 'Параметр imageBase64 обязателен');
      }

      const botToken = db.getAppSetting('telegram_bot_token');
      if (!botToken) {
        return sendError(res, 400, 'BOT_TOKEN_NOT_CONFIGURED', 'Токен бота не настроен в системе');
      }

      const staffChatId = db.getAppSetting('telegram_staff_chat_id');
      if (!staffChatId) {
        return sendError(res, 400, 'STAFF_CHAT_NOT_CONFIGURED', 'Чат штаба не настроен в системе');
      }

      const baseUrl = getAppBaseUrl(req);
      const et = db.getEventTypes().find(t => t.id === ev.typeId);
      const eventTitle = ev.title || et?.name || 'Событие';
      const escape = (typeof logic.escapeHtml === 'function') ? logic.escapeHtml : (s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'));
      const defaultCaption = `📊 <b>Сетка события: ${escape(eventTitle)}</b>\n📅 Период: ${escape(ev.dateFrom || '')} — ${escape(ev.dateTo || '')}\n🎖 Назначений: ${(ev.assignments || []).length}`;
      const caption = (body.caption && String(body.caption).trim()) ? String(body.caption).trim() : defaultCaption;

      const replyMarkup = {
        inline_keyboard: [
          [{ text: '🔗 Открыть сетку ивента', url: `${baseUrl}/#event/${ev.id}` }]
        ]
      };

      const result = await telegram.sendTelegramPhoto({
        token: botToken,
        chatId: staffChatId,
        photo: imageBase64,
        caption,
        parseMode: 'HTML',
        replyMarkup
      });

      if (!result.ok) {
        return sendError(res, 502, 'TELEGRAM_ERROR', result.description || result.error || 'Ошибка отправки изображения в Telegram');
      }

      return sendJson(res, 200, {
        success: true,
        messageId: result.result?.message_id
      });
    }

    // ─────────────────────────────────────────────────────────
    // ADMIN EXPORT & IMPORT
    // ─────────────────────────────────────────────────────────
    if (pathname === '/api/admin/export' && req.method === 'GET') {
      if (!requireRole(['r5'])(req, res)) return;
      const backup = db.exportKowJson();
      return sendJson(res, 200, backup);
    }

    if (pathname === '/api/admin/import' && req.method === 'POST') {
      if (!requireRole(['r5'])(req, res)) return;
      try {
        db.importKowJson(body);
        return sendJson(res, 200, { success: true });
      } catch (err) {
        return sendError(res, 400, 'IMPORT_FAILED', err.message);
      }
    }

    // ─────────────────────────────────────────────────────────
    // ADMIN S3 SYNCHRONIZATION & STATUS
    // ─────────────────────────────────────────────────────────
    if (pathname === '/api/admin/s3-status' && req.method === 'GET') {
      if (!requireRole(['r4', 'r5'])(req, res)) return;
      const status = s3Manager ? s3Manager.getStatus() : { enabled: false };
      return sendJson(res, 200, status);
    }

    if (pathname === '/api/admin/s3-sync' && req.method === 'POST') {
      if (!requireRole(['r5'])(req, res)) return;
      if (!s3Manager || !s3Manager.getStatus().enabled) {
        return sendError(res, 400, 'S3_NOT_CONFIGURED', 'S3-хранилище не настроено в переменных окружения');
      }
      try {
        const syncRes = await s3Manager.pushImmediate();
        return sendJson(res, 200, { success: true, result: syncRes, status: s3Manager.getStatus() });
      } catch (err) {
        return sendError(res, 500, 'S3_SYNC_FAILED', err.message);
      }
    }

    // ─────────────────────────────────────────────────────────
    // SCREENSHOT STORAGE & SERVING
    // ─────────────────────────────────────────────────────────
    const screenshotMatch = pathname.match(/^\/api\/screenshots\/(.+)$/);
    if (screenshotMatch && (req.method === 'GET' || req.method === 'HEAD')) {
      if (!authenticate(req)) {
        return sendError(res, 401, 'UNAUTHORIZED', 'Требуется авторизация');
      }

      const rawParam = screenshotMatch[1];
      let filename = '';
      try {
        filename = decodeURIComponent(rawParam);
      } catch (e) {
        return sendError(res, 400, 'BAD_REQUEST', 'Некорректное имя файла');
      }

      // Check path traversal: forbid '..' or '/' or '\\'
      if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
        return sendError(res, 400, 'BAD_REQUEST', 'Недопустимое имя файла');
      }

      const dbInstance = db.getDb();
      const record = dbInstance.prepare(`
        SELECT shr.*, p.user_id as player_owner_id
        FROM stock_history_records shr
        JOIN players p ON p.id = shr.player_id
        WHERE shr.screenshot_path = ? OR shr.screenshot_path LIKE ('%/' || ?)
      `).get(filename, filename);

      if (!record) {
        return sendError(res, 404, 'NOT_FOUND', 'Скриншот не найден');
      }

      const isStaff = req.user.rank === 'r4' || req.user.rank === 'r5';
      const isOwner = record.player_owner_id === req.user.id || req.user.player_id === record.player_id;
      const hasPerm = logic.hasUserPermission(req.user, 'view_sectors') || logic.hasUserPermission(req.user, 'view_stocks');

      if (!isStaff && !isOwner && !hasPerm) {
        return sendError(res, 403, 'FORBIDDEN', 'Недостаточно прав для просмотра этого скриншота');
      }

      const baseScreenshotsDir = path.resolve(path.join(__dirname, 'data', 'screenshots'));
      const fullFilePath = path.resolve(baseScreenshotsDir, record.screenshot_path);

      if (!fullFilePath.startsWith(baseScreenshotsDir + path.sep)) {
        return sendError(res, 403, 'FORBIDDEN', 'Доступ запрещен');
      }

      if (!fs.existsSync(fullFilePath)) {
        return sendError(res, 404, 'NOT_FOUND', 'Файл скриншота удален или отсутствует');
      }

      const ext = path.extname(fullFilePath).toLowerCase();
      const contentType = ext === '.webp' ? 'image/webp' : (ext === '.png' ? 'image/png' : 'image/jpeg');

      res.writeHead(200, {
        'Content-Type': contentType,
        'Cache-Control': 'private, max-age=86400'
      });

      if (req.method === 'HEAD') {
        return res.end();
      }

      const stream = fs.createReadStream(fullFilePath);
      return stream.pipe(res);
    }

    // ─────────────────────────────────────────────────────────
    // TELEGRAM BOT WEBHOOK & MANAGEMENT ENDPOINTS
    // ─────────────────────────────────────────────────────────

    if (pathname === '/api/telegram/webhook' && req.method === 'POST') {
      const configuredSecret = db.getAppSetting('telegram_webhook_secret');
      if (configuredSecret) {
        const incomingSecret = req.headers['x-telegram-bot-api-secret-token'];
        if (incomingSecret !== configuredSecret) {
          return sendError(res, 401, 'UNAUTHORIZED', 'Invalid webhook secret token');
        }
      }

      try {
        const result = await handleTelegramUpdate(body || {});
        return sendJson(res, 200, result);
      } catch (err) {
        console.error('[Telegram Webhook Error]', err);
        return sendError(res, 500, 'WEBHOOK_ERROR', err.message);
      }
    }

    if (pathname === '/api/telegram/settings' && req.method === 'GET') {
      if (!authenticate(req)) {
        return sendError(res, 401, 'UNAUTHORIZED', 'Требуется авторизация');
      }
      if (req.user.rank !== 'r4' && req.user.rank !== 'r5') {
        return sendError(res, 403, 'FORBIDDEN', 'Требуются права офицера (Р4/Р5)');
      }

      const token = db.getAppSetting('telegram_bot_token');
      const staffChatId = db.getAppSetting('telegram_staff_chat_id');
      const announcementChatId = db.getAppSetting('telegram_announcement_chat_id');
      const botUsername = db.getAppSetting('telegram_bot_username');
      const pollingStatus = telegram.getTelegramPollingStatus();

      let tokenMasked = null;
      if (token && typeof token === 'string') {
        if (token.length > 8) {
          const colonIdx = token.indexOf(':');
          if (colonIdx > 0) {
            tokenMasked = token.slice(0, colonIdx + 1) + '***' + token.slice(-4);
          } else {
            tokenMasked = token.slice(0, 4) + '***' + token.slice(-4);
          }
        } else {
          tokenMasked = '***';
        }
      }

      const webAppUrl = db.getAppSetting('telegram_webapp_url') || db.getAppSetting('app_base_url');

      return sendJson(res, 200, {
        hasToken: Boolean(token),
        tokenMasked,
        staffChatId: staffChatId || null,
        announcementChatId: announcementChatId || null,
        botUsername: botUsername || null,
        webAppUrl: webAppUrl || null,
        polling: pollingStatus
      });
    }

    if (pathname === '/api/telegram/settings' && req.method === 'PUT') {
      if (!authenticate(req)) {
        return sendError(res, 401, 'UNAUTHORIZED', 'Требуется авторизация');
      }
      if (req.user.rank !== 'r5') {
        return sendError(res, 403, 'FORBIDDEN', 'Только Р5 может изменять настройки Telegram бота');
      }

      if (body.token !== undefined) {
        const rawToken = String(body.token).trim();
        db.setAppSetting('telegram_bot_token', rawToken);
      }

      if (body.staffChatId !== undefined) {
        db.setAppSetting('telegram_staff_chat_id', String(body.staffChatId).trim());
      }

      if (body.announcementChatId !== undefined) {
        db.setAppSetting('telegram_announcement_chat_id', String(body.announcementChatId).trim());
      }

      if (body.botUsername !== undefined) {
        const cleanBotUsername = String(body.botUsername).replace(/^@+/, '').trim();
        db.setAppSetting('telegram_bot_username', cleanBotUsername);
      }

      if (body.webAppUrl !== undefined || body.telegram_webapp_url !== undefined) {
        const rawWebAppUrl = String(body.webAppUrl !== undefined ? body.webAppUrl : body.telegram_webapp_url).trim();
        db.setAppSetting('telegram_webapp_url', rawWebAppUrl);
        const liveToken = db.getAppSetting('telegram_bot_token');
        if (liveToken && rawWebAppUrl) {
          telegram.setTelegramChatMenuButton(liveToken, {
            text: '🚀 KoW Tracker',
            url: rawWebAppUrl
          }).catch(err => {
            console.warn('[Telegram] Could not set chat menu button on settings update:', err.message);
          });
        }
      }

      const token = db.getAppSetting('telegram_bot_token');
      const staffChatId = db.getAppSetting('telegram_staff_chat_id');
      const announcementChatId = db.getAppSetting('telegram_announcement_chat_id');
      const botUsername = db.getAppSetting('telegram_bot_username');
      const webAppUrl = db.getAppSetting('telegram_webapp_url') || db.getAppSetting('app_base_url');

      syncTelegramBotInfoAndPolling().catch(err => {
        console.warn('[Telegram] Sync error on settings save:', err.message);
      });

      return sendJson(res, 200, {
        success: true,
        hasToken: Boolean(token),
        staffChatId: staffChatId || null,
        announcementChatId: announcementChatId || null,
        botUsername: botUsername || null,
        webAppUrl: webAppUrl || null,
        polling: telegram.getTelegramPollingStatus()
      });
    }

    // ─────────────────────────────────────────────────────────
    // MIERU TUNNEL SETTINGS & TEST ENDPOINTS
    // ─────────────────────────────────────────────────────────

    if (pathname === '/api/mieru/settings' && req.method === 'GET') {
      if (!authenticate(req)) {
        return sendError(res, 401, 'UNAUTHORIZED', 'Требуется авторизация');
      }
      if (req.user.rank !== 'r4' && req.user.rank !== 'r5') {
        return sendError(res, 403, 'FORBIDDEN', 'Требуются права офицера (Р4/Р5)');
      }

      const settings = db.getMieruSettings();
      const status = mieru.getMieruStatus();

      return sendJson(res, 200, {
        enabled: settings.enabled,
        server: settings.server,
        serverAddress: settings.server,
        portRange: settings.portRange,
        user: settings.user,
        username: settings.user,
        passwordMasked: mieru.maskSecret(settings.password),
        hasPassword: Boolean(settings.password),
        transport: settings.transport,
        socks5Port: settings.socks5Port,
        configJson: settings.configJson,
        rawJson: settings.configJson,
        isRunning: status.running,
        status
      });
    }

    if (pathname === '/api/mieru/settings' && req.method === 'PUT') {
      if (!authenticate(req)) {
        return sendError(res, 401, 'UNAUTHORIZED', 'Требуется авторизация');
      }
      if (req.user.rank !== 'r5') {
        return sendError(res, 403, 'FORBIDDEN', 'Только Р5 может изменять настройки туннеля Mieru');
      }

      const rawJsonInput = body.configJson || body.rawJson;
      const serverInput = body.server || body.serverAddress;
      const userInput = body.user || body.username;

      let configToApply = null;
      if (rawJsonInput && String(rawJsonInput).trim()) {
        const parsed = mieru.parseMieruConfig(rawJsonInput);
        if (!parsed.ok) {
          return sendError(res, 400, 'INVALID_MIERU_JSON', parsed.message);
        }
        configToApply = parsed.config;
        db.saveMieruSettings({
          ...parsed.fields,
          enabled: body.enabled !== undefined ? Boolean(body.enabled) : true,
          configJson: rawJsonInput
        });
      } else {
        const saved = db.saveMieruSettings({
          enabled: body.enabled !== undefined ? Boolean(body.enabled) : undefined,
          server: serverInput,
          portRange: body.portRange,
          user: userInput,
          password: body.password,
          transport: body.transport,
          socks5Port: body.socks5Port,
          configJson: rawJsonInput || ''
        });
        configToApply = mieru.formatMieruConfig(saved);
      }

      const updated = db.getMieruSettings();
      if (updated.enabled && (updated.server || updated.configJson)) {
        const dataDir = path.join(__dirname, 'data');
        if (mieru.isMieruBinaryAvailable()) {
          mieru.startMieruProcess(configToApply, dataDir);
        }
        telegram.setDefaultProxyUrl(`socks5://127.0.0.1:${updated.socks5Port || 1080}`);
      } else {
        mieru.stopMieruProcess();
        telegram.setDefaultProxyUrl(null);
      }

      // Re-sync Telegram polling with new proxy setting
      syncTelegramBotInfoAndPolling().catch(err => {
        console.warn('[Telegram] Sync error on Mieru update:', err.message);
      });

      const status = mieru.getMieruStatus();
      return sendJson(res, 200, {
        success: true,
        enabled: updated.enabled,
        server: updated.server,
        serverAddress: updated.server,
        portRange: updated.portRange,
        user: updated.user,
        username: updated.user,
        passwordMasked: mieru.maskSecret(updated.password),
        hasPassword: Boolean(updated.password),
        transport: updated.transport,
        socks5Port: updated.socks5Port,
        configJson: updated.configJson,
        rawJson: updated.configJson,
        isRunning: status.running,
        status
      });
    }

    if (pathname === '/api/mieru/test' && req.method === 'POST') {
      if (!authenticate(req)) {
        return sendError(res, 401, 'UNAUTHORIZED', 'Требуется авторизация');
      }
      if (req.user.rank !== 'r4' && req.user.rank !== 'r5') {
        return sendError(res, 403, 'FORBIDDEN', 'Требуются права офицера (Р4/Р5)');
      }

      const settings = db.getMieruSettings();
      const botToken = db.getAppSetting('telegram_bot_token');
      const socksPort = settings.socks5Port || 1080;
      const proxyUrl = `socks5://127.0.0.1:${socksPort}`;

      // If mieru binary is available and not running, ensure process is started before test
      const status = mieru.getMieruStatus();
      if (!status.running && mieru.isMieruBinaryAvailable() && (settings.server || settings.configJson)) {
        const fullConfig = settings.configJson
          ? (mieru.parseMieruConfig(settings.configJson).config || mieru.formatMieruConfig(settings))
          : mieru.formatMieruConfig(settings);
        mieru.startMieruProcess(fullConfig, path.join(__dirname, 'data'));
        await new Promise(r => setTimeout(r, 600));
      }

      const testResult = await mieru.testMieruConnection(proxyUrl, botToken);
      return sendJson(res, 200, testResult);
    }

    if (pathname === '/api/telegram/bind-webapp' && req.method === 'POST') {
      if (!authenticate(req)) {
        return sendError(res, 401, 'UNAUTHORIZED', 'Требуется авторизация');
      }
      const botToken = db.getAppSetting('telegram_bot_token');
      if (!botToken) {
        return sendError(res, 503, 'BOT_NOT_CONFIGURED', 'Токен Telegram-бота не настроен');
      }
      const initData = body && (body.initData || body.init_data);
      if (!initData || typeof initData !== 'string') {
        return sendError(res, 400, 'VALIDATION_ERROR', 'Параметр initData обязателен');
      }
      const validation = logic.validateTelegramWebAppData(initData, botToken);
      if (!validation.valid || !validation.user?.id) {
        return sendError(res, 401, 'INVALID_TELEGRAM_DATA', 'Ошибка валидации Telegram WebApp');
      }
      db.bindUserTelegram(req.user.id, validation.user.id, validation.user.username || '');
      const updatedUser = (typeof db.getUserById === 'function') ? db.getUserById(req.user.id) : req.user;
      return sendJson(res, 200, { success: true, user: updatedUser });
    }

    if (pathname === '/api/telegram/bind-token' && req.method === 'POST') {
      if (!authenticate(req)) {
        return sendError(res, 401, 'UNAUTHORIZED', 'Требуется авторизация');
      }

      const token = crypto.randomBytes(16).toString('hex');
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
      db.createTelegramBindToken(req.user.id, token, expiresAt);

      const rawBotUsername = db.getAppSetting('telegram_bot_username');
      let botUsername = String(rawBotUsername || '').replace(/^@+/, '').trim();
      if (!botUsername) {
        const botToken = db.getAppSetting('telegram_bot_token');
        if (botToken) {
          try {
            const me = await telegram.getTelegramMe(botToken, { timeoutMs: 2500 });
            if (me.ok && me.result && me.result.username) {
              botUsername = me.result.username.replace(/^@+/, '');
              db.setAppSetting('telegram_bot_username', botUsername);
            }
          } catch (_) {}
        }
      }
      botUsername = botUsername || 'KoWTrackerBot';
      const deepLink = `https://t.me/${botUsername}?start=bind_${token}`;

      return sendJson(res, 200, {
        token,
        expiresAt,
        deepLink,
        botUsername
      });
    }

    if (pathname === '/api/telegram/bind' && req.method === 'DELETE') {
      if (!authenticate(req)) {
        return sendError(res, 401, 'UNAUTHORIZED', 'Требуется авторизация');
      }
      db.unbindUserTelegram(req.user.id);
      return sendJson(res, 200, { success: true });
    }

    if (pathname === '/api/telegram/notifications' && (req.method === 'PUT' || req.method === 'POST')) {
      if (!authenticate(req)) {
        return sendError(res, 401, 'UNAUTHORIZED', 'Требуется авторизация');
      }
      const enabled = body.enabled !== false && body.enabled !== 0 && body.enabled !== '0';
      db.toggleTelegramNotifications(req.user.id, enabled);
      return sendJson(res, 200, { success: true, enabled });
    }

    if (pathname === '/api/telegram/staff-bind-token' && req.method === 'POST') {
      if (!authenticate(req)) {
        return sendError(res, 401, 'UNAUTHORIZED', 'Требуется авторизация');
      }
      if (req.user.rank !== 'r5') {
        return sendError(res, 403, 'FORBIDDEN', 'Только Р5 может генерировать код привязки чата штаба');
      }

      const pin = `KOW-STAFF-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
      db.createStaffBindToken(pin, expiresAt);

      return sendJson(res, 200, {
        pin,
        expiresAt
      });
    }

    if (pathname === '/api/telegram/channel-bind-token' && req.method === 'POST') {
      if (!authenticate(req)) {
        return sendError(res, 401, 'UNAUTHORIZED', 'Требуется авторизация');
      }
      if (req.user.rank !== 'r5') {
        return sendError(res, 403, 'FORBIDDEN', 'Только Р5 может генерировать код привязки канала анонсов');
      }

      const pin = `KOW-CHAN-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
      db.createChannelBindToken(pin, expiresAt);

      return sendJson(res, 200, {
        pin,
        expiresAt
      });
    }

    if (pathname === '/api/telegram/schedule' && req.method === 'GET') {
      if (!authenticate(req)) {
        return sendError(res, 401, 'UNAUTHORIZED', 'Требуется авторизация');
      }
      if (req.user.rank !== 'r4' && req.user.rank !== 'r5') {
        return sendError(res, 403, 'FORBIDDEN', 'Требуются права офицера (Р4/Р5)');
      }

      const schedule = db.getStaleAlertSchedule();
      const nextRun = logic.calculateNextStaleRun({
        frequency: schedule.frequency,
        time: schedule.time,
        now: new Date(),
        timezoneOffset: schedule.timezoneOffset || 3
      });

      return sendJson(res, 200, {
        success: true,
        schedule,
        nextRun
      });
    }

    if (pathname === '/api/telegram/schedule' && req.method === 'PUT') {
      if (!authenticate(req)) {
        return sendError(res, 401, 'UNAUTHORIZED', 'Требуется авторизация');
      }
      if (req.user.rank !== 'r5') {
        return sendError(res, 403, 'FORBIDDEN', 'Только Р5 может изменять расписание уведомлений');
      }

      const payload = { ...(body || {}) };
      if (payload.time && payload.clientTimezoneOffset !== undefined) {
        const clientOffset = Number(payload.clientTimezoneOffset);
        if (!isNaN(clientOffset) && clientOffset !== 3) {
          payload.time = logic.convertTimeBetweenTimezones(payload.time, clientOffset, 3).time;
        }
      }

      const updated = db.updateStaleAlertSchedule(payload);
      const nextRun = logic.calculateNextStaleRun({
        frequency: updated.frequency,
        time: updated.time,
        now: new Date(),
        timezoneOffset: updated.timezoneOffset || 3
      });

      return sendJson(res, 200, {
        success: true,
        schedule: updated,
        nextRun
      });
    }

    if (pathname === '/api/telegram/check-reminders' && req.method === 'POST') {
      if (!authenticate(req)) {
        return sendError(res, 401, 'UNAUTHORIZED', 'Требуется авторизация');
      }
      if (req.user.rank !== 'r4' && req.user.rank !== 'r5') {
        return sendError(res, 403, 'FORBIDDEN', 'Требуются права офицера (Р4/Р5)');
      }

      const force = (body && body.force !== undefined) ? Boolean(body.force) : true;
      const forcePersonal = Boolean(body && body.forcePersonal);
      const result = await checkStaleStockReminders(req, { isScheduled: false, force, forcePersonal });
      return sendJson(res, 200, { success: true, ...result });
    }

    if (pathname === '/api/telegram/check-morning-reminders' && req.method === 'POST') {
      if (!authenticate(req)) {
        return sendError(res, 401, 'UNAUTHORIZED', 'Требуется авторизация');
      }
      if (req.user.rank !== 'r4' && req.user.rank !== 'r5') {
        return sendError(res, 403, 'FORBIDDEN', 'Требуются права офицера (Р4/Р5)');
      }

      const force = Boolean(body && body.force);
      const now = body && body.now ? body.now : null;
      const targetHour = body && body.targetHour !== undefined ? Number(body.targetHour) : 9;
      const result = await checkScheduledEventMorningReminders(req, { force, now, targetHour });
      return sendJson(res, 200, { success: true, ...result });
    }

    // ─────────────────────────────────────────────────────────
    // NOTIFICATION TEMPLATES ENDPOINTS
    // ─────────────────────────────────────────────────────────

    if (pathname === '/api/notification-templates' && req.method === 'GET') {
      if (!authenticate(req)) {
        return sendError(res, 401, 'UNAUTHORIZED', 'Требуется авторизация');
      }
      if (req.user.rank !== 'r4' && req.user.rank !== 'r5') {
        return sendError(res, 403, 'FORBIDDEN', 'Требуются права офицера (Р4/Р5)');
      }
      const templates = db.getNotificationTemplates();
      return sendJson(res, 200, templates);
    }

    const tplMatch = pathname.match(/^\/api\/notification-templates\/([a-zA-Z0-9_]+)$/);
    if (tplMatch && req.method === 'PUT') {
      if (!authenticate(req)) {
        return sendError(res, 401, 'UNAUTHORIZED', 'Требуется авторизация');
      }
      if (req.user.rank !== 'r4' && req.user.rank !== 'r5') {
        return sendError(res, 403, 'FORBIDDEN', 'Требуются права офицера (Р4/Р5)');
      }
      const key = tplMatch[1];
      const updated = db.updateNotificationTemplate(key, body);
      if (!updated) {
        return sendError(res, 404, 'NOT_FOUND', 'Шаблон не найден');
      }
      return sendJson(res, 200, { success: true, template: updated });
    }

    const tplResetMatch = pathname.match(/^\/api\/notification-templates\/([a-zA-Z0-9_]+)\/reset$/);
    if (tplResetMatch && req.method === 'POST') {
      if (!authenticate(req)) {
        return sendError(res, 401, 'UNAUTHORIZED', 'Требуется авторизация');
      }
      if (req.user.rank !== 'r4' && req.user.rank !== 'r5') {
        return sendError(res, 403, 'FORBIDDEN', 'Требуются права офицера (Р4/Р5)');
      }
      const key = tplResetMatch[1];
      const reset = db.resetNotificationTemplate(key);
      if (!reset) {
        return sendError(res, 404, 'NOT_FOUND', 'Шаблон не найден');
      }
      return sendJson(res, 200, { success: true, template: reset });
    }

    const tplTestMatch = pathname.match(/^\/api\/notification-templates\/([a-zA-Z0-9_]+)\/test$/);
    if (tplTestMatch && req.method === 'POST') {
      if (!authenticate(req)) {
        return sendError(res, 401, 'UNAUTHORIZED', 'Требуется авторизация');
      }
      if (req.user.rank !== 'r4' && req.user.rank !== 'r5') {
        return sendError(res, 403, 'FORBIDDEN', 'Требуются права офицера (Р4/Р5)');
      }
      const key = tplTestMatch[1];
      const tpl = db.getNotificationTemplate(key);
      if (!tpl) {
        return sendError(res, 404, 'NOT_FOUND', 'Шаблон не найден');
      }

      const botToken = db.getAppSetting('telegram_bot_token');
      if (!botToken) {
        return sendError(res, 400, 'NO_BOT_TOKEN', 'Токен Telegram бота не настроен в системе');
      }

      let targetChatId = null;
      if (tpl.channel === 'personal') {
        targetChatId = req.user.telegram_chat_id;
        if (!targetChatId) {
          return sendError(res, 400, 'NO_TELEGRAM_LINKED', 'Привяжите ваш Telegram аккаунт в Личном кабинете для получения тестовых сообщений');
        }
      } else {
        targetChatId = db.getAppSetting('telegram_staff_chat_id');
        if (!targetChatId) {
          return sendError(res, 400, 'NO_STAFF_CHAT_LINKED', 'Чат штаба не привязан. Подключите чат штаба через PIN-код или укажите ID чата в настройках');
        }
        if (targetChatId && !isNaN(Number(targetChatId))) {
          targetChatId = Number(targetChatId);
        }
      }

      const templateText = body.template !== undefined ? body.template : tpl.template;
      const parseMode = body.parseMode || body.parse_mode || tpl.parse_mode || 'HTML';
      const sampleData = logic.NOTIFICATION_TEMPLATE_SAMPLE_DATA[key] || {};
      const renderedText = logic.renderTemplate(templateText, sampleData);

      const sendRes = await telegram.sendTelegramMessage({
        token: botToken,
        chatId: targetChatId,
        text: renderedText,
        parseMode
      });

      if (!sendRes.ok) {
        return sendJson(res, 200, { success: false, error: sendRes.error });
      }

      return sendJson(res, 200, { success: true, messageId: sendRes.result?.message_id });
    }

    // Unmatched API endpoint
    return sendError(res, 404, 'NOT_FOUND', `Endpoint ${pathname} not found`);
    } catch (err) {
      sendError(res, 500, 'INTERNAL_SERVER_ERROR', err.message);
    }
  };
}

async function startServer({ port = 3000, dbPath = 'data/kow.db', staticDir = __dirname, s3Manager = null } = {}) {
  let activeS3Manager = s3Manager;
  if (!activeS3Manager && dbPath !== ':memory:') {
    const s3Config = s3.getS3Config();
    if (s3Config) {
      activeS3Manager = new s3.S3SyncManager({
        config: s3Config,
        dbPath,
        onCheckpoint: () => {
          const currentDb = db.getDb();
          if (currentDb) {
            currentDb.exec('PRAGMA wal_checkpoint(TRUNCATE);');
          }
        }
      });
    }
  }

  if (activeS3Manager && activeS3Manager.getStatus().enabled) {
    try {
      const pullResult = await activeS3Manager.pull(dbPath);
      db.initDb(dbPath);
      if (!pullResult.found) {
        await activeS3Manager.pushImmediate().catch(err => {
          console.error('[S3] Initial push error:', err.message);
        });
      }
    } catch (pullErr) {
      console.error('[S3] Pull failed on startup, continuing with local db:', pullErr.message);
      db.initDb(dbPath);
    }
  } else {
    db.initDb(dbPath);
  }

  // Ensure screenshots base directory exists
  const screenshotsDir = path.join(__dirname, 'data', 'screenshots');
  if (!fs.existsSync(screenshotsDir)) {
    try {
      fs.mkdirSync(screenshotsDir, { recursive: true });
    } catch (_) {}
  }

  // Clean up expired screenshots on startup and schedule 24-hour retention interval
  db.cleanupExpiredScreenshots(null, screenshotsDir).catch(() => {});
  const retentionInterval = setInterval(() => {
    db.cleanupExpiredScreenshots(null, screenshotsDir).catch(err => {
      console.error('[Retention] Cleanup error:', err);
    });
  }, 24 * 60 * 60 * 1000);
  if (retentionInterval.unref) retentionInterval.unref();

  // Schedule minute ticker for configurable stale stock reminders
  const staleReminderInterval = setInterval(() => {
    checkScheduledStaleStockReminders().catch(err => {
      console.error('[Reminders] Error in scheduled stale reminder ticker:', err);
    });
  }, 60 * 1000);
  if (staleReminderInterval.unref) staleReminderInterval.unref();

  // Schedule minute ticker for morning event briefings at 09:00 local time
  const morningReminderInterval = setInterval(() => {
    checkScheduledEventMorningReminders().catch(err => {
      console.error('[MorningReminders] Error in scheduled morning ticker:', err);
    });
  }, 60 * 1000);
  if (morningReminderInterval.unref) morningReminderInterval.unref();

  // Auto-start Mieru tunnel client if enabled
  try {
    const mieruSettings = db.getMieruSettings();
    if (mieruSettings.enabled && (mieruSettings.server || mieruSettings.configJson)) {
      if (mieru.isMieruBinaryAvailable()) {
        const fullConfig = mieruSettings.configJson
          ? (mieru.parseMieruConfig(mieruSettings.configJson).config || mieru.formatMieruConfig(mieruSettings))
          : mieru.formatMieruConfig(mieruSettings);
        mieru.startMieruProcess(fullConfig, path.join(__dirname, 'data'));
      }
      telegram.setDefaultProxyUrl(`socks5://127.0.0.1:${mieruSettings.socks5Port || 1080}`);
    }
  } catch (mErr) {
    console.warn('[Mieru] Auto-start on boot warning:', mErr.message);
  }

  // Auto-sync Telegram Bot and start Long Polling
  try {
    syncTelegramBotInfoAndPolling().catch(err => {
      console.warn('[Telegram] Startup polling warning:', err.message);
    });
  } catch (tErr) {
    console.warn('[Telegram] Startup warning:', tErr.message);
  }

  const server = http.createServer(createRequestHandler(staticDir, activeS3Manager));
  server.s3Manager = activeS3Manager;

  // Promisify close for clean test teardowns
  const originalClose = server.close.bind(server);
  server.close = function (callback) {
    clearInterval(retentionInterval);
    clearInterval(staleReminderInterval);
    clearInterval(morningReminderInterval);
    mieru.stopMieruProcess();
    telegram.stopTelegramPolling();
    telegram.setDefaultProxyUrl(null);
    recentCreatedEventsCache.length = 0;
    return new Promise((resolve, reject) => {
      originalClose(err => {
        if (callback) callback(err);
        if (err) reject(err);
        else resolve();
      });
    });
  };

  return new Promise((resolve, reject) => {
    server.listen(port, () => {
      resolve(server);
    });
    server.on('error', reject);
  });
}

function resolveDbPath() {
  if (process.env.DB_PATH) {
    return process.env.DB_PATH;
  }
  if (fs.existsSync('/app/data')) {
    return '/app/data/kow.db';
  }
  if (fs.existsSync('/data')) {
    return '/data/kow.db';
  }
  return path.join(__dirname, 'data', 'kow.db');
}

if (require.main === module) {
  const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
  const dbPath = resolveDbPath();
  startServer({ port, dbPath }).then(server => {
    console.log(`Server started on port ${server.address().port}, db: ${dbPath}`);

    let isShuttingDown = false;
    async function handleShutdown(signal) {
      if (isShuttingDown) return;
      isShuttingDown = true;
      console.log(`Received ${signal}, starting graceful shutdown...`);
      try {
        const currentDb = db.getDb();
        if (currentDb) {
          console.log('Checkpointing SQLite WAL...');
          currentDb.exec('PRAGMA wal_checkpoint(TRUNCATE);');
        }
        if (server.s3Manager && server.s3Manager.getStatus().enabled) {
          console.log('[S3] Syncing final database state to S3...');
          try {
            await server.s3Manager.pushImmediate();
            console.log('[S3] Final sync to S3 complete.');
          } catch (s3Err) {
            console.error('[S3] Final sync failed:', s3Err.message);
          }
        }
        if (currentDb) {
          currentDb.close();
          console.log('SQLite database closed cleanly.');
        }
      } catch (err) {
        console.error('Error during shutdown:', err);
      }
      server.close(() => {
        console.log('HTTP server closed.');
        process.exit(0);
      });
      setTimeout(() => process.exit(0), 4000).unref();
    }

    process.on('SIGTERM', () => handleShutdown('SIGTERM'));
    process.on('SIGINT', () => handleShutdown('SIGINT'));
  }).catch(err => {
    console.error('Failed to start server:', err);
    process.exit(1);
  });
}

module.exports = {
  startServer,
  createRequestHandler,
  MIME_TYPES,
  dispatchNotification,
  checkStaleStockReminders,
  checkScheduledEventMorningReminders,
  handleTelegramUpdate,
  syncTelegramBotInfoAndPolling,
  setServerOcrRunner,
  tryServerOcr
};
