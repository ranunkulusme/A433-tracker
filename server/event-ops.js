/**
 * KoW Tracker - Deep Module: Event Operations & Lifecycle
 *
 * Consolidates event registration, RSVP confirmations, result submissions,
 * prize coupon accruals, and assignment notifications into a single cohesive module.
 * Zero external dependencies.
 */

function createEventOperations({
  db,
  logic,
  dispatchNotification = null,
  telegram = null,
  getAppBaseUrl = null
} = {}) {
  if (!db) throw new Error('db is required for EventOperations');

  const resolveBaseUrl = (req = null) => {
    if (typeof getAppBaseUrl === 'function') return getAppBaseUrl(req);
    const configuredUrl = db.getAppSetting('telegram_webapp_url') || db.getAppSetting('app_base_url');
    if (configuredUrl) return String(configuredUrl).replace(/\/+$/, '');
    return 'http://localhost:3000';
  };

  /**
   * Check if a user has staff permissions (R4 or R5 or specific permission).
   */
  function isStaffUser(user, permission = 'manage_events') {
    if (!user) return false;
    if (user.rank === 'r5' || user.rank === 'r4') return true;
    if (logic && typeof logic.hasUserPermission === 'function') {
      return logic.hasUserPermission(user, permission);
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

    // If declined, alert staff chat
    if (normStatus === 'declined') {
      const et = (db.getEventTypes ? db.getEventTypes() : []).find(t => t.id === ev.typeId);
      const token = db.getAppSetting('telegram_bot_token');
      let staffChatId = db.getAppSetting('telegram_staff_chat_id');
      if (staffChatId && token && telegram && typeof telegram.sendTelegramMessage === 'function') {
        if (!isNaN(Number(staffChatId))) staffChatId = Number(staffChatId);
        const staffAlertText = `⚠️ <b>Отказ от участия в событии!</b>\n\n` +
          `Боец: <b>@${user.username || 'боец'}</b>\n` +
          `Сектор: <b>${player?.name || 'Сектор'}</b>\n` +
          `Событие: <b>${et?.name || 'Событие'}</b>\n` +
          `Освобождено место: <b>#${placeNum}</b>\n\n` +
          `<i>Место свободно для повторного распределения или резервиста!</i>`;
        telegram.sendTelegramMessage({
          token,
          chatId: staffChatId,
          text: staffAlertText,
          parseMode: 'HTML'
        }).catch(() => {});
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
      ? (logic && typeof logic.resolveEventPlaces === 'function' ? logic.resolveEventPlaces(et, ev.dateFrom) : (et.places || []))
      : [];
    const placeInfo = actualPlaceNum > 0 ? places.find(p => Number(p.place) === actualPlaceNum) : null;
    const prizeCoupons = placeInfo ? (Number(placeInfo.coupons) || 0) : 0;

    const previousCoupons = (assignment.accrued && assignment.actualCoupons !== undefined)
      ? (Number(assignment.actualCoupons) || 0)
      : 0;
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
          diffSummary: assignment.accrued && assignment.actualPlace !== actualPlaceNum
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
        const isEligible = typeof logic.isOfficerEligibleForEvents === 'function'
          ? logic.isOfficerEligibleForEvents(off, catalog)
          : !Boolean(off.onlyPersonalPuzzles || off.only_personal_puzzles);
        if (!isEligible) {
          return { ok: false, status: 400, error: 'OFFICER_ONLY_PERSONAL_PUZZLES', message: 'Этот офицер качается только за счет личных пазлов и не участвует в распределении ивентов' };
        }
      } else {
        const catItem = (catalog || []).find(c => c.id === String(finalOfficerId));
        if (catItem) {
          const isEligible = typeof logic.isOfficerEligibleForEvents === 'function'
            ? logic.isOfficerEligibleForEvents({ catalogId: catItem.id }, catalog)
            : (catItem.upgradeType !== 'special' && Number(catItem.couponPerPuzzle) > 0);
          if (!isEligible) {
            return { ok: false, status: 400, error: 'OFFICER_ONLY_PERSONAL_PUZZLES', message: 'Этот офицер качается только за счет личных пазлов и не участвует в распределении ивентов' };
          }
        }
      }
    } else {
      if (typeof logic.selectOptimalEventOfficer === 'function') {
        const optimal = logic.selectOptimalEventOfficer({ player, catalog, eventDate: ev.dateFrom });
        finalOfficerId = optimal.officerId || (optimal.officer ? (optimal.officer.catalogId || optimal.officer.id) : '');
      } else {
        const pOfficers = Array.isArray(player.officers) ? player.officers : [];
        const off = pOfficers.find(o => {
          return typeof logic.isOfficerEligibleForEvents === 'function'
            ? logic.isOfficerEligibleForEvents(o, catalog)
            : !Boolean(o.onlyPersonalPuzzles || o.only_personal_puzzles);
        }) || pOfficers[0];
        finalOfficerId = (off ? (off.catalogId || off.id) : '') || '';
      }
    }

    db.registerForEvent({
      eventId: Number(eventId),
      playerId: targetSectorId,
      officerId: String(finalOfficerId || ''),
      desiredPlace: Number(desiredPlace) || 0
    });

    // Notify staff
    if (typeof dispatchNotification === 'function') {
      try {
        const et = db.getEventTypeById ? db.getEventTypeById(ev.typeId) : null;
        const placeStr = desiredPlace > 0 ? `#${desiredPlace}` : 'Любое';
        const baseUrl = resolveBaseUrl(req);
        dispatchNotification('staff_event_registration', {
          eventName: et?.name || `Событие #${eventId}`,
          sectorName: player.name || `Сектор #${player.id}`,
          desiredPlace: placeStr,
          link: `${baseUrl}/#events`
        }).catch(() => {});
      } catch (_) {}
    }

    return {
      ok: true,
      success: true,
      eventId: Number(eventId),
      playerId: targetSectorId,
      desiredPlace: Number(desiredPlace) || 0
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
   * Send RSVP notifications to players newly assigned to places in an event.
   */
  async function notifyAssignedPlayers({ event, previousAssignments = [], req = null }) {
    if (!event || !dispatchNotification) return;

    try {
      const eventTypes = db.getEventTypes ? db.getEventTypes() : [];
      const et = eventTypes.find(t => t.id === event.typeId);
      const effectivePlaces = et
        ? (logic && typeof logic.resolveEventPlaces === 'function' ? logic.resolveEventPlaces(et, event.dateFrom) : (et.places || []))
        : [];
      const players = db.getPlayers ? db.getPlayers() : [];
      const users = db.getUsers ? db.getUsers() : [];
      const baseUrl = resolveBaseUrl(req);

      const prevAssignedMap = new Map((previousAssignments || []).map(a => [Number(a.playerId), Number(a.place)]));
      const currentAssignments = event.assignments || [];

      for (const a of currentAssignments) {
        if (!a.playerId) continue;
        const prevPlace = prevAssignedMap.get(Number(a.playerId));
        // Only notify if this is a newly assigned player or changed place
        if (!prevPlace || prevPlace !== Number(a.place)) {
          const player = players.find(p => p.id === a.playerId);
          if (player && player.userId) {
            const user = users.find(u => u.id === player.userId);
            if (user) {
              const coupons = String(effectivePlaces.find(p => Number(p.place) === Number(a.place))?.coupons || 0);
              const rsvpMarkup = {
                inline_keyboard: [
                  [
                    { text: '✅ Подтверждаю участие', callback_data: `rsvp_event:confirm:${event.id}:${a.place}` },
                    { text: '❌ Не смогу участвовать', callback_data: `rsvp_event:decline:${event.id}:${a.place}` }
                  ]
                ]
              };
              dispatchNotification('event_place_assigned', {
                username: user.username,
                sectorName: player.name || a.playerName || 'Сектор',
                eventName: et?.name || 'Событие',
                eventDate: event.dateFrom || '',
                place: String(a.place),
                coupons: String(coupons),
                link: `${baseUrl}/#event/${event.id}`
              }, { userId: user.id, replyMarkup: rsvpMarkup }).catch(() => {});
            }
          }
        }
      }
    } catch (err) {
      console.warn('[EventOperations] Error notifying assigned players:', err.message);
    }
  }

  return {
    rsvpEvent,
    submitEventResult,
    registerForEvent,
    unregisterFromEvent,
    notifyAssignedPlayers
  };
}

module.exports = {
  createEventOperations
};
