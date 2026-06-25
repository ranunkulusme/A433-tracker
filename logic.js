(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else Object.assign(root, factory());
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const COUPON_PER_PUZZLE = 500;
  const PUZZLES_PER_LEVEL = 5;
  const MAX_LEVEL = 180;
  const STOCK_ZERO = { coupons: 0, puzzles: 0, chests: 0 };
  const STAR_COSTS = [500, 1000, 6500, 25000, 65000, 98000];

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

  return {
    COUPON_PER_PUZZLE,
    PUZZLES_PER_LEVEL,
    MAX_LEVEL,
    STOCK_ZERO,
    STAR_COSTS,
    DEFAULT_OFFICERS,
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
  };
});
