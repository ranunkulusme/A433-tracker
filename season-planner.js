/**
 * KoW Tracker - Deep Module: Season Planner & Autopick Orchestrator
 *
 * Encapsulates multi-week season generation (8+ weeks with alternating cadence),
 * event deduplication, ensureEventType creation with presets, and fair-play smart
 * autopick slot distribution.
 * Zero external dependencies.
 */

function createSeasonPlanner({ db, logic, notificationEngine, getAppBaseUrl } = {}) {
  if (!db) throw new Error('db is required for SeasonPlanner');
  if (!logic) {
    logic = require('./logic.js');
  }

  function ensureEventType(identifier, defaultColor) {
    const search = String(identifier || '').trim().toLowerCase();
    const cachedEventTypes = db.getEventTypes ? db.getEventTypes() : [];
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
          { place: 4, label: '4–10 место', coupons: 2750 }
        ]
      });
    }
    return found;
  }

  function scheduleSeason(body = {}, options = {}) {
    const createdEvents = [];

    if (Array.isArray(body?.events)) {
      // 1. Ready-made events array from UI preview
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
      // 2. Multi-rule season generation
      const normalizedRules = Array.isArray(body.rules) ? body.rules.map(r => ({
        ...r,
        name: r.name || r.typeName,
        startDayOfWeek: r.startDayOfWeek || r.dayOfWeek
      })) : undefined;

      const scheduleItems = logic.generateSeasonSchedule({
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

    return {
      success: true,
      count: createdEvents.length,
      createdCount: createdEvents.length,
      events: createdEvents
    };
  }

  function runSmartAutopick(eventId, options = {}) {
    const ev = db.getEventById(Number(eventId));
    if (!ev) {
      return { success: false, error: 'EVENT_NOT_FOUND', message: 'Ивент не найден' };
    }

    const eventTypes = db.getEventTypes ? db.getEventTypes() : [];
    const et = eventTypes.find(t => t.id === ev.typeId);
    const places = et
      ? (typeof logic.resolveEventPlaces === 'function' ? logic.resolveEventPlaces(et, ev.dateFrom) : et.places)
      : [];

    const players = db.getPlayers ? db.getPlayers() : [];
    const officerCatalog = db.getCatalog ? db.getCatalog() : [];
    const registrations = db.getRegistrationsByEventId ? db.getRegistrationsByEventId(eventId) : [];
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

    return {
      success: true,
      event: ev,
      eventType: et,
      assignments: result.assignments || [],
      unassignedCandidates: result.unassignedCandidates || []
    };
  }

  function formatAutopickSummary(event, eventType, assignments, places) {
    const assignedList = (assignments || []).filter(a => a.playerId && a.place);
    const topFormatted = assignedList
      .slice(0, 10)
      .map((a, idx) => {
        const safeName = String(a.playerName || `Сектор #${a.playerId}`)
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;');
        const vipStr = a.vipPoints ? ` (VIP ${a.vipPoints})` : '';
        return `${idx + 1}. #${a.place}: ${safeName}${vipStr}`;
      })
      .join('\n');

    return {
      eventName: eventType?.name || 'Событие',
      assignedCount: String(assignedList.length),
      availablePlaces: String((places || []).length),
      topAssignmentsList: topFormatted || 'Назначений нет'
    };
  }

  return {
    ensureEventType,
    scheduleSeason,
    runSmartAutopick,
    formatAutopickSummary
  };
}

module.exports = {
  createSeasonPlanner
};
