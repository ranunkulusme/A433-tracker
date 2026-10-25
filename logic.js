(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else Object.assign(root, factory());
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const COUPON_PER_PUZZLE = 500;
  const PUZZLES_PER_LEVEL = 5;
  const MAX_LEVEL = 180;
  const STOCK_ZERO = { coupons: 0, puzzles: 0, chests: 0 };
  const STAR_COSTS = [500, 1000, 6500, 25000, 65000, 98000];
  const OFFICER_TYPES = ['Танк', 'ПТ', 'Пехота', 'Гарнизон', 'Осада'];

  const DEFAULT_OFFICERS = [
    { id: 'admiral-nathon', name: 'Адмирал Нейтон', type: 'Пехота', generation: 8, couponPerPuzzle: 500, medalsBeforeTraining: 690, medalsTraining: 900, medalsTotal: 1590 },
    { id: 'general-rex', name: 'Генерал Рекс', type: 'Танк', generation: 7, couponPerPuzzle: 500, medalsBeforeTraining: 690, medalsTraining: 900, medalsTotal: 1590 },
    { id: 'captain-black', name: 'Капитан Блэк', type: 'ПТ', generation: 7, couponPerPuzzle: 500, medalsBeforeTraining: 690, medalsTraining: 900, medalsTotal: 1590 },
  ];

  function slug(value) {
    return String(value || '')
      .toLowerCase()
      .trim()
      .replace(/[^a-zа-я0-9]+/gi, '-')
      .replace(/^-|-$/g, '') || `officer-${Date.now()}`;
  }

  function uniqueCatalog(baseCatalog, players) {
    const catalog = [...(Array.isArray(baseCatalog) && baseCatalog.length ? baseCatalog : DEFAULT_OFFICERS)];
    const byName = new Map(catalog.map(o => [o.name.toLowerCase(), o]));

    players.forEach(player => {
      (player.officers || []).forEach(officer => {
        if (!officer.name) return;
        const key = officer.name.toLowerCase();
        if (!byName.has(key)) {
          const item = { ...DEFAULT_OFFICERS[0], id: slug(officer.name), name: officer.name, generation: 7 };
          catalog.push(item);
          byName.set(key, item);
        }
      });
    });

    return catalog;
  }

  function normalizeSector(sector) {
    return {
      vipLevel: Number(sector?.vipLevel) || 0,
      confidentialityLevel: Number(sector?.confidentialityLevel) || 0,
      power: Number(sector?.power) || 0,
      kills: Number(sector?.kills) || 0,
      killPoints: Math.round((Number(sector?.killPoints) || 0) * 10) / 10,
    };
  }

  function normalizeStock(stock) {
    return {
      coupons: Math.max(0, Number(stock?.coupons) || 0),
      puzzles: Math.max(0, Number(stock?.puzzles) || 0),
      chests: Math.max(0, Number(stock?.chests) || 0),
    };
  }

  function migrateState(raw) {
    const input = raw && typeof raw === 'object' ? raw : {};
    const oldPlayers = Array.isArray(input.players) ? input.players : [];
    const officerCatalog = uniqueCatalog(input.officerCatalog, oldPlayers);
    const byName = new Map(officerCatalog.map(o => [o.name.toLowerCase(), o]));

    const players = oldPlayers.map(player => ({
      id: player.id,
      name: player.name || '',
      realName: player.realName || '',
      rank: ['r3', 'r4', 'r5'].includes(player.rank) ? player.rank : 'r3',
      sector: normalizeSector(player.sector),
      stock: normalizeStock(player.stock),
      officers: (player.officers || []).map(officer => {
        const catalog = officer.catalogId
          ? officerCatalog.find(item => item.id === officer.catalogId)
          : byName.get(String(officer.name || '').toLowerCase());
        return {
          id: officer.id || `po-${Date.now()}`,
          catalogId: catalog?.id || officerCatalog[0].id,
          name: officer.name || catalog?.name || '',
          level: Math.max(0, Math.min(MAX_LEVEL - 1, Number(officer.level) || 0)),
          coupons: Math.max(0, Number(officer.coupons) || 0),
          stars: Math.max(0, Math.min(6, Number(officer.stars) || 0)),
        };
      }),
    }));

    return {
      version: 3,
      players,
      officerCatalog,
      eventTypes: Array.isArray(input.eventTypes) ? input.eventTypes : [],
      events: Array.isArray(input.events) ? input.events : [],
      stockHistory: Array.isArray(input.stockHistory) ? input.stockHistory : [],
      currentRole: ['r3', 'r4', 'r5'].includes(input.currentRole) ? input.currentRole : 'r5',
      currentPlayerId: input.currentPlayerId ?? players[0]?.id ?? null,
      nextId: Math.max(Number(input.nextId) || 1, 1),
    };
  }

  function dailyRewards(sector) {
    const vip = Number(sector?.vipLevel) || 0;
    const confidentiality = Number(sector?.confidentialityLevel) || 0;
    const vipPuzzles = vip > 10 ? Math.min(20, Math.max(2, vip - 9)) : 0;
    const confidentialityPuzzles = confidentiality >= 25 ? 2 / 3 : confidentiality > 24 ? 1 / 2 : 0;
    return { puzzlesPerDay: vipPuzzles + confidentialityPuzzles, chestsPerDay: 1 };
  }

  function totalPuzzlesForOfficer(officer, catalogItem) {
    const rawCost = Number(catalogItem?.couponPerPuzzle);
    if (rawCost === 0) return officer.level * PUZZLES_PER_LEVEL;
    const couponPerPuzzle = rawCost || COUPON_PER_PUZZLE;
    return officer.level * PUZZLES_PER_LEVEL + Math.floor((Number(officer.coupons) || 0) / couponPerPuzzle);
  }

  function dateAdd(iso, days) {
    const date = new Date(`${iso}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
  }

  function starCostFor(stars) {
    return STAR_COSTS[Math.max(1, Math.min(6, Number(stars) || 1)) - 1];
  }

  function forecastOfficer({ today, officer, player, officerCatalog, maxDays = 3650 }) {
    const catalogItem = (officerCatalog || DEFAULT_OFFICERS).find(item => item.id === officer.catalogId) || DEFAULT_OFFICERS[0];
    const targetPuzzles = MAX_LEVEL * PUZZLES_PER_LEVEL;
    const daily = dailyRewards(player?.sector).puzzlesPerDay;
    let available = totalPuzzlesForOfficer(officer, catalogItem) + (Number(player?.stock?.puzzles) || 0);

    for (let days = 0; days <= maxDays; days += 1) {
      if (available >= targetPuzzles) return { date: dateAdd(today, days), days };
      available += daily;
    }

    return { date: null, days: null };
  }

  function forecastOfficerVariants({ today, officer, player, officerCatalog, eventType, maxDays = 3650 }) {
    const places = eventType?.places || [];
    const byPlace = new Map(places.map(p => [p.place, p]));
    const variants = {
      top1: byPlace.get(1),
      top2: byPlace.get(2),
      top3: byPlace.get(3),
      top4to10: byPlace.get(4),
    };

    return Object.fromEntries(Object.entries(variants).map(([key, place]) => {
      const playerWithPrize = {
        ...player,
        stock: {
          ...player.stock,
          puzzles: (Number(player.stock?.puzzles) || 0) + Math.floor((Number(place?.coupons) || 0) / COUPON_PER_PUZZLE),
        },
      };
      return [key, forecastOfficer({ today, officer, player: playerWithPrize, officerCatalog, maxDays })];
    }));
  }

  function resolveEventPlaces(eventType, eventDate) {
    const history = Array.isArray(eventType?.prizeHistory) ? eventType.prizeHistory : [];
    const matched = history
      .filter(item => item.date <= eventDate)
      .sort((a, b) => a.date.localeCompare(b.date))
      .at(-1);
    return (matched?.places || eventType?.places || []).map(place => ({ ...place }));
  }

  function officerUsage(catalogId, players) {
    return (players || []).filter(player => (player.officers || []).some(officer => officer.catalogId === catalogId));
  }

  function canDeleteOfficer(catalogId, players) {
    const blockers = officerUsage(catalogId, players);
    return { ok: blockers.length === 0, blockers };
  }

  function canR3SubmitResult({ event, place, nowIso, players=null }) {
    const deadline = new Date(`${event.dateTo}T00:00:00Z`);
    deadline.setUTCDate(deadline.getUTCDate() + 1);
    const assignment = (event.assignments || []).find(item => item.place === place);
    const assignedPlayerExists = assignment?.playerId && (!players || players.some(player => player.id === assignment.playerId));
    return new Date(nowIso) >= deadline && !assignedPlayerExists;
  }

  function validateImportData(data) {
    const ok = !!data
      && typeof data === 'object'
      && Array.isArray(data.players)
      && Array.isArray(data.eventTypes)
      && Array.isArray(data.events)
      && data.players.every(player => !player.officers || Array.isArray(player.officers))
      && data.eventTypes.every(type => !type.places || Array.isArray(type.places))
      && data.events.every(event => !event.assignments || Array.isArray(event.assignments));
    return { ok, error: ok ? '' : 'Неверный формат данных' };
  }

  function buildAutoPick({ places, players, officerCatalog }) {
    const byId = new Map((officerCatalog || DEFAULT_OFFICERS).map(o => [o.id, o]));
    const candidates = [];

    (players || []).forEach(player => {
      (player.officers || []).forEach(officer => {
        const catalog = byId.get(officer.catalogId) || {};
        candidates.push({
          playerId: player.id,
          officerId: officer.id,
          generation: Number(catalog.generation) || 0,
          level: Number(officer.level) || 0,
          killPoints: Number(player.sector?.killPoints) || 0,
          stockScore: (Number(player.stock?.puzzles) || 0) + Math.floor((Number(player.stock?.coupons) || 0) / COUPON_PER_PUZZLE),
        });
      });
    });

    candidates.sort((a, b) =>
      b.generation - a.generation
      || b.level - a.level
      || b.killPoints - a.killPoints
      || b.stockScore - a.stockScore
    );

    return (places || []).map((place, index) => ({
      place: place.place,
      playerId: candidates[index]?.playerId || null,
      officerId: candidates[index]?.officerId || null,
    }));
  }

  function calculateOfficerDeficit({ officer, catalogItem, player, targetLevel = 180, today, includeStock = true }) {
    const rawCost = Number(catalogItem?.couponPerPuzzle);
    const costPerPuzzle = rawCost === 0 ? 0 : (rawCost || COUPON_PER_PUZZLE);
    const target = Math.max(1, Math.min(MAX_LEVEL, Number(targetLevel) || MAX_LEVEL));
    const targetPuzzles = target * PUZZLES_PER_LEVEL;

    const officerCoupons = Math.max(0, Number(officer?.coupons) || 0);
    const officerLevel = Math.max(0, Number(officer?.level) || 0);
    const currentPuzzles = officerLevel * PUZZLES_PER_LEVEL + (costPerPuzzle > 0 ? Math.floor(officerCoupons / costPerPuzzle) : 0);

    let stockPuzzles = 0;
    if (includeStock) {
      const stockPuzzlesVal = Math.max(0, Number(player?.stock?.puzzles) || 0);
      const stockCouponsVal = Math.max(0, Number(player?.stock?.coupons) || 0);
      stockPuzzles = stockPuzzlesVal + (costPerPuzzle > 0 ? Math.floor(stockCouponsVal / costPerPuzzle) : 0);
    }

    const deficitPuzzles = Math.max(0, targetPuzzles - currentPuzzles - stockPuzzles);
    const deficitCoupons = costPerPuzzle > 0 ? deficitPuzzles * costPerPuzzle : 0;

    const daily = dailyRewards(player?.sector);
    const dailyIncome = daily.puzzlesPerDay;

    const daysWithoutEvents = deficitPuzzles === 0
      ? 0
      : (dailyIncome > 0 ? Math.ceil(deficitPuzzles / dailyIncome) : null);

    const baseToday = today || new Date().toISOString().slice(0, 10);
    const dateWithoutEvents = daysWithoutEvents !== null ? dateAdd(baseToday, daysWithoutEvents) : null;

    const currentStars = Math.max(0, Math.min(6, Number(officer?.stars) || 0));
    const requiredStars = 6;
    const isStarReady = currentStars >= requiredStars;

    return {
      targetLevel: target,
      targetPuzzles,
      currentPuzzles,
      stockPuzzles,
      deficitPuzzles,
      deficitCoupons,
      costPerPuzzle,
      dailyIncome,
      daysWithoutEvents,
      dateWithoutEvents,
      starRequirement: {
        currentStars,
        requiredStars,
        isStarReady,
      },
    };
  }

  function simulateEventProgress({ deficitPuzzles, costPerPuzzle, dailyIncome, plannedEvents = [], today }) {
    const rawCost = Number(costPerPuzzle);
    const effectiveCost = rawCost === 0 ? 0 : (rawCost || COUPON_PER_PUZZLE);

    let puzzlesFromEvents = 0;
    (plannedEvents || []).forEach(pe => {
      const count = Math.max(0, Number(pe.count) || 0);
      const coupons = Math.max(0, Number(pe.coupons) || 0);
      if (count > 0 && coupons > 0 && effectiveCost > 0) {
        puzzlesFromEvents += Math.floor((coupons * count) / effectiveCost);
      }
    });

    const initialDeficit = Math.max(0, Number(deficitPuzzles) || 0);
    const remainingDeficitPuzzles = Math.max(0, initialDeficit - puzzlesFromEvents);
    const remainingDeficitCoupons = effectiveCost > 0 ? remainingDeficitPuzzles * effectiveCost : 0;

    const baseToday = today || new Date().toISOString().slice(0, 10);
    const baseDays = initialDeficit === 0 ? 0 : (dailyIncome > 0 ? Math.ceil(initialDeficit / dailyIncome) : null);
    const simulatedDays = remainingDeficitPuzzles === 0 ? 0 : (dailyIncome > 0 ? Math.ceil(remainingDeficitPuzzles / dailyIncome) : null);
    const savedDays = (baseDays !== null && simulatedDays !== null) ? Math.max(0, baseDays - simulatedDays) : 0;
    const simulatedDate = simulatedDays !== null ? dateAdd(baseToday, simulatedDays) : null;

    return {
      puzzlesFromEvents,
      remainingDeficitPuzzles,
      remainingDeficitCoupons,
      simulatedDays,
      simulatedDate,
      savedDays,
    };
  }

  function smartAutoPick({ places, players, officerCatalog, eventDate }) {
    const catalogMap = new Map((officerCatalog || DEFAULT_OFFICERS).map(o => [o.id, o]));
    const today = eventDate || new Date().toISOString().slice(0, 10);

    const candidates = [];
    (players || []).forEach(player => {
      (player.officers || []).forEach(officer => {
        const cat = catalogMap.get(officer.catalogId);
        if (!cat) return;
        const costPerPuzzle = Number(cat.couponPerPuzzle);
        if (costPerPuzzle === 0) return;

        const def = calculateOfficerDeficit({ officer, catalogItem: cat, player, targetLevel: MAX_LEVEL, today });
        if (def.deficitCoupons <= 0) return;

        candidates.push({
          playerId: player.id,
          officerId: officer.id,
          generation: Number(cat.generation) || 0,
          level: Number(officer.level) || 0,
          killPoints: Number(player.sector?.killPoints) || 0,
          deficitCoupons: def.deficitCoupons,
          deficitPuzzles: def.deficitPuzzles,
          costPerPuzzle: def.costPerPuzzle,
        });
      });
    });

    candidates.sort((a, b) =>
      b.generation - a.generation
      || b.level - a.level
      || b.killPoints - a.killPoints
      || b.deficitCoupons - a.deficitCoupons
    );

    const indexedPlaces = (places || []).map((p, idx) => ({
      slotIndex: idx,
      place: p.place,
      label: p.label || `Место ${p.place}`,
      coupons: Math.max(0, Number(p.coupons ?? p.actualCoupons) || 0),
    }));

    const sortedPlaces = [...indexedPlaces].sort((a, b) => b.coupons - a.coupons || a.slotIndex - b.slotIndex);

    const assignedPlayers = new Set();
    const assignmentMap = new Map();

    sortedPlaces.forEach(p => {
      const available = candidates.filter(c => !assignedPlayers.has(c.playerId));
      if (!available.length) return;

      const fullDeficitCandidates = available.filter(c => c.deficitCoupons >= p.coupons);
      let chosen = null;
      if (fullDeficitCandidates.length > 0) {
        chosen = fullDeficitCandidates[0];
      } else {
        chosen = [...available].sort((a, b) => b.deficitCoupons - a.deficitCoupons)[0];
      }

      if (chosen) {
        assignedPlayers.add(chosen.playerId);
        const overflow = Math.max(0, p.coupons - chosen.deficitCoupons);
        assignmentMap.set(p.slotIndex, {
          place: p.place,
          playerId: chosen.playerId,
          officerId: chosen.officerId,
          actualCoupons: p.coupons,
          deficitCoupons: chosen.deficitCoupons,
          overflowCoupons: overflow,
          isEfficient: overflow === 0,
        });
      }
    });

    return (places || []).map((p, idx) => {
      const assigned = assignmentMap.get(idx);
      if (assigned) return assigned;
      return {
        place: p.place,
        playerId: null,
        officerId: null,
        actualCoupons: Number(p.coupons ?? p.actualCoupons) || 0,
        deficitCoupons: 0,
        overflowCoupons: 0,
        isEfficient: true,
      };
    });
  }

  function smartAutoPickWithRegistrations({ event, candidates, registrations, players, officerCatalog, eventDate } = {}) {
    const rawPlaces = event?.places || [];
    const indexedPlaces = rawPlaces.map((p, idx) => ({
      slotIndex: idx,
      place: Number(p.place) || idx + 1,
      label: p.label || `Место ${p.place || idx + 1}`,
      coupons: Math.max(0, Number(p.coupons ?? p.actualCoupons) || 0),
    }));

    function getCandidateDeficit(c) {
      return Math.max(0, Number(c.deficitCoupons ?? c.deficit) || 0);
    }

    function getCandidateKillPoints(c) {
      return Number(c.killPoints) || 0;
    }

    let candidateList = [];
    if (Array.isArray(candidates)) {
      candidateList = candidates.map(c => ({ ...c }));
    } else if (Array.isArray(players)) {
      const catalogMap = new Map((officerCatalog || DEFAULT_OFFICERS).map(o => [o.id, o]));
      const today = eventDate || new Date().toISOString().slice(0, 10);
      players.forEach(player => {
        (player.officers || []).forEach(officer => {
          const cat = catalogMap.get(officer.catalogId);
          if (!cat) return;
          const costPerPuzzle = Number(cat.couponPerPuzzle);
          if (costPerPuzzle === 0) return;

          const def = calculateOfficerDeficit({ officer, catalogItem: cat, player, targetLevel: MAX_LEVEL, today });
          if (def.deficitCoupons <= 0) return;

          candidateList.push({
            playerId: player.id,
            playerName: player.name || player.realName || '',
            officerId: officer.id,
            generation: Number(cat.generation) || 0,
            level: Number(officer.level) || 0,
            killPoints: Number(player.sector?.killPoints) || 0,
            deficitCoupons: def.deficitCoupons,
            deficitPuzzles: def.deficitPuzzles,
            costPerPuzzle: def.costPerPuzzle,
          });
        });
      });
    }

    const regList = Array.isArray(registrations) ? registrations : [];
    const regMap = new Map();
    regList.forEach(r => {
      if (r && r.playerId !== undefined && r.playerId !== null) {
        regMap.set(String(r.playerId), r);
      }
    });

    const sortedPlaces = [...indexedPlaces].sort((a, b) =>
      a.place - b.place
      || b.coupons - a.coupons
      || a.slotIndex - b.slotIndex
    );

    const assignedPlayers = new Set();
    const assignmentMap = new Map();

    function compareCandidates(a, b) {
      const defA = getCandidateDeficit(a);
      const defB = getCandidateDeficit(b);
      if (defB !== defA) return defB - defA;
      const kpA = getCandidateKillPoints(a);
      const kpB = getCandidateKillPoints(b);
      if (kpB !== kpA) return kpB - kpA;
      const genA = Number(a.generation) || 0;
      const genB = Number(b.generation) || 0;
      if (genB !== genA) return genB - genA;
      const lvlA = Number(a.level) || 0;
      const lvlB = Number(b.level) || 0;
      if (lvlB !== lvlA) return lvlB - lvlA;
      return 0;
    }

    sortedPlaces.forEach(slot => {
      const available = candidateList.filter(c => !assignedPlayers.has(String(c.playerId)));

      // Enforce coupon overflow protection across all groups: deficit must be >= slot coupons
      const eligible = available.filter(c => getCandidateDeficit(c) >= slot.coupons);

      // Group 1: Registered for this exact place
      const group1 = eligible.filter(c => {
        const reg = regMap.get(String(c.playerId));
        if (!reg) return false;
        if (reg.officerId && c.officerId && String(reg.officerId) !== String(c.officerId)) return false;
        const desired = reg.desiredPlace !== undefined && reg.desiredPlace !== null ? Number(reg.desiredPlace) : 0;
        return desired === slot.place;
      }).sort(compareCandidates);

      // Group 2: Registered for 'Any suitable' (desiredPlace === 0)
      const group2 = eligible.filter(c => {
        const reg = regMap.get(String(c.playerId));
        if (!reg) return false;
        if (reg.officerId && c.officerId && String(reg.officerId) !== String(c.officerId)) return false;
        const desired = reg.desiredPlace !== undefined && reg.desiredPlace !== null ? Number(reg.desiredPlace) : 0;
        return desired === 0;
      }).sort(compareCandidates);

      // Group 3: Registered for a higher place, didn't get it (fallback)
      const group3 = eligible.filter(c => {
        const reg = regMap.get(String(c.playerId));
        if (!reg) return false;
        if (reg.officerId && c.officerId && String(reg.officerId) !== String(c.officerId)) return false;
        const desired = reg.desiredPlace !== undefined && reg.desiredPlace !== null ? Number(reg.desiredPlace) : 0;
        return desired > 0 && desired < slot.place;
      }).sort(compareCandidates);

      // Group 4: Candidates without registrations with sufficient deficit
      const group4 = eligible.filter(c => {
        return !regMap.has(String(c.playerId));
      }).sort(compareCandidates);

      const chosen = group1[0] || group2[0] || group3[0] || group4[0] || null;

      if (chosen) {
        assignedPlayers.add(String(chosen.playerId));
        const reg = regMap.get(String(chosen.playerId));
        const deficit = getCandidateDeficit(chosen);
        assignmentMap.set(slot.slotIndex, {
          slotIndex: slot.slotIndex,
          place: slot.place,
          label: slot.label,
          playerId: chosen.playerId,
          playerName: chosen.playerName || '',
          officerId: chosen.officerId || (reg && reg.officerId) || null,
          coupons: slot.coupons,
          actualCoupons: slot.coupons,
          deficit: deficit,
          deficitCoupons: deficit,
          overflowCoupons: 0,
          isEfficient: true,
        });
      } else {
        assignmentMap.set(slot.slotIndex, {
          slotIndex: slot.slotIndex,
          place: slot.place,
          label: slot.label,
          playerId: null,
          playerName: '',
          officerId: null,
          coupons: slot.coupons,
          actualCoupons: slot.coupons,
          deficit: 0,
          deficitCoupons: 0,
          overflowCoupons: 0,
          isEfficient: true,
        });
      }
    });

    const assignments = indexedPlaces.map(p => assignmentMap.get(p.slotIndex));
    const unassignedCandidates = candidateList.filter(c => !assignedPlayers.has(String(c.playerId)));

    return {
      assignments,
      unassignedCandidates,
    };
  }

  return {
    COUPON_PER_PUZZLE,
    PUZZLES_PER_LEVEL,
    MAX_LEVEL,
    STOCK_ZERO,
    STAR_COSTS,
    DEFAULT_OFFICERS,
    OFFICER_TYPES,
    migrateState,
    dailyRewards,
    forecastOfficer,
    forecastOfficerVariants,
    resolveEventPlaces,
    officerUsage,
    canDeleteOfficer,
    canR3SubmitResult,
    starCostFor,
    validateImportData,
    buildAutoPick,
    calculateOfficerDeficit,
    simulateEventProgress,
    smartAutoPick,
    smartAutoPickWithRegistrations,
  };
});
