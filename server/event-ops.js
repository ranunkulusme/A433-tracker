/**
 * KoW Tracker - Deep Module: Event Operations & Lifecycle
 *
 * Consolidates event registration, RSVP confirmations, result submissions,
 * prize coupon accruals, and assignment notifications into a single cohesive module.
 * Zero external dependencies.
 */

function createEventOperations({
  db,
  logic = null,
  dispatchNotification = null,
  notificationEngine = null,
  telegram = null,
  getAppBaseUrl = null
} = {}) {
  if (!db) throw new Error('db is required for EventOperations');
  const sharedLogic = logic || require('../shared/logic.js');

  const resolveBaseUrl = (req = null) => {
    if (typeof getAppBaseUrl === 'function') return getAppBaseUrl(req);
    return db.resolveAppBaseUrl ? db.resolveAppBaseUrl(req) : 'http://localhost:3000';
  };

  function resolveDirectSendOpts() {
    const mieruSettings = db.getMieruSettings ? db.getMieruSettings() : { enabled: false };
    return mieruSettings.enabled ? { proxyUrl: `socks5://127.0.0.1:${mieruSettings.socks5Port || 1080}` } : {};
  }

  /**
   * Check if a user has staff permissions (R4 or R5 or specific permission).
   */
  function isStaffUser(user, permission = 'manage_events') {
    if (!user) return false;
    if (user.rank === 'r5' || user.rank === 'r4') return true;
    if (sharedLogic && typeof sharedLogic.hasUserPermission === 'function') {
      return sharedLogic.hasUserPermission(user, permission);
    }
    return false;
  }

  /**
   * RSVP Confirmation or Decline for an assigned place in an event.
   */
  async function rsvpEvent({ eventId, place, status, user, req = null }) {
    if (!user) {
      return { ok: false, status: 401, error: 'UNAUTHORIZED', message: 'Требуется авторизация' };
    }

    const placeNum = Number(place);
    const normStatus = String(status).toLowerCase();
    if (!['confirmed', 'declined'].includes(normStatus)) {
      return { ok: false, status: 400, error: 'VALIDATION_ERROR', message: 'Статус должен быть confirmed или declined' };
    }

    const ev = db.getEventById(Number(eventId));
    if (!ev) {
      return { ok: false, status: 404, error: 'EVENT_NOT_FOUND', message: 'Событие не найдено' };
    }

    const assignment = (ev.assignments || []).find(a => Number(a.place) === placeNum);
    if (!assignment) {
      return { ok: false, status: 404, error: 'ASSIGNMENT_NOT_FOUND', message: 'Назначение на это место не найдено' };
    }

    const player = db.getPlayerById(assignment.playerId);
    const isOwner = player && player.userId === user.id;
    const isStaff = isStaffUser(user, 'manage_events');

    if (!isOwner && !isStaff) {
      return { ok: false, status: 403, error: 'FORBIDDEN', message: 'Вы не назначены на это призовое место' };
    }

    assignment.rsvpStatus = normStatus;
    assignment.rsvpAt = new Date().toISOString();
    const saved = db.saveEvent(ev);

    // If declined, alert staff chat via NotificationEngine (or Mieru-aware fallback)
    if (normStatus === 'declined') {
      const et = (db.getEventTypes ? db.getEventTypes() : []).find(t => t.id === ev.typeId);
      const staffAlertText = `⚠️ <b>Отказ от участия в событии!</b>\n\n` +
        `Боец: <b>@${user.username || 'боец'}</b>\n` +
        `Сектор: <b>${player?.name || 'Сектор'}</b>\n` +
        `Событие: <b>${et?.name || 'Событие'}</b>\n` +
        `Освобождено место: <b>#${placeNum}</b>\n\n` +
        `<i>Место свободно для повторного распределения или резервиста!</i>`;

      if (notificationEngine && typeof notificationEngine.sendDirectMessage === 'function') {
        await notificationEngine.sendDirectMessage({
          channel: 'staff',
          text: staffAlertText,
          parseMode: 'HTML'
        }).catch(() => {});
      } else {
        const token = db.getAppSetting('telegram_bot_token');
        let staffChatId = db.getAppSetting('telegram_staff_chat_id');
        if (staffChatId && token && telegram && typeof telegram.sendTelegramMessage === 'function') {
          if (!isNaN(Number(staffChatId))) staffChatId = Number(staffChatId);
          await telegram.sendTelegramMessage({
            token,
            chatId: staffChatId,
            text: staffAlertText,
            parseMode: 'HTML'
          }, resolveDirectSendOpts()).catch(() => {});
        }
      }
    }

    return {
      ok: true,
      success: true,
      action: normStatus,
      eventId: ev.id,
      place: placeNum,
      event: saved
    };
  }

  /**
   * Submit event result and accrue prize coupons to warehouse.
   */
  async function submitEventResult({
    eventId,
    place,
    actualPlace,
    user,
    req = null,
    submittedBy = 'web'
  }) {
    if (!user) {
      return { ok: false, status: 401, error: 'UNAUTHORIZED', message: 'Требуется авторизация' };
    }

    const ev = db.getEventById(Number(eventId));
    if (!ev) {
      return { ok: false, status: 404, error: 'EVENT_NOT_FOUND', message: 'Событие не найдено' };
    }

    const placeNum = place !== undefined && place !== null ? Number(place) : null;
    const actualPlaceNum = Number(actualPlace);

    let assignment = null;
    if (placeNum) {
      assignment = (ev.assignments || []).find(a => Number(a.place) === placeNum);
    } else {
      assignment = (ev.assignments || []).find(a => {
        const p = db.getPlayerById(a.playerId);
        return p && p.userId === user.id;
      });
    }

    if (!assignment) {
      return { ok: false, status: 404, error: 'ASSIGNMENT_NOT_FOUND', message: 'Назначение на это место не найдено' };
    }

    const player = db.getPlayerById(assignment.playerId);
    const isOwner = player && player.userId === user.id;
    const isStaff = isStaffUser(user, 'manage_events');

    if (!isOwner && !isStaff) {
      return { ok: false, status: 403, error: 'FORBIDDEN', message: 'Вы не являетесь участником этого события' };
    }

    if (assignment.accrued && assignment.actualPlace === actualPlaceNum) {
      return { ok: false, status: 409, error: 'ALREADY_ACCRUED', message: 'Результат и награды уже зафиксированы ранее' };
    }

    // Resolve event places prize coupons
    const et = (db.getEventTypes ? db.getEventTypes() : []).find(t => t.id === ev.typeId);
    const places = et
      ? (sharedLogic && typeof sharedLogic.resolveEventPlaces === 'function' ? sharedLogic.resolveEventPlaces(et, ev.dateFrom) : (et.places || []))
      : [];
    const placeInfo = actualPlaceNum > 0 ? places.find(p => Number(p.place) === actualPlaceNum) : null;
    const prizeCoupons = placeInfo ? (Number(placeInfo.coupons) || 0) : 0;

    const previousCoupons = (assignment.accrued && assignment.actualCoupons !== undefined)
      ? (Number(assignment.actualCoupons) || 0)
      : 0;
    const wasRecalculation = Boolean(assignment.accrued && assignment.actualPlace !== actualPlaceNum);
    const couponDiff = assignment.accrued
      ? (prizeCoupons - previousCoupons)
      : prizeCoupons;

    assignment.actualPlace = actualPlaceNum;
    assignment.actualCoupons = prizeCoupons;
    assignment.resultStatus = 'confirmed';
    assignment.accrued = true;
    assignment.resultSubmittedAt = new Date().toISOString();
    assignment.submittedBy = submittedBy;

    let updatedStock = null;
    if (player && couponDiff !== 0) {
      const curStock = player.stock || {};
      const oldCoupons = Number(curStock.coupons) || 0;
      updatedStock = { ...curStock, coupons: Math.max(0, oldCoupons + couponDiff) };
      db.updatePlayer(player.id, {
        stock: updatedStock,
        recordHistory: false
      });
      if (typeof db.recordStockHistory === 'function') {
        db.recordStockHistory({
          playerId: player.id,
          userId: user.id,
          source: 'event_reward',
          snapshotBefore: curStock,
          snapshotAfter: updatedStock,
          diffSummary: wasRecalculation
            ? `Корректировка награды за ${et?.name || 'ивент'}: ${couponDiff > 0 ? '+' : ''}${couponDiff} куп. (место #${actualPlaceNum})`
            : `Награда за событие ${et?.name || 'ивент'}: +${prizeCoupons} купонов (место #${actualPlaceNum})`,
          screenshotPath: null,
          createdAt: new Date().toISOString()
        });
      }
    }

    const saved = db.saveEvent(ev);

    return {
      ok: true,
      success: true,
      event: saved,
      place: assignment.place,
      actualPlace: actualPlaceNum,
      prizeCoupons,
      updatedStock
    };
  }

  /**
   * Register player for an event slot.
   */
  async function registerForEvent({ eventId, playerId, officerId, desiredPlace = 0, user, req = null }) {
    if (!user) {
      return { ok: false, status: 401, error: 'UNAUTHORIZED', message: 'Требуется авторизация' };
    }

    const targetSectorId = Number(playerId);
    if (!targetSectorId) {
      return { ok: false, status: 400, error: 'NO_LINKED_PLAYER', message: 'К вашему аккаунту не привязан профиль игрока' };
    }

    const player = db.getPlayerById(targetSectorId);
    if (!player) {
      return { ok: false, status: 404, error: 'PLAYER_NOT_FOUND', message: 'Сектор не найден' };
    }

    const isStaff = isStaffUser(user, 'manage_events');
    if (!isStaff && player.userId !== user.id) {
      return { ok: false, status: 403, error: 'FORBIDDEN', message: 'Вы не являетесь владельцем этого сектора' };
    }

    const ev = db.getEventById(Number(eventId));
    if (!ev) {
      return { ok: false, status: 404, error: 'EVENT_NOT_FOUND', message: 'Событие не найдено' };
    }

    const catalog = db.getCatalog ? db.getCatalog() : [];
    let finalOfficerId = officerId;
    if (finalOfficerId) {
      const pOfficers = Array.isArray(player.officers) ? player.officers : [];
      const off = pOfficers.find(o => String(o.id) === String(finalOfficerId) || String(o.catalogId) === String(finalOfficerId));
      if (off) {
        const isEligible = typeof sharedLogic.isOfficerEligibleForEvents === 'function'
          ? sharedLogic.isOfficerEligibleForEvents(off, catalog)
          : !Boolean(off.onlyPersonalPuzzles || off.only_personal_puzzles);
        if (!isEligible) {
          return { ok: false, status: 400, error: 'OFFICER_ONLY_PERSONAL_PUZZLES', message: 'Этот офицер качается только за счет личных пазлов и не участвует в распределении ивентов' };
        }
      } else {
        const catItem = (catalog || []).find(c => c.id === String(finalOfficerId));
        if (catItem) {
          const isEligible = typeof sharedLogic.isOfficerEligibleForEvents === 'function'
            ? sharedLogic.isOfficerEligibleForEvents({ catalogId: catItem.id }, catalog)
            : (catItem.upgradeType !== 'special' && Number(catItem.couponPerPuzzle) > 0);
          if (!isEligible) {
            return { ok: false, status: 400, error: 'OFFICER_ONLY_PERSONAL_PUZZLES', message: 'Этот офицер качается только за счет личных пазлов и не участвует в распределении ивентов' };
          }
        }
      }
    } else {
      if (typeof sharedLogic.selectOptimalEventOfficer === 'function') {
        const optimal = sharedLogic.selectOptimalEventOfficer({ player, catalog, eventDate: ev.dateFrom });
        finalOfficerId = optimal.officerId || (optimal.officer ? (optimal.officer.catalogId || optimal.officer.id) : '');
      } else {
        const pOfficers = Array.isArray(player.officers) ? player.officers : [];
        const off = pOfficers.find(o => {
          return typeof sharedLogic.isOfficerEligibleForEvents === 'function'
            ? sharedLogic.isOfficerEligibleForEvents(o, catalog)
            : !Boolean(o.onlyPersonalPuzzles || o.only_personal_puzzles);
        }) || pOfficers[0];
        finalOfficerId = (off ? (off.catalogId || off.id) : '') || '';
      }
    }

    const existingRegistrations = typeof db.getRegistrationsByEventId === 'function'
      ? db.getRegistrationsByEventId(Number(eventId))
      : (typeof db.getRegistrationsForEvent === 'function' ? db.getRegistrationsForEvent(Number(eventId)) : []);
    const prevReg = (existingRegistrations || []).find(r => Number(r.playerId) === Number(targetSectorId));
    const targetDesiredPlace = Number(desiredPlace) || 0;
    const targetOfficerId = String(finalOfficerId || '');
    const isUnchanged = prevReg &&
      Number(prevReg.desiredPlace || 0) === targetDesiredPlace &&
      String(prevReg.officerId || '') === targetOfficerId;

    const registration = db.registerForEvent({
      eventId: Number(eventId),
      playerId: targetSectorId,
      officerId: targetOfficerId,
      desiredPlace: targetDesiredPlace
    });

    // Notify staff only if registration is new or modified
    if (!isUnchanged && typeof dispatchNotification === 'function') {
      try {
        const et = db.getEventTypeById ? db.getEventTypeById(ev.typeId) : null;
        const placeStr = targetDesiredPlace > 0 ? `#${targetDesiredPlace}` : 'Любое';
        const baseUrl = resolveBaseUrl(req);
        dispatchNotification('staff_event_registration', {
          eventId: Number(eventId),
          playerId: targetSectorId,
          eventName: et?.name || `Событие #${eventId}`,
          sectorName: player.name || `Сектор #${player.id}`,
          desiredPlace: placeStr,
          link: `${baseUrl}/#event/${eventId}`
        }).catch(() => {});
      } catch (_) {}
    }

    return {
      ok: true,
      success: true,
      eventId: Number(eventId),
      playerId: targetSectorId,
      desiredPlace: targetDesiredPlace,
      registration
    };
  }

  /**
   * Cancel event registration.
   */
  async function unregisterFromEvent({ eventId, playerId, user }) {
    if (!user) {
      return { ok: false, status: 401, error: 'UNAUTHORIZED', message: 'Требуется авторизация' };
    }

    const targetSectorId = Number(playerId);
    if (!targetSectorId) {
      return { ok: false, status: 400, error: 'NO_LINKED_PLAYER', message: 'К вашему аккаунту не привязан профиль игрока' };
    }

    const player = db.getPlayerById(targetSectorId);
    if (!player) {
      return { ok: false, status: 404, error: 'PLAYER_NOT_FOUND', message: 'Сектор не найден' };
    }

    const isStaff = isStaffUser(user, 'manage_events');
    if (!isStaff && player.userId !== user.id) {
      return { ok: false, status: 403, error: 'FORBIDDEN', message: 'Вы не являетесь владельцем этого сектора' };
    }

    db.unregisterFromEvent(Number(eventId), targetSectorId);
    return { ok: true, success: true, eventId: Number(eventId), playerId: targetSectorId };
  }

  /**
   * Send RSVP notifications to players newly assigned to places in an event,
   * and optionally dispatch staff autopick/assignment summary.
   */
  async function notifyAssignedPlayers({
    event,
    previousAssignments = [],
    includeStaffSummary = false,
    isNew = false,
    req = null
  }) {
    if (!event || !dispatchNotification) return;

    try {
      const assignedList = (event.assignments || []).filter(a => a.playerId && Number(a.place) > 0);
      if (assignedList.length === 0) return;

      const eventTypes = db.getEventTypes ? db.getEventTypes() : [];
      const et = eventTypes.find(t => t.id === event.typeId);
      const effectivePlaces = et
        ? (sharedLogic && typeof sharedLogic.resolveEventPlaces === 'function' ? sharedLogic.resolveEventPlaces(et, event.dateFrom) : (et.places || []))
        : [];
      const players = db.getPlayers ? db.getPlayers() : [];
      const users = db.getUsers ? db.getUsers() : [];
      const baseUrl = resolveBaseUrl(req);

      let newAssignmentsCount = 0;
      for (const a of assignedList) {
        const already = (previousAssignments || []).some(
          pa => pa.playerId === a.playerId && Number(pa.place) === Number(a.place)
        );
        if (already) continue;
        newAssignmentsCount++;

        const player = players.find(p => p.id === a.playerId) || (db.getPlayerById ? db.getPlayerById(a.playerId) : null);
        if (player && player.userId) {
          const user = users.find(u => u.id === player.userId) || (db.findUserById ? db.findUserById(player.userId) : null);
          if (user) {
            const coupons = a.coupons !== undefined
              ? String(a.coupons)
              : String(effectivePlaces.find(p => Number(p.place) === Number(a.place))?.coupons || 0);
            const rsvpMarkup = {
              inline_keyboard: [
                [
                  { text: '✅ Подтверждаю участие', callback_data: `rsvp_event:confirm:${event.id}:${a.place}` },
                  { text: '❌ Не смогу участвовать', callback_data: `rsvp_event:decline:${event.id}:${a.place}` }
                ]
              ]
            };
            await dispatchNotification('event_place_assigned', {
              username: user.username,
              sectorName: player.name || a.playerName || 'Сектор',
              eventName: et?.name || 'Событие',
              eventDate: event.dateFrom || '',
              place: String(a.place),
              coupons,
              link: `${baseUrl}/#event/${event.id}`
            }, { userId: user.id, replyMarkup: rsvpMarkup }).catch(() => {});
          }
        }
      }

      if (includeStaffSummary && (newAssignmentsCount > 0 || isNew)) {
        const escape = (sharedLogic && typeof sharedLogic.escapeHtml === 'function')
          ? sharedLogic.escapeHtml
          : (s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'));
        const topFormatted = [...assignedList]
          .sort((x, y) => Number(x.place) - Number(y.place))
          .slice(0, 5)
          .map((a, idx) => {
            const p = players.find(pl => pl.id === a.playerId);
            const vipStr = (p && p.vip !== undefined) ? ` (VIP ${p.vip})` : '';
            const safeName = escape(a.playerName || p?.name || 'Сектор');
            return `${idx + 1}. #${a.place}: ${safeName}${vipStr}`;
          })
          .join('\n');

        await dispatchNotification('staff_event_autopick_summary', {
          eventName: et?.name || 'Событие',
          assignedCount: String(assignedList.length),
          availablePlaces: String(effectivePlaces.length),
          topAssignmentsList: topFormatted || 'Назначений нет',
          link: `${baseUrl}/#event/${event.id}`
        }).catch(() => {});
      }
    } catch (err) {
      console.warn('[EventOperations] Error notifying assigned players:', err.message);
    }
  }

  /**
   * Resolve or auto-create an event type matching preset/name identifier.
   */
  function ensureEventType(identifier, defaultColor) {
    const search = String(identifier || '').trim().toLowerCase();
    const cachedEventTypes = db.getEventTypes ? db.getEventTypes() : [];
    let found = cachedEventTypes.find(t => t.name && t.name.trim().toLowerCase() === search);

    const preset = (sharedLogic.EVENT_PRESETS || []).find(
      p => p.id === search || p.name.trim().toLowerCase() === search
    );
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
          { place: 4, label: '4–10 место', coupons: 2750 }
        ]
      });
    }
    return found;
  }

  /**
   * Generate/save multi-week season event schedule.
   */
  function scheduleSeason(body = {}) {
    const createdEvents = [];

    if (Array.isArray(body?.events)) {
      for (const item of body.events) {
        if (!item || !item.dateFrom || !item.dateTo) continue;
        let et = null;
        if (item.typeId && typeof item.typeId === 'number') {
          const allTypes = db.getEventTypes ? db.getEventTypes() : [];
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
          assignments: item.assignments || []
        });
        createdEvents.push(saved);
      }
    } else if (body?.rules || body?.totalWeeks) {
      const normalizedRules = Array.isArray(body.rules) ? body.rules.map(r => ({
        ...r,
        name: r.name || r.typeName,
        startDayOfWeek: r.startDayOfWeek || r.dayOfWeek
      })) : undefined;

      const scheduleItems = sharedLogic.generateSeasonSchedule({
        startDate: body.startDate || new Date().toISOString().slice(0, 10),
        totalWeeks: body.totalWeeks,
        rules: normalizedRules
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
      const { presetId = 'king-of-war', startDate, cyclesCount = 1 } = body || {};
      const preset = (sharedLogic.EVENT_PRESETS || []).find(p => p.id === presetId)
        || (sharedLogic.EVENT_PRESETS && sharedLogic.EVENT_PRESETS[0])
        || { id: 'king-of-war', name: 'Король Войны', cycleDays: 14, durationDays: 2 };

      const eventType = ensureEventType(preset.name, preset.color);
      const count = Math.max(1, Number(cyclesCount) || 1);
      const scheduleItems = sharedLogic.generateSeasonSchedule({
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

    return {
      success: true,
      count: createdEvents.length,
      createdCount: createdEvents.length,
      events: createdEvents
    };
  }

  /**
   * Calculate fair-play smart autopick slot distribution for an event.
   */
  function runSmartAutopick(eventId) {
    const ev = db.getEventById(Number(eventId));
    if (!ev) {
      return { success: false, error: 'EVENT_NOT_FOUND', message: 'Ивент не найден' };
    }

    const eventTypes = db.getEventTypes ? db.getEventTypes() : [];
    const et = eventTypes.find(t => t.id === ev.typeId);
    const places = et
      ? (typeof sharedLogic.resolveEventPlaces === 'function' ? sharedLogic.resolveEventPlaces(et, ev.dateFrom) : et.places)
      : [];

    const players = db.getPlayers ? db.getPlayers() : [];
    const officerCatalog = db.getCatalog ? db.getCatalog() : [];
    const registrations = db.getRegistrationsByEventId ? db.getRegistrationsByEventId(eventId) : [];
    const recentWinners = typeof db.getRecentWinners === 'function'
      ? db.getRecentWinners(ev.typeId || ev.type_id, 2, ev.id)
      : [];

    const result = sharedLogic.smartAutoPickWithRegistrations({
      event: { ...ev, places },
      players,
      registrations,
      officerCatalog,
      eventDate: ev.dateFrom,
      recentWinners
    });

    return {
      success: true,
      event: ev,
      eventType: et,
      assignments: result.assignments || [],
      unassignedCandidates: result.unassignedCandidates || []
    };
  }

  /**
   * Send result prompt notifications to participants who have not confirmed yet.
   */
  async function finishEvent({ eventId, req = null }) {
    const ev = db.getEventById(Number(eventId));
    if (!ev) {
      return { ok: false, status: 404, error: 'EVENT_NOT_FOUND', message: 'Событие не найдено' };
    }

    const baseUrl = resolveBaseUrl(req);
    const et = (db.getEventTypes ? db.getEventTypes() : []).find(t => t.id === ev.typeId);
    let sentCount = 0;

    if (typeof dispatchNotification === 'function') {
      for (const a of (ev.assignments || [])) {
        if (!a.resultStatus || a.resultStatus === 'pending') {
          const player = db.getPlayerById(a.playerId);
          if (player && player.userId) {
            const user = db.findUserById(player.userId);
            const userChatId = user && (user.telegramChatId || user.telegram_chat_id);
            const userEnabled = user && (user.telegramNotificationsEnabled !== false) && (user.telegram_notifications_enabled !== 0);
            if (user && userChatId && userEnabled) {
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
    }

    return { ok: true, sentCount };
  }

  /**
   * Dispatch staff summary report after event completion.
   */
  async function summarizeEvent({ eventId, req = null }) {
    const ev = db.getEventById(Number(eventId));
    if (!ev) {
      return { ok: false, status: 404, error: 'EVENT_NOT_FOUND', message: 'Событие не найдено' };
    }

    const baseUrl = resolveBaseUrl(req);
    const et = (db.getEventTypes ? db.getEventTypes() : []).find(t => t.id === ev.typeId);
    const totalAssigned = (ev.assignments || []).length;
    const confirmedCount = (ev.assignments || []).filter(a => a.resultStatus === 'confirmed').length;
    const unconfirmedCount = totalAssigned - confirmedCount;
    const totalCoupons = (ev.assignments || []).reduce((sum, a) => sum + (Number(a.actualCoupons) || 0), 0);

    if (typeof dispatchNotification === 'function') {
      await dispatchNotification('staff_event_completed_summary', {
        eventName: et?.name || 'Событие',
        totalAssigned: String(totalAssigned),
        confirmedCount: String(confirmedCount),
        unconfirmedCount: String(unconfirmedCount),
        totalCoupons: String(totalCoupons),
        link: `${baseUrl}/#event/${ev.id}`
      }).catch(() => {});
    }

    return { ok: true, totalAssigned, confirmedCount, unconfirmedCount, totalCoupons };
  }

  /**
   * Share event grid image infographic to staff and/or announcement channel.
   */
  async function shareEventGrid({ eventId, target = 'staff', imageBase64, caption = '', req = null }) {
    const ev = db.getEventById(Number(eventId));
    if (!ev) {
      return { ok: false, status: 404, error: 'EVENT_NOT_FOUND', message: 'Событие не найдено' };
    }

    if (!imageBase64 || typeof imageBase64 !== 'string') {
      return { ok: false, status: 400, error: 'VALIDATION_ERROR', message: 'Параметр imageBase64 обязателен' };
    }

    const baseUrl = resolveBaseUrl(req);
    const et = (db.getEventTypes ? db.getEventTypes() : []).find(t => t.id === ev.typeId);
    const eventTitle = ev.title || et?.name || 'Событие';
    const escape = (sharedLogic && typeof sharedLogic.escapeHtml === 'function')
      ? sharedLogic.escapeHtml
      : (s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'));
    const defaultCaption = `📊 <b>Сетка события: ${escape(eventTitle)}</b>\n📅 Период: ${escape(ev.dateFrom || '')} — ${escape(ev.dateTo || '')}\n🎖 Назначений: ${(ev.assignments || []).length}`;
    const resolvedCaption = (caption && String(caption).trim()) ? String(caption).trim() : defaultCaption;

    const replyMarkup = {
      inline_keyboard: [
        [{ text: '🔗 Открыть сетку ивента', url: `${baseUrl}/#event/${ev.id}` }]
      ]
    };

    if (notificationEngine && typeof notificationEngine.sendChannelPhoto === 'function') {
      return notificationEngine.sendChannelPhoto({
        target,
        photo: imageBase64,
        caption: resolvedCaption,
        parseMode: 'HTML',
        replyMarkup
      });
    }

    return { ok: false, status: 500, error: 'NOTIFICATION_ENGINE_UNAVAILABLE', message: 'Сервис уведомлений недоступен' };
  }

  return {
    rsvpEvent,
    submitEventResult,
    registerForEvent,
    unregisterFromEvent,
    notifyAssignedPlayers,
    ensureEventType,
    scheduleSeason,
    runSmartAutopick,
    finishEvent,
    summarizeEvent,
    shareEventGrid
  };
}

module.exports = {
  createEventOperations
};
