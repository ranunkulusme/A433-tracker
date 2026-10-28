const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
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
  formatOfficerStarHint,
  validateImportData,
  buildAutoPick,
  OFFICER_TYPES,
  calculateOfficerDeficit,
  simulateEventProgress,
  smartAutoPick,
  smartAutoPickWithRegistrations,
  COMMUNITY_OFFICERS,
  VIP_TIERS_DATA,
  calculateVipDeficit,
  SKILL_UPGRADE_COSTS,
  SKILL_PROGRESSION_COSTS,
  calculateSkillMedalsProgress,
  calculateStarStockDelta,
  calculateSkillStockDelta,
  calculateLevelStockDelta,
  formatInputNumber,
  parseInputNumber,
  OFFICER_PAIRINGS,
  getRecommendedPairings,
  EVENT_PRESETS,
  generateSeasonSchedule,
  isOfflineMutationAllowed,
  findActiveSector,
  formatSectorTitle,
  createOutboxItem,
  addToOutboxQueue,
  filterOutboxQueue,
  STAR_ITEM_VALUES,
  calculateTotalStarPoints,
  cleanOcrNumber,
  parseProfileScreenshotText,
  parseWarehouseScreenshotText,
  mergeScanResults,
  normalizeStock,
} = require('./logic.js');

function test(name, fn) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    console.error(error);
    process.exitCode = 1;
  }
}

test('migrates old players into catalog-linked officers and stock fields', () => {
  const migrated = migrateState({
    players: [
      { id: 1, name: 'Командор', sector: { killPoints: 1234.56 }, officers: [{ id: 'o1', name: 'Адмирал Нейтон', level: 8, coupons: 750 }] },
    ],
    eventTypes: [],
    events: [],
    nextId: 7,
  });

  assert.equal(migrated.version, 3);
  assert.equal(migrated.officerCatalog.length >= DEFAULT_OFFICERS.length, true);
  assert.equal(migrated.players[0].realName, '');
  assert.equal(migrated.players[0].rank, 'r3');
  assert.deepEqual(migrated.players[0].stock, {
    coupons: 0,
    puzzles: 0,
    starCoupons: 0,
    legendaryStars1: 0,
    legendaryStars2: 0,
    legendaryStars3: 0,
    chests: 0,
  });
  assert.equal(migrated.players[0].sector.killPoints, 1234.6);
  assert.equal(migrated.players[0].officers[0].catalogId, migrated.officerCatalog[0].id);
  assert.equal(migrated.players[0].officers[0].stars, 0);
});

test('calculates daily rewards from vip and confidentiality levels', () => {
  assert.deepEqual(dailyRewards({ vipLevel: 10, confidentialityLevel: 24 }), { puzzlesPerDay: 0, chestsPerDay: 1 });
  assert.deepEqual(dailyRewards({ vipLevel: 11, confidentialityLevel: 24 }), { puzzlesPerDay: 2, chestsPerDay: 1 });
  assert.deepEqual(dailyRewards({ vipLevel: 12, confidentialityLevel: 25 }), { puzzlesPerDay: 3 + 2 / 3, chestsPerDay: 1 });
});

test('forecasts officer max date using stock and daily rewards', () => {
  const result = forecastOfficer({
    today: '2026-06-25',
    officer: { level: 179, coupons: 0, catalogId: 'admiral-nathon' },
    player: { stock: { coupons: 0, puzzles: 0, chests: 0 }, sector: { vipLevel: 11, confidentialityLevel: 24 } },
    officerCatalog: DEFAULT_OFFICERS,
    events: [],
    eventTypes: [],
    maxDays: 10,
  });

  assert.equal(result.date, '2026-06-28');
  assert.equal(result.days, 3);
});

test('treats zero coupon cost as puzzle-only officer', () => {
  const catalog = [{ ...DEFAULT_OFFICERS[0], id: 'puzzle-only', couponPerPuzzle: 0 }];
  const withoutPuzzles = forecastOfficer({
    today: '2026-06-25',
    officer: { level: 179, coupons: 999999, catalogId: 'puzzle-only' },
    player: { stock: { coupons: 0, puzzles: 0, chests: 0 }, sector: { vipLevel: 0, confidentialityLevel: 0 } },
    officerCatalog: catalog,
    events: [],
    eventTypes: [],
    maxDays: 1,
  });
  const withPuzzles = forecastOfficer({
    today: '2026-06-25',
    officer: { level: 179, coupons: 999999, catalogId: 'puzzle-only' },
    player: { stock: { coupons: 0, puzzles: 5, chests: 0 }, sector: { vipLevel: 0, confidentialityLevel: 0 } },
    officerCatalog: catalog,
    events: [],
    eventTypes: [],
    maxDays: 1,
  });

  assert.equal(withoutPuzzles.date, null);
  assert.equal(withPuzzles.date, '2026-06-25');
});

test('validates import payload shape', () => {
  assert.equal(validateImportData({ players: [], eventTypes: [], events: [], nextId: 1 }).ok, true);
  assert.equal(validateImportData({ players: 'bad', eventTypes: [], events: [] }).ok, false);
  assert.equal(validateImportData({ players: [{ officers: 'bad' }], eventTypes: [], events: [] }).ok, false);
});

test('auto pick orders candidates by generation level and kill points', () => {
  const picks = buildAutoPick({
    places: [{ place: 1 }, { place: 2 }],
    players: [
      {
        id: 1,
        name: 'A',
        sector: { killPoints: 100 },
        officers: [{ id: 'po1', catalogId: 'captain-black', level: 20 }],
      },
      {
        id: 2,
        name: 'B',
        sector: { killPoints: 1 },
        officers: [{ id: 'po2', catalogId: 'admiral-nathon', level: 10 }],
      },
    ],
    officerCatalog: DEFAULT_OFFICERS,
  });

  assert.deepEqual(picks.map(p => p.playerId), [2, 1]);
});

test('blocks deleting catalog officer while players use it', () => {
  const players = [
    { id: 1, name: 'Командор', officers: [{ catalogId: 'admiral-nathon' }] },
    { id: 2, name: 'Шторм', officers: [{ catalogId: 'general-rex' }] },
  ];

  assert.deepEqual(officerUsage('admiral-nathon', players).map(p => p.name), ['Командор']);
  assert.equal(canDeleteOfficer('admiral-nathon', players).ok, false);
  assert.equal(canDeleteOfficer('captain-black', players).ok, true);
});

test('resolves event prizes from history by event date', () => {
  const eventType = {
    places: [{ place: 1, coupons: 100 }],
    prizeHistory: [
      { date: '2026-01-01', places: [{ place: 1, coupons: 100 }] },
      { date: '2026-06-01', places: [{ place: 1, coupons: 200 }] },
    ],
  };

  assert.equal(resolveEventPlaces(eventType, '2026-05-31')[0].coupons, 100);
  assert.equal(resolveEventPlaces(eventType, '2026-06-25')[0].coupons, 200);
});

test('builds forecast variants from event places', () => {
  const variants = forecastOfficerVariants({
    today: '2026-06-25',
    officer: { level: 179, coupons: 0, catalogId: 'admiral-nathon' },
    player: { stock: { coupons: 0, puzzles: 0, chests: 0 }, sector: { vipLevel: 0, confidentialityLevel: 0 } },
    officerCatalog: DEFAULT_OFFICERS,
    eventType: { places: [
      { place: 1, coupons: 2500 },
      { place: 2, coupons: 2000 },
      { place: 3, coupons: 1500 },
      { place: 4, coupons: 1000 },
    ] },
    maxDays: 1,
  });

  assert.equal(variants.top1.date, '2026-06-25');
  assert.equal(variants.top2.date, null);
});

test('allows r3 result submission only after next UTC midnight when empty', () => {
  const event = { dateTo: '2026-06-25', assignments: [{ place: 1, playerId: null }] };

  assert.equal(canR3SubmitResult({ event, playerId: 7, place: 1, nowIso: '2026-06-25T23:59:00Z' }), false);
  assert.equal(canR3SubmitResult({ event, playerId: 7, place: 1, nowIso: '2026-06-26T00:00:00Z' }), true);
  event.assignments[0].playerId = 9;
  assert.equal(canR3SubmitResult({ event, playerId: 7, place: 1, nowIso: '2026-06-26T00:00:00Z' }), false);
  assert.equal(canR3SubmitResult({ event, place: 1, nowIso: '2026-06-26T00:00:00Z', players: [{ id: 7 }] }), true);
});

test('returns officer star tooltip costs including total sixth marker', () => {
  assert.equal(starCostFor(1), 500);
  assert.equal(starCostFor(2), 1000);
  assert.equal(starCostFor(3), 6500);
  assert.equal(starCostFor(4), 25000);
  assert.equal(starCostFor(5), 65000);
  assert.equal(starCostFor(6), 98000);
});

test('formatOfficerStarHint formats correct hint for star levels 0 to 6', () => {
  assert.equal(formatOfficerStarHint(0), 'До 1★: 500 звёзд');
  assert.equal(formatOfficerStarHint(1), 'До 2★: 1 000 звёзд');
  assert.equal(formatOfficerStarHint(2), 'До 3★: 6 500 звёзд');
  assert.equal(formatOfficerStarHint(3), 'До 4★: 25 000 звёзд');
  assert.equal(formatOfficerStarHint(4), 'До 5★: 65 000 звёзд');
  assert.equal(formatOfficerStarHint(5), 'До 6★: 98 000 звёзд');
  assert.equal(formatOfficerStarHint(6), '6★ Максимум (98 000 звёзд)');
});

test('exports full list of 5 officer types', () => {
  assert.deepEqual(OFFICER_TYPES, ['Танк', 'Пехота', 'ПТ-Сау', 'Горнизон', 'Осада']);
});

test('calculates officer deficit and star requirement for standard and puzzle-only officers', () => {
  const defStandard = calculateOfficerDeficit({
    officer: { level: 100, coupons: 1000, stars: 4 },
    catalogItem: { couponPerPuzzle: 500 },
    player: { stock: { puzzles: 50, coupons: 2500 }, sector: { vipLevel: 12, confidentialityLevel: 25 } },
    targetLevel: 180,
    today: '2026-10-24'
  });
  assert.equal(defStandard.targetPuzzles, 900);
  assert.equal(defStandard.currentPuzzles, 502);
  assert.equal(defStandard.stockPuzzles, 55);
  assert.equal(defStandard.deficitPuzzles, 343);
  assert.equal(defStandard.deficitCoupons, 171500);
  assert.equal(defStandard.starRequirement.requiredStars, 6);
  assert.equal(defStandard.starRequirement.isStarReady, false);
  assert.ok(defStandard.daysWithoutEvents > 0);
  assert.ok(typeof defStandard.dateWithoutEvents === 'string');

  const defPuzzleOnly = calculateOfficerDeficit({
    officer: { level: 170, coupons: 0, stars: 6 },
    catalogItem: { couponPerPuzzle: 0 },
    player: { stock: { puzzles: 10, coupons: 100000 }, sector: { vipLevel: 10 } },
    targetLevel: 180,
    today: '2026-10-24'
  });
  assert.equal(defPuzzleOnly.deficitPuzzles, 40);
  assert.equal(defPuzzleOnly.deficitCoupons, 0);
  assert.equal(defPuzzleOnly.starRequirement.isStarReady, true);
});

test('simulates event progress, remaining deficit and saved days', () => {
  const sim = simulateEventProgress({
    deficitPuzzles: 343,
    costPerPuzzle: 500,
    dailyIncome: 3.666667,
    plannedEvents: [
      { coupons: 12500, count: 2 },
      { coupons: 6500, count: 1 }
    ],
    today: '2026-10-24'
  });
  assert.equal(sim.puzzlesFromEvents, 63);
  assert.equal(sim.remainingDeficitPuzzles, 280);
  assert.equal(sim.remainingDeficitCoupons, 140000);
  assert.ok(sim.savedDays > 0);
  assert.ok(typeof sim.simulatedDate === 'string');
});

test('smartAutoPick distributes places avoiding overflow and enforcing unique players', () => {
  const catalog = [
    { id: 'cat-std', name: 'Нейтон', generation: 8, couponPerPuzzle: 500 },
    { id: 'cat-puzzle-only', name: 'Спец', generation: 9, couponPerPuzzle: 0 },
  ];
  const places = [
    { place: 1, label: '1 место', coupons: 12500 },
    { place: 2, label: '2 место', coupons: 6500 },
    { place: 4, label: '4-10 место', coupons: 2750 },
  ];
  const players = [
    // Игрок 1: высокий KP, но дефицит всего 2 000 купонов (ур 179)
    { id: 1, name: 'Топ 1', sector: { killPoints: 100 }, stock: { coupons: 0, puzzles: 0 }, officers: [
      { id: 'o1', catalogId: 'cat-std', level: 179, coupons: 3000 }, // 180*5=900, 179*5+6=901 -> дефицит 0!
      { id: 'o1_b', catalogId: 'cat-std', level: 178, coupons: 0 }  // дефицит 10 пазлов = 5 000 купонов
    ] },
    // Игрок 2: чуть ниже уровень чем у Топ 1, но огромный дефицит (ур 150) -> 75 000 купонов
    { id: 2, name: 'Топ 2', sector: { killPoints: 80 }, stock: { coupons: 0, puzzles: 0 }, officers: [
      { id: 'o2', catalogId: 'cat-std', level: 150, coupons: 0 }
    ] },
    // Игрок 3: офицер только за пазлы (couponPerPuzzle = 0)
    { id: 3, name: 'Пазловый', sector: { killPoints: 90 }, stock: { coupons: 0, puzzles: 0 }, officers: [
      { id: 'o3', catalogId: 'cat-puzzle-only', level: 100, coupons: 0 }
    ] },
    // Игрок 4: обычный кандидат
    { id: 4, name: 'Топ 4', sector: { killPoints: 60 }, stock: { coupons: 0, puzzles: 0 }, officers: [
      { id: 'o4', catalogId: 'cat-std', level: 120, coupons: 0 }
    ] },
  ];

  const pick = smartAutoPick({
    places,
    players,
    officerCatalog: catalog,
    eventDate: '2026-10-24'
  });

  // 1 место достается игроку 2 (может впитать 12500 купонов без перерасхода)
  assert.equal(pick.find(p => p.place === 1).playerId, 2);
  // Игрок 3 (puzzle-only) не должен получить назначение
  assert.equal(pick.some(p => p.playerId === 3), false);
  // Игрок 1 получает более низкое место (где дефицит 5000 купонов лучше вписывается в призовой фонд)
  assert.ok(pick.some(p => p.playerId === 1 && p.place > 1));
  // Уникальность: ни один игрок не занимает 2 места
  const playerIds = pick.map(p => p.playerId).filter(Boolean);
  assert.equal(playerIds.length, new Set(playerIds).size);
});

test('smartAutoPick prioritizes full-deficit candidate over candidate with 70-99% deficit', () => {
  const catalog = [{ id: 'cat-std', name: 'Нейтон', generation: 8, couponPerPuzzle: 500 }];
  const places = [{ place: 1, label: '1 место', coupons: 12500 }];
  const players = [
    // Игрок 1: выше по силе (ур 176, дефицит 20 пазлов = 10 000 купонов, что составляет 80% от 12 500)
    { id: 1, name: 'Игрок 1', sector: { killPoints: 100 }, stock: { coupons: 0, puzzles: 0 }, officers: [
      { id: 'o1', catalogId: 'cat-std', level: 176, coupons: 0 }
    ] },
    // Игрок 2: чуть ниже по уровню (ур 150), но имеет полный дефицит (150 пазлов = 75 000 купонов >= 12 500)
    { id: 2, name: 'Игрок 2', sector: { killPoints: 50 }, stock: { coupons: 0, puzzles: 0 }, officers: [
      { id: 'o2', catalogId: 'cat-std', level: 150, coupons: 0 }
    ] },
  ];

  const pick = smartAutoPick({ places, players, officerCatalog: catalog, eventDate: '2026-10-24' });
  // Должен быть выбран Игрок 2, так как у него полный дефицит, а у Игрока 1 купоны сгорят!
  assert.equal(pick[0].playerId, 2);
  assert.equal(pick[0].overflowCoupons, 0);
  assert.equal(pick[0].isEfficient, true);
});

test('smartAutoPick handles duplicate place numbers without duplicate players', () => {
  const catalog = [{ id: 'cat-std', name: 'Нейтон', generation: 8, couponPerPuzzle: 500 }];
  const places = [
    { place: 4, label: '4 место (слот 1)', coupons: 2750 },
    { place: 4, label: '4 место (слот 2)', coupons: 2750 },
  ];
  const players = [
    { id: 1, name: 'Игрок 1', sector: { killPoints: 50 }, stock: { coupons: 0, puzzles: 0 }, officers: [{ id: 'o1', catalogId: 'cat-std', level: 100, coupons: 0 }] },
    { id: 2, name: 'Игрок 2', sector: { killPoints: 40 }, stock: { coupons: 0, puzzles: 0 }, officers: [{ id: 'o2', catalogId: 'cat-std', level: 100, coupons: 0 }] },
  ];

  const pick = smartAutoPick({ places, players, officerCatalog: catalog, eventDate: '2026-10-24' });
  assert.equal(pick.length, 2);
  assert.notEqual(pick[0].playerId, pick[1].playerId);
  assert.ok(pick.some(p => p.playerId === 1));
  assert.ok(pick.some(p => p.playerId === 2));
});

test('calculateOfficerDeficit respects includeStock = false for matrix view', () => {
  const def = calculateOfficerDeficit({
    officer: { level: 100, coupons: 0 },
    catalogItem: { couponPerPuzzle: 500 },
    player: { stock: { puzzles: 50, coupons: 25000 }, sector: { vipLevel: 10 } },
    targetLevel: 180,
    includeStock: false,
  });
  // 180 * 5 = 900. Офицер: 500. Склад НЕ должен учитываться!
  assert.equal(def.currentPuzzles, 500);
  assert.equal(def.stockPuzzles, 0);
  assert.equal(def.deficitPuzzles, 400);
  assert.equal(def.deficitCoupons, 200000);
});

test('smartAutoPickWithRegistrations assigns applicant to requested place and falls back on tie-break', () => {
  const event = {
    places: [
      { place: 1, label: '1 место', coupons: 12500 },
      { place: 2, label: '2 место', coupons: 6500 },
    ]
  };
  const candidates = [
    { playerId: 1, playerName: 'Игрок 1', officerId: 'o1', deficitCoupons: 15000, killPoints: 100 },
    { playerId: 2, playerName: 'Игрок 2', officerId: 'o2', deficitCoupons: 25000, killPoints: 50 },
    { playerId: 3, playerName: 'Игрок 3', officerId: 'o3', deficitCoupons: 20000, killPoints: 80 },
  ];
  // Игрок 1 и Игрок 2 оба хотят 1 место. У Игрока 2 дефицит 25 000 > 15 000, он должен занять 1 место.
  // Игрок 1 должен опуститься на 2 место (дефицит 15000 >= 6500).
  const registrations = [
    { playerId: 1, officerId: 'o1', desiredPlace: 1 },
    { playerId: 2, officerId: 'o2', desiredPlace: 1 },
  ];

  const result = smartAutoPickWithRegistrations({ event, candidates, registrations });
  assert.equal(result.assignments.length, 2);
  assert.equal(result.assignments[0].playerId, 2); // 1 место
  assert.equal(result.assignments[1].playerId, 1); // 2 место fallback
});

test('smartAutoPickWithRegistrations does not assign applicant if deficit is less than place coupons', () => {
  const event = {
    places: [
      { place: 1, label: '1 место', coupons: 12500 },
      { place: 2, label: '2 место', coupons: 6500 },
    ]
  };
  // Игрок 1 хочет 1 место, но его дефицит всего 5 000 (< 12 500)
  // Игрок 2 не подавал заявку, но его дефицит 20 000 (>= 12 500)
  const candidates = [
    { playerId: 1, playerName: 'Игрок 1', officerId: 'o1', deficitCoupons: 5000, killPoints: 100 },
    { playerId: 2, playerName: 'Игрок 2', officerId: 'o2', deficitCoupons: 20000, killPoints: 50 },
  ];
  const registrations = [
    { playerId: 1, officerId: 'o1', desiredPlace: 1 },
  ];

  const result = smartAutoPickWithRegistrations({ event, candidates, registrations });
  // Игрок 1 не должен получить 1 место из-за перерасхода купонов. Игрок 2 получает 1 место.
  assert.equal(result.assignments[0].playerId, 2);
  // На 2 место (6500) дефицит Игрока 1 (5000) тоже недостаточен, поэтому место 2 остается пустым!
  assert.equal(result.assignments[1].playerId, null);
  // Игрок 1 остается в unassignedCandidates
  assert.equal(result.unassignedCandidates.length, 1);
  assert.equal(result.unassignedCandidates[0].playerId, 1);
});

test('smartAutoPickWithRegistrations handles desiredPlace=0 (любое подходящее) and killPoints tie-break', () => {
  const event = {
    places: [
      { place: 1, label: '1 место', coupons: 10000 },
      { place: 2, label: '2 место', coupons: 5000 },
    ]
  };
  const candidates = [
    { playerId: 1, playerName: 'Игрок 1', officerId: 'o1', deficitCoupons: 20000, killPoints: 100 },
    { playerId: 2, playerName: 'Игрок 2', officerId: 'o2', deficitCoupons: 20000, killPoints: 200 }, // равный дефицит, больше КП
    { playerId: 3, playerName: 'Игрок 3', officerId: 'o3', deficitCoupons: 15000, killPoints: 50 },
  ];
  const registrations = [
    { playerId: 1, officerId: 'o1', desiredPlace: 1 },
    { playerId: 2, officerId: 'o2', desiredPlace: 1 }, // оба хотят 1 место с равным дефицитом
    { playerId: 3, officerId: 'o3', desiredPlace: 0 }, // любое подходящее
  ];

  const result = smartAutoPickWithRegistrations({ event, candidates, registrations });
  // Игрок 2 побеждает по killPoints (200 > 100) на 1 месте
  assert.equal(result.assignments[0].playerId, 2);
  // На 2 место: Игрок 3 (желает любое, группа 2) vs Игрок 1 (fallback с 1 места, группа 3)
  // Группа 2 имеет более высокий приоритет, чем fallback (Группа 3)
  assert.equal(result.assignments[1].playerId, 3);
  assert.equal(result.unassignedCandidates.length, 1);
  assert.equal(result.unassignedCandidates[0].playerId, 1);
});

test('community officers roster, vip deficit, skills and pairings', () => {
  // Тест каталога
  assert(Array.isArray(COMMUNITY_OFFICERS) && COMMUNITY_OFFICERS.length >= 10);
  const rex = COMMUNITY_OFFICERS.find(o => o.id === 'general-rex');
  assert.strictEqual(rex.type, 'Танк');

  // Тест VIP дефицита (VIP 14 = 750000)
  const vipRes = calculateVipDeficit({ currentLevel: 10, currentPoints: 350000, targetLevel: 14 });
  assert.strictEqual(vipRes.pointsNeeded, 400000); // 750000 - 350000
  assert.strictEqual(vipRes.dailyPuzzlesIncrease, 3);

  // Граничные условия VIP: уровень 30
  const vipMax = calculateVipDeficit({ currentLevel: 30, currentPoints: 99999999, targetLevel: 30 });
  assert.strictEqual(vipMax.pointsNeeded, 0);
  assert.strictEqual(vipMax.dailyPuzzlesIncrease, 0);

  // Тест навыков 5-5-5-5 (690 медалей)
  const skillsZero = calculateSkillMedalsProgress([1, 1, 1, 1]);
  assert.strictEqual(skillsZero.spentMedals, 0);
  assert.strictEqual(skillsZero.remainingMedals, 690);

  const skillsMax = calculateSkillMedalsProgress([5, 5, 5, 5]);
  assert.strictEqual(skillsMax.spentMedals, 690);
  assert.strictEqual(skillsMax.remainingMedals, 0);
  assert.strictEqual(skillsMax.isMaxSkills, true);

  // Промежуточная прокачка навыка 1 до 5 (первые 4 шага: 10 + 10 + 15 + 15 = 50)
  const skillsPartial = calculateSkillMedalsProgress([5, 1, 1, 1]);
  assert.strictEqual(skillsPartial.spentMedals, 50);
  assert.strictEqual(skillsPartial.remainingMedals, 640);

  // Тест связок
  const pairings = getRecommendedPairings('general-rex');
  assert(pairings.length > 0 && pairings[0].partnerName);

  // Неизвестный офицер
  assert.deepEqual(getRecommendedPairings('unknown-officer'), []);

  // Тест генератора расписания
  const schedule = generateSeasonSchedule({ startDate: '2026-11-01', cyclesCount: 2, presetId: 'king-of-war' });
  assert.strictEqual(schedule.length, 2);
  assert.strictEqual(schedule[1].dateFrom, '2026-11-15');
});

test('smartAutoPickWithRegistrations respects fair play cooldown', () => {
  const catalog = [{ id: 'rex', name: 'Рекс', generation: 7, couponPerPuzzle: 500 }];
  const event = { places: [{ place: 1, coupons: 12500 }] };
  const players = [
    { id: 1, name: 'Победитель', sector: { killPoints: 100 }, stock: { coupons: 0, puzzles: 0 }, officers: [{ id: 'o1', catalogId: 'rex', level: 0, coupons: 0 }] },
    { id: 2, name: 'Претендент', sector: { killPoints: 95 }, stock: { coupons: 0, puzzles: 0 }, officers: [{ id: 'o2', catalogId: 'rex', level: 0, coupons: 0 }] }
  ];

  // Без кулдауна место получает Игрок 1
  const resWithoutCooldown = smartAutoPickWithRegistrations({ event, players, officerCatalog: catalog });
  assert.strictEqual(resWithoutCooldown.assignments[0].playerId, 1);

  // С кулдауном место получает Игрок 2
  const resWithCooldown = smartAutoPickWithRegistrations({
    event,
    players,
    officerCatalog: catalog,
    recentWinners: [1]
  });
  assert.strictEqual(resWithCooldown.assignments[0].playerId, 2, 'Candidate in cooldown should yield place to eligible competitor');
});

test('smartAutoPickWithRegistrations respects candidate explicit isCooldown over isRecentWinner', () => {
  const event = { places: [{ place: 1, coupons: 12500 }] };
  const candidates = [
    { playerId: 1, officerId: 'o1', deficit: 50000, killPoints: 100, isCooldown: true },
    { playerId: 2, officerId: 'o2', deficit: 50000, killPoints: 95, isCooldown: false }
  ];

  // Игрок 1 имеет явный isCooldown = true, поэтому уступает Игроку 2
  const res = smartAutoPickWithRegistrations({ event, candidates });
  assert.strictEqual(res.assignments[0].playerId, 2);
  assert.strictEqual(res.assignments[0].isCooldown, false);

  // Игрок 1 в recentWinners, но явный isCooldown = false переопределяет кулдаун
  const candidatesOverride = [
    { playerId: 1, officerId: 'o1', deficit: 50000, killPoints: 100, isCooldown: false },
    { playerId: 2, officerId: 'o2', deficit: 50000, killPoints: 95, isCooldown: false }
  ];
  const resOverride = smartAutoPickWithRegistrations({ event, candidates: candidatesOverride, recentWinners: [1] });
  assert.strictEqual(resOverride.assignments[0].playerId, 1);
  assert.strictEqual(resOverride.assignments[0].isCooldown, false);
});

test('PWA manifest and mobile app icons exist and are valid', () => {
  const manifestPath = path.join(__dirname, 'manifest.json');
  assert.ok(fs.existsSync(manifestPath), 'manifest.json must exist');

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  assert.strictEqual(manifest.name, 'KoW Tracker - Kingdom of Winners');
  assert.strictEqual(manifest.short_name, 'KoW Tracker');
  assert.strictEqual(manifest.display, 'standalone');
  assert.strictEqual(manifest.theme_color, '#0f172a');
  assert.strictEqual(manifest.background_color, '#0f172a');
  assert.ok(Array.isArray(manifest.icons), 'manifest.icons must be an array');

  const icon192 = manifest.icons.find(i => i.sizes === '192x192');
  const icon512 = manifest.icons.find(i => i.sizes === '512x512');
  assert.ok(icon192, 'manifest must have 192x192 icon');
  assert.ok(icon512, 'manifest must have 512x512 icon');
  assert.strictEqual(icon192.type, 'image/png');
  assert.strictEqual(icon512.type, 'image/png');

  const file192 = path.join(__dirname, icon192.src.replace(/^\//, ''));
  const file512 = path.join(__dirname, icon512.src.replace(/^\//, ''));

  assert.ok(fs.existsSync(file192), 'icon-192.png must exist');
  assert.ok(fs.statSync(file192).size > 0, 'icon-192.png must not be empty');

  assert.ok(fs.existsSync(file512), 'icon-512.png must exist');
  assert.ok(fs.statSync(file512).size > 0, 'icon-512.png must not be empty');

  const htmlPath = path.join(__dirname, 'index.html');
  const html = fs.readFileSync(htmlPath, 'utf-8');
  assert.ok(html.includes('<link rel="manifest" href="/manifest.json">'), 'index.html must link manifest.json');
  assert.ok(html.includes('<meta name="theme-color" content="#0f172a">'), 'index.html must have theme-color');
  assert.ok(html.includes('<meta name="apple-mobile-web-app-capable" content="yes">'), 'index.html must have apple-mobile-web-app-capable');

  const svgFaviconPath = path.join(__dirname, 'favicon.svg');
  const icoFaviconPath = path.join(__dirname, 'favicon.ico');
  assert.ok(fs.existsSync(svgFaviconPath), 'favicon.svg must exist');
  assert.ok(fs.statSync(svgFaviconPath).size > 0, 'favicon.svg must not be empty');
  assert.ok(fs.existsSync(icoFaviconPath), 'favicon.ico must exist');
  assert.ok(fs.statSync(icoFaviconPath).size > 0, 'favicon.ico must not be empty');

  assert.ok(html.includes('href="/favicon.svg"'), 'index.html must link favicon.svg');
  assert.ok(html.includes('href="/favicon.ico"'), 'index.html must link favicon.ico');
  assert.ok(!html.includes('href="data:,"'), 'index.html must not suppress favicon with data:,');
});

test('isOfflineMutationAllowed distinguishes allowed sector, profile, and officer mutations from administrative actions', () => {
  // Allowed R3 profile mutations
  assert.strictEqual(isOfflineMutationAllowed({ endpoint: '/api/my-profile', method: 'PUT' }), true);
  assert.strictEqual(isOfflineMutationAllowed({ endpoint: '/api/my-profile', method: 'put' }), true);
  assert.strictEqual(isOfflineMutationAllowed({ endpoint: '/api/my-profile/officers', method: 'POST' }), true);
  assert.strictEqual(isOfflineMutationAllowed({ endpoint: '/api/my-profile/officers', method: 'PUT' }), true);
  assert.strictEqual(isOfflineMutationAllowed({ endpoint: '/api/my-profile/officers/off-123', method: 'PUT' }), true);
  assert.strictEqual(isOfflineMutationAllowed({ endpoint: '/api/my-profile/officers/off-123', method: 'DELETE' }), true);

  // Allowed sector operations
  assert.strictEqual(isOfflineMutationAllowed({ endpoint: '/api/my-profile/active-sector', method: 'POST' }), true);
  assert.strictEqual(isOfflineMutationAllowed({ endpoint: '/api/my-sectors', method: 'POST' }), true);
  assert.strictEqual(isOfflineMutationAllowed({ endpoint: '/api/players/42', method: 'PUT' }), true);
  assert.strictEqual(isOfflineMutationAllowed({ endpoint: '/api/players/1', method: 'PUT' }), true);
  assert.strictEqual(isOfflineMutationAllowed({ endpoint: '/api/players/42/officers', method: 'POST' }), true);
  assert.strictEqual(isOfflineMutationAllowed({ endpoint: '/api/players/42/officers/off_1', method: 'PUT' }), true);
  assert.strictEqual(isOfflineMutationAllowed({ endpoint: '/api/players/42/officers/off_1', method: 'DELETE' }), true);

  // Allowed event registrations
  assert.strictEqual(isOfflineMutationAllowed({ endpoint: '/api/events/10/registrations', method: 'POST' }), true);
  assert.strictEqual(isOfflineMutationAllowed({ endpoint: '/api/events/10/registrations', method: 'DELETE' }), true);
  assert.strictEqual(isOfflineMutationAllowed({ endpoint: '/api/events/10/registrations/reg-456', method: 'DELETE' }), true);
  assert.strictEqual(isOfflineMutationAllowed({ endpoint: '/api/events/10/register', method: 'POST' }), true);
  assert.strictEqual(isOfflineMutationAllowed({ endpoint: '/api/events/10/register', method: 'DELETE' }), true);
  assert.strictEqual(isOfflineMutationAllowed({ endpoint: '/api/events/ev-42/register', method: 'POST' }), true);
  assert.strictEqual(isOfflineMutationAllowed({ endpoint: '/api/events/ev-42/register', method: 'DELETE' }), true);

  // Forbidden read or non-mutation methods on allowed endpoints
  assert.strictEqual(isOfflineMutationAllowed({ endpoint: '/api/my-profile', method: 'GET' }), false);
  assert.strictEqual(isOfflineMutationAllowed({ endpoint: '/api/my-profile', method: 'POST' }), false);
  assert.strictEqual(isOfflineMutationAllowed({ endpoint: '/api/my-profile', method: 'DELETE' }), false);
  assert.strictEqual(isOfflineMutationAllowed({ endpoint: '/api/my-profile/active-sector', method: 'GET' }), false);
  assert.strictEqual(isOfflineMutationAllowed({ endpoint: '/api/my-sectors', method: 'GET' }), false);
  assert.strictEqual(isOfflineMutationAllowed({ endpoint: '/api/events/10/registrations', method: 'GET' }), false);
  assert.strictEqual(isOfflineMutationAllowed({ endpoint: '/api/events/10/register', method: 'GET' }), false);

  // Forbidden administrative actions (R4 / R5)
  assert.strictEqual(isOfflineMutationAllowed({ endpoint: '/api/events/schedule-season', method: 'POST' }), false);
  assert.strictEqual(isOfflineMutationAllowed({ endpoint: '/api/events/10/autopick', method: 'POST' }), false);
  assert.strictEqual(isOfflineMutationAllowed({ endpoint: '/api/players', method: 'POST' }), false);
  assert.strictEqual(isOfflineMutationAllowed({ endpoint: '/api/players/42', method: 'DELETE' }), false);
  assert.strictEqual(isOfflineMutationAllowed({ endpoint: '/api/players/1', method: 'DELETE' }), false);
  assert.strictEqual(isOfflineMutationAllowed({ endpoint: '/api/catalog', method: 'POST' }), false);
  assert.strictEqual(isOfflineMutationAllowed({ endpoint: '/api/users/2', method: 'PATCH' }), false);
  assert.strictEqual(isOfflineMutationAllowed({ endpoint: '/api/import', method: 'POST' }), false);
  assert.strictEqual(isOfflineMutationAllowed({ endpoint: '/api/export', method: 'GET' }), false);

  // Empty or invalid input
  assert.strictEqual(isOfflineMutationAllowed(), false);
  assert.strictEqual(isOfflineMutationAllowed({ endpoint: '', method: 'PUT' }), false);
  assert.strictEqual(isOfflineMutationAllowed({ endpoint: '/api/my-profile', method: '' }), false);
  assert.strictEqual(isOfflineMutationAllowed(null), false);
});

test('findActiveSector selects active sector by id or falls back to first sector', () => {
  const sectors = [
    { id: 10, name: 'Main' },
    { id: 20, name: 'Farm 1' },
    { id: 30, name: 'Farm 2' },
  ];

  // Matches numeric id
  assert.deepEqual(findActiveSector(sectors, 20), { id: 20, name: 'Farm 1' });
  // Matches string id
  assert.deepEqual(findActiveSector(sectors, '30'), { id: 30, name: 'Farm 2' });
  // Falls back to first sector if activeSectorId not found
  assert.deepEqual(findActiveSector(sectors, 999), { id: 10, name: 'Main' });
  // Falls back to first sector if activeSectorId is null or undefined or empty
  assert.deepEqual(findActiveSector(sectors, null), { id: 10, name: 'Main' });
  assert.deepEqual(findActiveSector(sectors, undefined), { id: 10, name: 'Main' });
  assert.deepEqual(findActiveSector(sectors, ''), { id: 10, name: 'Main' });

  // Returns null if sectors is empty or invalid
  assert.strictEqual(findActiveSector([], 10), null);
  assert.strictEqual(findActiveSector(null, 10), null);
  assert.strictEqual(findActiveSector(undefined, 10), null);
  assert.strictEqual(findActiveSector('not-an-array', 10), null);
});

test('formatSectorTitle formats sector label with VIP and compact power', () => {
  // Millions formatting
  assert.strictEqual(
    formatSectorTitle({ name: '[A433]ranu', sector: { vipLevel: 12, power: 157600000 } }),
    '[A433]ranu (VIP 12 · 157.6M)'
  );
  assert.strictEqual(
    formatSectorTitle({ name: 'Leader', sector: { vipLevel: 15, power: 200000000 } }),
    'Leader (VIP 15 · 200M)'
  );

  // Thousands formatting
  assert.strictEqual(
    formatSectorTitle({ name: 'Sub', sector: { vipLevel: 5, power: 450000 } }),
    'Sub (VIP 5 · 450K)'
  );
  assert.strictEqual(
    formatSectorTitle({ name: 'Sub2', sector: { vipLevel: 5, power: 45500 } }),
    'Sub2 (VIP 5 · 45.5K)'
  );

  // Under thousands / zero
  assert.strictEqual(
    formatSectorTitle({ name: 'Ферма', sector: { vipLevel: 0, power: 0 } }),
    'Ферма (VIP 0 · 0)'
  );
  assert.strictEqual(
    formatSectorTitle({ name: 'Newbie', sector: { vipLevel: 1, power: 750 } }),
    'Newbie (VIP 1 · 750)'
  );

  // Flat structure fallback (sector.vipLevel / sector.power)
  assert.strictEqual(
    formatSectorTitle({ name: 'Flat', vipLevel: 8, power: 1200000 }),
    'Flat (VIP 8 · 1.2M)'
  );

  // Default name fallback if name is empty
  assert.strictEqual(
    formatSectorTitle({ sector: { vipLevel: 3, power: 5000 } }),
    'Сектор (VIP 3 · 5K)'
  );

  // Safe handling of null / undefined / non-object
  assert.strictEqual(formatSectorTitle(null), '');
  assert.strictEqual(formatSectorTitle(undefined), '');
  assert.strictEqual(formatSectorTitle('not an object'), '');
});

test('createOutboxItem creates structured item with id, timestamp, normalized method and cloned body', () => {
  const customTime = 1700000000000;
  const initialBody = { sector: { vipLevel: 12 }, nested: [1, 2] };

  const item1 = createOutboxItem({
    endpoint: '/api/my-profile',
    method: 'put',
    body: initialBody,
  });

  assert.ok(item1.id && typeof item1.id === 'string', 'item id should be generated');
  assert.ok(item1.id.startsWith('outbox_'), 'item id should start with outbox_');
  assert.strictEqual(item1.endpoint, '/api/my-profile');
  assert.strictEqual(item1.method, 'PUT', 'method should be uppercased');
  assert.deepStrictEqual(item1.body, initialBody);
  assert.ok(typeof item1.timestamp === 'number' && item1.timestamp > 0);
  assert.strictEqual(item1.retryCount, 0);

  // Deep clone verification: mutating original object does not affect item.body
  initialBody.sector.vipLevel = 99;
  initialBody.nested.push(3);
  assert.strictEqual(item1.body.sector.vipLevel, 12);
  assert.deepStrictEqual(item1.body.nested, [1, 2]);

  // Custom id and timestamp preservation, default method fallback to POST
  const item2 = createOutboxItem({
    id: 'custom-id-77',
    endpoint: '/api/events/5/registrations',
    timestamp: customTime,
  });

  assert.strictEqual(item2.id, 'custom-id-77');
  assert.strictEqual(item2.method, 'POST');
  assert.strictEqual(item2.timestamp, customTime);
  assert.strictEqual(item2.body, null);
  assert.strictEqual(item2.retryCount, 0);
});

test('addToOutboxQueue appends items and deduplicates repeated PUT mutations to the same endpoint', () => {
  const itemPut1 = {
    id: 'id-put-1',
    endpoint: '/api/my-profile',
    method: 'PUT',
    body: { stock: { coupons: 100 } },
    timestamp: 1000,
    retryCount: 0,
  };

  const itemPost1 = {
    id: 'id-post-1',
    endpoint: '/api/events/1/registrations',
    method: 'POST',
    body: { officerId: 'o1' },
    timestamp: 1500,
    retryCount: 0,
  };

  // Add to empty queue
  const q1 = addToOutboxQueue([], itemPut1);
  assert.strictEqual(q1.length, 1);
  assert.deepStrictEqual(q1[0], itemPut1);

  // Append different item (POST)
  const q2 = addToOutboxQueue(q1, itemPost1);
  assert.strictEqual(q2.length, 2);
  assert.strictEqual(q2[0].id, 'id-put-1');
  assert.strictEqual(q2[1].id, 'id-post-1');

  // Deduplication: Repeated PUT to /api/my-profile
  const itemPut2 = {
    id: 'id-put-2',
    endpoint: '/api/my-profile',
    method: 'PUT',
    body: { stock: { coupons: 250 } },
    timestamp: 2000,
    retryCount: 0,
  };

  const q3 = addToOutboxQueue(q2, itemPut2);
  assert.strictEqual(q3.length, 2, 'queue length should remain 2 after deduplicating PUT');
  assert.strictEqual(q3[0].id, 'id-put-1', 'original id should be retained');
  assert.deepStrictEqual(q3[0].body, { stock: { coupons: 250 } }, 'body should be updated');
  assert.strictEqual(q3[0].timestamp, 2000, 'timestamp should be updated');
  assert.strictEqual(q3[1].id, 'id-post-1', 'second item should remain untouched');

  // Immutability: previous queues are not modified
  assert.strictEqual(q1.length, 1);
  assert.strictEqual(q2.length, 2);
  assert.strictEqual(q2[0].body.stock.coupons, 100);

  // Repeated POST to same endpoint should NOT be deduplicated
  const itemPost2 = {
    id: 'id-post-2',
    endpoint: '/api/events/1/registrations',
    method: 'POST',
    body: { officerId: 'o2' },
    timestamp: 2500,
    retryCount: 0,
  };
  const q4 = addToOutboxQueue(q3, itemPost2);
  assert.strictEqual(q4.length, 3, 'POST requests should not be deduplicated');
});

test('addToOutboxQueue merges object properties when deduplicating PUT requests', () => {
  const item1 = {
    id: 'put-1',
    endpoint: '/api/my-profile',
    method: 'PUT',
    body: { sector: { power: 100 } },
    timestamp: 1000,
  };
  const item2 = {
    id: 'put-2',
    endpoint: '/api/my-profile',
    method: 'PUT',
    body: { stock: { coupons: 50 } },
    timestamp: 2000,
  };
  const queue = addToOutboxQueue([item1], item2);
  assert.strictEqual(queue.length, 1);
  assert.deepStrictEqual(queue[0].body, {
    sector: { power: 100 },
    stock: { coupons: 50 },
  });
  assert.strictEqual(queue[0].id, 'put-1');
  assert.strictEqual(queue[0].timestamp, 2000);
});

test('filterOutboxQueue removes completed items by id immutably', () => {
  const initialQueue = [
    { id: 'item-1', endpoint: '/api/my-profile' },
    { id: 'item-2', endpoint: '/api/events/1/registrations' },
    { id: 'item-3', endpoint: '/api/my-profile/officers' },
  ];

  const filtered = filterOutboxQueue(initialQueue, 'item-2');
  assert.strictEqual(filtered.length, 2);
  assert.deepStrictEqual(filtered.map(x => x.id), ['item-1', 'item-3']);

  // Immutability
  assert.strictEqual(initialQueue.length, 3);

  // Removing non-existent id
  const unchanged = filterOutboxQueue(initialQueue, 'non-existent');
  assert.strictEqual(unchanged.length, 3);
  assert.notStrictEqual(unchanged, initialQueue, 'should return a new array instance');

  // Empty queue handling
  assert.deepStrictEqual(filterOutboxQueue([], 'item-1'), []);
  assert.deepStrictEqual(filterOutboxQueue(null, 'item-1'), []);
});

test('calculates total star points and validates stock constants', () => {
  assert.deepStrictEqual(STAR_ITEM_VALUES, {
    legendaryStars1: 110,
    legendaryStars2: 420,
    legendaryStars3: 960,
  });

  // Formula check: (1097 * 110) + (95 * 420) + (22 * 960) = 120670 + 39900 + 21120 = 181690
  const total = calculateTotalStarPoints({
    legendaryStars1: 1097,
    legendaryStars2: 95,
    legendaryStars3: 22,
  });
  assert.strictEqual(total, 181690);

  // Safe defaults on empty/null/negative
  assert.strictEqual(calculateTotalStarPoints(), 0);
  assert.strictEqual(calculateTotalStarPoints(null), 0);
  assert.strictEqual(calculateTotalStarPoints({ legendaryStars1: -10, legendaryStars2: 'abc' }), 0);

  // Supports db column snake_case names
  const totalDb = calculateTotalStarPoints({
    stock_legendary_stars_1: 10,
    stock_legendary_stars_2: 2,
    stock_legendary_stars_3: 1,
  });
  assert.strictEqual(totalDb, 10 * 110 + 2 * 420 + 1 * 960);

  // normalizeStock handles all 7 inventory fields
  const normalized = normalizeStock({
    coupons: '419202',
    puzzles: 2077,
    starCoupons: 244712,
    legendaryStars1: '1097',
    legendaryStars2: 95,
    legendaryStars3: 22,
    chests: 5,
  });
  assert.deepStrictEqual(normalized, {
    coupons: 419202,
    puzzles: 2077,
    starCoupons: 244712,
    legendaryStars1: 1097,
    legendaryStars2: 95,
    legendaryStars3: 22,
    chests: 5,
  });
});

test('cleanOcrNumber removes artifacts, replaces O/I/l and handles K/M/B multipliers', () => {
  assert.strictEqual(cleanOcrNumber(' 157,660,593 '), 157660593);
  assert.strictEqual(cleanOcrNumber('7 588 164 323'), 7588164323);
  assert.strictEqual(cleanOcrNumber('419.202'), 419202);
  assert.strictEqual(cleanOcrNumber('2,077'), 2077);
  assert.strictEqual(cleanOcrNumber('l,097'), 1097); // letter l -> 1
  assert.strictEqual(cleanOcrNumber('I097'), 1097); // letter I -> 1
  assert.strictEqual(cleanOcrNumber('95o'), 950); // letter o -> 0
  assert.strictEqual(cleanOcrNumber('42O'), 420); // letter O -> 0
  assert.strictEqual(cleanOcrNumber("1'097"), 1097); // apostrophe delimiter
  assert.strictEqual(cleanOcrNumber('7.6B'), 7600000000); // multiplier B
  assert.strictEqual(cleanOcrNumber('7,6 b'), 7600000000); // multiplier b with comma
  assert.strictEqual(cleanOcrNumber('15M'), 15000000); // multiplier M
  assert.strictEqual(cleanOcrNumber('2.5K'), 2500); // multiplier K
  assert.strictEqual(cleanOcrNumber(419202), 419202); // numeric input
  assert.strictEqual(cleanOcrNumber(''), 0);
  assert.strictEqual(cleanOcrNumber(null), 0);
  assert.strictEqual(cleanOcrNumber(undefined), 0);
  assert.strictEqual(cleanOcrNumber('invalid text'), 0);
});

test('parseProfileScreenshotText extracts player stats and ignores VIP level', () => {
  const ocrText1 = `
[A433]ranu
Сила: 157,660,593
VIP 12
Убито: 84,778,517
Очки за убийства: 7.6B
  `;

  const parsed1 = parseProfileScreenshotText(ocrText1);
  assert.strictEqual(parsed1.isProfile, true);
  assert.strictEqual(parsed1.sector.name, 'ranu');
  assert.strictEqual(parsed1.sector.allianceTag, 'A433');
  assert.strictEqual(parsed1.sector.power, 157660593);
  assert.strictEqual(parsed1.sector.kills, 84778517);
  assert.strictEqual(parsed1.sector.killPoints, 7600000000);
  assert.strictEqual('vip' in parsed1.sector, false, 'VIP must not be extracted');
  assert.strictEqual('vipLevel' in parsed1.sector, false, 'vipLevel must not be extracted');

  // Detailed stats table with exact integer killPoints
  const ocrText2 = `
[A433]ranu
Сила: 157,660,593
VIP 12
Уничтожено юнитов: 84,778,517
Подробная статистика
Очки за убийство: 7,588,164,323
  `;

  const parsed2 = parseProfileScreenshotText(ocrText2);
  assert.strictEqual(parsed2.isProfile, true);
  assert.strictEqual(parsed2.sector.killPoints, 7588164323, 'exact killPoints preferred over 7.6B');
  assert.strictEqual('vip' in parsed2.sector, false);

  // Non-profile text returns isProfile false
  const nonProfile = parseProfileScreenshotText('Привет мир, здесь нет статистики');
  assert.strictEqual(nonProfile.isProfile, false);
  assert.deepStrictEqual(nonProfile.sector, {});
});

test('parseProfileScreenshotText recognizes profiles with Cyrillic alliance tags and names', () => {
  const ocrCyrillic = `
[РФ]Медведь
Сила: 98,540,120
Убито: 42,100,000
Очки за убийства: 3.2B
  `;
  const parsed = parseProfileScreenshotText(ocrCyrillic);
  assert.strictEqual(parsed.isProfile, true);
  assert.strictEqual(parsed.sector.allianceTag, 'РФ');
  assert.strictEqual(parsed.sector.name, 'Медведь');
  assert.strictEqual(parsed.sector.power, 98540120);
  assert.strictEqual(parsed.sector.kills, 42100000);
  assert.strictEqual(parsed.sector.killPoints, 3200000000);

  // With prefix "Командир: [РУС] Добрыня"
  const ocrPrefix = `
Командир: [РУС] Добрыня
Мощь: 120,000,000
  `;
  const parsedPrefix = parseProfileScreenshotText(ocrPrefix);
  assert.strictEqual(parsedPrefix.isProfile, true);
  assert.strictEqual(parsedPrefix.sector.allianceTag, 'РУС');
  assert.strictEqual(parsedPrefix.sector.name, 'Добрыня');
  assert.strictEqual(parsedPrefix.sector.power, 120000000);
});

test('parseWarehouseScreenshotText extracts coupons, puzzles, starCoupons and legendary stars 1-3', () => {
  const warehouseTextPart1 = `
Купон готовности офицера
Использовать
В наличии: 419,202
Медаль легендарного офицера
Использовать
В наличии: 2,077
  `;

  const parsed1 = parseWarehouseScreenshotText(warehouseTextPart1);
  assert.strictEqual(parsed1.isWarehouse, true);
  assert.strictEqual(parsed1.stock.coupons, 419202);
  assert.strictEqual(parsed1.stock.puzzles, 2077);
  assert.strictEqual(parsed1.stock.starCoupons, undefined, 'unseen items not included');
  assert.strictEqual(parsed1.stock.legendaryStars1, undefined);

  const warehouseTextPart2 = `
Купон готовности звезды
В наличии: 244,712
Легендарная звезда I
110
В наличии: 1,097
Легендарная звезда II
420
В наличии: 95
Легендарная звезда III
960
В наличии: 22
  `;

  const parsed2 = parseWarehouseScreenshotText(warehouseTextPart2);
  assert.strictEqual(parsed2.isWarehouse, true);
  assert.strictEqual(parsed2.stock.starCoupons, 244712);
  assert.strictEqual(parsed2.stock.legendaryStars1, 1097);
  assert.strictEqual(parsed2.stock.legendaryStars2, 95);
  assert.strictEqual(parsed2.stock.legendaryStars3, 22);

  // Roman/Arabic numeral variants and apostrophe delimiters
  const warehouseTextVariants = `
Купон готовности звезд
В наличии: 244'712
Легендарная звезда 1
110
В наличии: l,097
Легендарная звезда 2
420
В наличии: 95
Легендарная звезда 3
960
В наличии: 22
  `;
  const parsedVariants = parseWarehouseScreenshotText(warehouseTextVariants);
  assert.strictEqual(parsedVariants.stock.starCoupons, 244712);
  assert.strictEqual(parsedVariants.stock.legendaryStars1, 1097);
  assert.strictEqual(parsedVariants.stock.legendaryStars2, 95);
  assert.strictEqual(parsedVariants.stock.legendaryStars3, 22);

  const nonWarehouse = parseWarehouseScreenshotText('Никаких складов');
  assert.strictEqual(nonWarehouse.isWarehouse, false);
  assert.deepStrictEqual(nonWarehouse.stock, {});
});

test('parseWarehouseScreenshotText accurately parses multi-item inventory without cross-line greedy number concatenation', () => {
  const pcInventoryText = `
Каждый предмет важен!
РЕСУРСЫ УСКОРИТЕЛИ УСИЛЕНИЕ ДРУГИЕ
В наличии: 4,628
960 Эпическая звезда III
В наличии: 147
420 Легендарная звезда II
В наличии: 98
110 Эксклюзивная звезда (S2 Наталья)
В наличии: 1
110 Легендарная звезда I
В наличии: 1,155
960 Легендарная звезда III
В наличии: 23
100 100 опыта офицера
В наличии: 2,760,814
  `;

  const parsed = parseWarehouseScreenshotText(pcInventoryText);
  assert.strictEqual(parsed.isWarehouse, true);
  assert.strictEqual(parsed.stock.legendaryStars1, 1155, 'Legendary Star 1 must be exactly 1155, not concatenated with next line');
  assert.strictEqual(parsed.stock.legendaryStars2, 98, 'Legendary Star 2 must be exactly 98, not concatenated with next line');
  assert.strictEqual(parsed.stock.legendaryStars3, 23, 'Legendary Star 3 must be exactly 23, not concatenated with next line');
});

test('parseWarehouseScreenshotText recognizes real-world noisy OCR stars and avoids false profile extraction', () => {
  const realOcrText = `De —_——_, „@
Эпическая звезда
В наличии: 147
[220 | Легендарная
а звезда П
x ; B наличии: 98
| по’ | Эксклюзивная
\\( 3 HE
AWE Вналичии:1
|500 | 500опыта
7 то офицера
7 | Вналичии: 142,881
| 5000 | — 5000 опыта
7 ч офицера
% | Вналичии: 3,807

EE ан сане aaa ОВЕН
i он]
а [| 10 J Легендарная
TERT звезда!
) \` 3 В наличии: 1155
[660 Легендарная
= 7 звезда Ш
у Ь-— Вналичии:23
о) (Е
2 я, / Вналичии: 2,760,814
| 1000 | 1,000 опыта
у то офицера
1 у 7 В наличии: 166,057
| 10000 | 10,000 опыта
ря офицера
4 у A В наличии: 36,033`;

  const parsed = parseWarehouseScreenshotText(realOcrText);
  assert.strictEqual(parsed.isWarehouse, true);
  assert.strictEqual(parsed.stock.legendaryStars1, 1155);
  assert.strictEqual(parsed.stock.legendaryStars2, 98);
  assert.strictEqual(parsed.stock.legendaryStars3, 23);

  const profileCheck = parseProfileScreenshotText(realOcrText);
  assert.strictEqual(profileCheck.isProfile, false, 'Warehouse with exclusive star Natalia must not be parsed as player profile');
});

test('mergeScanResults combines multiple screenshots without losing or overwriting data', () => {
  const scan1 = {
    isProfile: true,
    sector: { name: 'ranu', allianceTag: 'A433', power: 157660593, kills: 84778517, killPoints: 7600000000 },
  };
  const scan2 = {
    isProfile: true,
    sector: { name: 'ranu', allianceTag: 'A433', power: 157660593, kills: 84778517, killPoints: 7588164323 },
  };
  const scan3 = {
    isWarehouse: true,
    stock: { coupons: 419202, puzzles: 2077 },
  };
  const scan4 = {
    isWarehouse: true,
    stock: { starCoupons: 244712, legendaryStars1: 1097, legendaryStars2: 95, legendaryStars3: 22 },
  };

  // Step 1: Scan 1 (profile top)
  let merged = mergeScanResults({}, scan1);
  assert.strictEqual(merged.sector.killPoints, 7600000000);
  assert.strictEqual(merged.sector.power, 157660593);

  // Step 2: Scan 2 (profile detailed) overrides rounded killPoints with exact number
  merged = mergeScanResults(merged, scan2);
  assert.strictEqual(merged.sector.killPoints, 7588164323);
  assert.strictEqual(merged.sector.power, 157660593);
  assert.strictEqual(merged.sector.name, 'ranu');

  // Step 3: Scan 3 (warehouse part 1) adds coupons/puzzles without touching sector
  merged = mergeScanResults(merged, scan3);
  assert.strictEqual(merged.sector.power, 157660593);
  assert.strictEqual(merged.stock.coupons, 419202);
  assert.strictEqual(merged.stock.puzzles, 2077);

  // Step 4: Scan 4 (warehouse part 2) adds star coupons and stars without erasing coupons/puzzles
  merged = mergeScanResults(merged, scan4);
  assert.strictEqual(merged.sector.name, 'ranu');
  assert.strictEqual(merged.sector.power, 157660593);
  assert.strictEqual(merged.stock.coupons, 419202);
  assert.strictEqual(merged.stock.puzzles, 2077);
  assert.strictEqual(merged.stock.starCoupons, 244712);
  assert.strictEqual(merged.stock.legendaryStars1, 1097);
  assert.strictEqual(merged.stock.legendaryStars2, 95);
  assert.strictEqual(merged.stock.legendaryStars3, 22);

  // Total star points on merged stock equals 181690
  assert.strictEqual(calculateTotalStarPoints(merged.stock), 181690);

  // Preserves existing chests
  const withChests = mergeScanResults({ stock: { chests: 42 } }, scan3);
  assert.strictEqual(withChests.stock.chests, 42);
  assert.strictEqual(withChests.stock.coupons, 419202);
});

test('calculateTotalMedals calculates sum of before and training medals with defaults', () => {
  const { calculateTotalMedals } = require('./logic.js');
  assert.strictEqual(calculateTotalMedals(480, 900), 1380);
  assert.strictEqual(calculateTotalMedals(0, 0), 0);
  assert.strictEqual(calculateTotalMedals(500, 1000), 1500);
  assert.strictEqual(calculateTotalMedals('480', '900'), 1380);
  assert.strictEqual(calculateTotalMedals(-50, 900), 900);
});

test('OFFICER_TYPES contains exactly the 5 shop troop types', () => {
  const { OFFICER_TYPES } = require('./logic.js');
  assert.deepStrictEqual(OFFICER_TYPES, ['Танк', 'Пехота', 'ПТ-Сау', 'Горнизон', 'Осада']);
});

test('parseExchangeShopScreenshotText extracts officers, seasons, puzzle coupons, and star coupons', () => {
  const { parseExchangeShopScreenshotText } = require('./logic.js');

  const sampleOcrText = `
До обновления: 05:16:28
Обмен на медали офицера, сезон 8
S8
По
x1 720 ОБМЕН
110 x1 360 ОБМЕН
S8
Sara
x1 720 ОБМЕН
110 x1 360 ОБМЕН
Обмен на медали офицера, сезон 7
S7
Ройшин
x1 600 ОБМЕН
110 x1 300 ОБМЕН
`;

  const results = parseExchangeShopScreenshotText(sampleOcrText);
  assert.ok(Array.isArray(results));
  assert.strictEqual(results.length, 3);

  const po = results.find(o => o.name === 'По');
  assert.ok(po, 'Officer По must be parsed');
  assert.strictEqual(po.generation, 8);
  assert.strictEqual(po.couponPerPuzzle, 720);
  assert.strictEqual(po.starCouponCost, 360);
  assert.strictEqual(po.medalsBeforeTraining, 690);
  assert.strictEqual(po.medalsTraining, 900);
  assert.strictEqual(po.medalsTotal, 1590);

  const sara = results.find(o => o.name === 'Sara');
  assert.ok(sara, 'Officer Sara must be parsed');
  assert.strictEqual(sara.generation, 8);
  assert.strictEqual(sara.couponPerPuzzle, 720);
  assert.strictEqual(sara.starCouponCost, 360);

  const royshin = results.find(o => o.name === 'Ройшин');
  assert.ok(royshin, 'Officer Ройшин must be parsed');
  assert.strictEqual(royshin.generation, 7);
  assert.strictEqual(royshin.couponPerPuzzle, 600);
  assert.strictEqual(royshin.starCouponCost, 300);
});

test('parseExchangeShopScreenshotText handles Cyrillic C8 badges and OCR variations', () => {
  const { parseExchangeShopScreenshotText } = require('./logic.js');

  // Real world Tesseract OCR output with Cyrillic С8 (U+0421), spaces and OCR noise
  const ocrNoiseText = `
Магазин обмена
С 8
По
х1 720 0БМЕН
110 х1 360 0БМЕН
С8 Валькирия
х1 720 ОБМЕН
110 х1 360 ОБМЕН
`;

  const results = parseExchangeShopScreenshotText(ocrNoiseText);
  assert.strictEqual(results.length, 2);

  const po = results.find(o => o.name === 'По');
  assert.ok(po, 'Must detect По with Cyrillic C 8 badge');
  assert.strictEqual(po.generation, 8);
  assert.strictEqual(po.couponPerPuzzle, 720);
  assert.strictEqual(po.starCouponCost, 360);

  const valk = results.find(o => o.name === 'Валькирия');
  assert.ok(valk, 'Must detect Валькирия with Cyrillic C8 badge');
  assert.strictEqual(valk.generation, 8);
});

test('calculateVipDeficit and dailyRewards support dynamic vipTiers and default VIP 14 is 750000', () => {
  const { calculateVipDeficit, VIP_TIERS_DATA, dailyRewards } = require('./logic.js');

  // Default VIP 14 points check
  const def14 = VIP_TIERS_DATA.find(t => t.level === 14);
  assert.ok(def14);
  assert.strictEqual(def14.points, 750000);

  // calculateVipDeficit with default tiers: deficit to 14 from 500,000 points
  const defDefault = calculateVipDeficit({ currentLevel: 13, currentPoints: 500000, targetLevel: 14 });
  assert.strictEqual(defDefault.pointsNeeded, 250000); // 750000 - 500000

  // calculateVipDeficit with custom dynamic tiers
  const customTiers = [
    { level: 13, points: 600000, dailyPuzzles: 2 },
    { level: 14, points: 800000, dailyPuzzles: 4 },
  ];
  const defCustom = calculateVipDeficit({ currentLevel: 13, currentPoints: 500000, targetLevel: 14, vipTiers: customTiers });
  assert.strictEqual(defCustom.pointsNeeded, 300000); // 800000 - 500000
  assert.strictEqual(defCustom.dailyPuzzlesIncrease, 2); // 4 - 2

  // dailyRewards with dynamic tiers
  const rewCustom = dailyRewards({ vipLevel: 14, confidentialityLevel: 0 }, customTiers);
  assert.strictEqual(rewCustom.puzzlesPerDay, 4);
});

test('EVENT_PRESETS contains king-of-war, mighty-forces, power-of-time and no mightiest-commander', () => {
  const logic = require('./logic.js');
  const presets = logic.EVENT_PRESETS;
  assert.equal(presets.some(p => p.id === 'mightiest-commander'), false);
  const kow = presets.find(p => p.id === 'king-of-war');
  const mf = presets.find(p => p.id === 'mighty-forces');
  const pot = presets.find(p => p.id === 'power-of-time');
  assert(kow && mf && pot);
  assert.equal(kow.startDayOfWeek, 2); // Вт
  assert.equal(kow.durationDays, 2);   // 2 дня
  assert.equal(kow.weekOffset, 0);
  assert.equal(mf.startDayOfWeek, 6);  // Сб
  assert.equal(mf.durationDays, 3);    // 3 дня
  assert.equal(mf.weekOffset, 0);
  assert.equal(pot.startDayOfWeek, 2); // Вт
  assert.equal(pot.durationDays, 3);   // 3 дня
  assert.equal(pot.weekOffset, 1);     // Чередуется с King of War
});

test('generateSeasonSchedule generates alternating schedule for 8 weeks from Monday', () => {
  const logic = require('./logic.js');
  const items = logic.generateSeasonSchedule({
    startDate: '2026-11-02', // Понедельник
    totalWeeks: 8,
    rules: logic.EVENT_PRESETS
  });

  // 8 недель:
  // king-of-war (нед 0, 2, 4, 6) -> 4 события (Вт-Ср)
  // mighty-forces (нед 0, 2, 4, 6) -> 4 события (Сб-Пн)
  // power-of-time (нед 1, 3, 5, 7) -> 4 события (Вт-Чт)
  // Итого 12 событий
  assert.equal(items.length, 12);

  const kowEvents = items.filter(e => e.typeId === 'king-of-war');
  assert.equal(kowEvents.length, 4);
  assert.equal(kowEvents[0].dateFrom, '2026-11-03'); // Вт
  assert.equal(kowEvents[0].dateTo, '2026-11-04');   // Ср

  const mfEvents = items.filter(e => e.typeId === 'mighty-forces');
  assert.equal(mfEvents.length, 4);
  assert.equal(mfEvents[0].dateFrom, '2026-11-07'); // Сб
  assert.equal(mfEvents[0].dateTo, '2026-11-09');   // Пн

  const potEvents = items.filter(e => e.typeId === 'power-of-time');
  assert.equal(potEvents.length, 4);
  assert.equal(potEvents[0].dateFrom, '2026-11-10'); // Вт на неделе 1
  assert.equal(potEvents[0].dateTo, '2026-11-12');   // Чт
});

test('generateSeasonSchedule correctly computes base Monday if startDate is mid-week', () => {
  const logic = require('./logic.js');
  const items = logic.generateSeasonSchedule({
    startDate: '2026-11-05', // Четверг
    totalWeeks: 2,
    rules: [{ id: 'king-of-war', name: 'Король Войны', startDayOfWeek: 2, durationDays: 2, activeWeeks: 1, breakWeeks: 1, weekOffset: 0 }]
  });
  // Базовый понедельник недели 0 — 2026-11-02, событие во Вт 2026-11-03
  assert.equal(items.length, 1);
  assert.equal(items[0].dateFrom, '2026-11-03');
  assert.equal(items[0].dateTo, '2026-11-04');
});

test('generateSeasonSchedule supports custom cadence (2 active weeks, 1 break week)', () => {
  const logic = require('./logic.js');
  const items = logic.generateSeasonSchedule({
    startDate: '2026-11-02',
    totalWeeks: 6,
    rules: [{ id: 'custom', name: 'Тест', startDayOfWeek: 1, durationDays: 1, activeWeeks: 2, breakWeeks: 1, weekOffset: 0 }]
  });
  // Недели активности: 0, 1 (активны), 2 (перерыв), 3, 4 (активны), 5 (перерыв) -> 4 события
  assert.equal(items.length, 4);
  assert.equal(items[0].dateFrom, '2026-11-02');
  assert.equal(items[1].dateFrom, '2026-11-09');
  assert.equal(items[2].dateFrom, '2026-11-23');
  assert.equal(items[3].dateFrom, '2026-11-30');
});

test('generateSeasonSchedule preserves backward compatibility with legacy presetId and cyclesCount', () => {
  const logic = require('./logic.js');
  const items = logic.generateSeasonSchedule({
    startDate: '2026-12-01',
    presetId: 'king-of-war',
    cyclesCount: 2
  });
  assert(items.length >= 2);
  assert.equal(items[0].dateFrom, '2026-12-01');
});

test('smartScanner resolveLogic and browser UMD exports in logic.js', () => {
  const ocr = require('./ocr.js');
  const logic = require('./logic.js');

  // 1. resolveLogic should be exposed on smartScanner
  assert.strictEqual(typeof ocr.resolveLogic, 'function', 'resolveLogic must be exported');

  // 2. Explicit options.logic works
  assert.strictEqual(ocr.resolveLogic(logic), logic);

  // 3. Fallback to direct globalThis/window when root.logic is not defined but functions exist on root
  const mockGlobal = {
    parseProfileScreenshotText: () => ({ isProfile: true }),
    parseWarehouseScreenshotText: () => ({ isWarehouse: true }),
  };
  const resolvedDirect = ocr.resolveLogic(null, { ignoreInjected: true, ignoreRequire: true, customGlobal: mockGlobal });
  assert.strictEqual(resolvedDirect, mockGlobal, 'Must resolve to customGlobal directly when functions exist on root');

  // Also test fallback to root.logic when customGlobal.logic exists
  const mockWithLogic = {
    logic: {
      parseProfileScreenshotText: () => ({ isProfile: true }),
    },
  };
  const resolvedNested = ocr.resolveLogic(null, { ignoreInjected: true, ignoreRequire: true, customGlobal: mockWithLogic });
  assert.strictEqual(resolvedNested, mockWithLogic.logic, 'Must resolve to customGlobal.logic when present');

  // 4. Test browser UMD wrapper sets both root.logic and root properties
  const fs = require('fs');
  const vm = require('vm');
  const mockBrowserRoot = {};
  const logicCode = fs.readFileSync(__dirname + '/logic.js', 'utf8');
  const context = { console };
  context.window = mockBrowserRoot;
  context.globalThis = mockBrowserRoot;
  vm.createContext(context);
  vm.runInContext(logicCode, context);
  assert(mockBrowserRoot.logic, 'mockBrowserRoot.logic must be populated in browser environment');
  assert.strictEqual(typeof mockBrowserRoot.logic.parseProfileScreenshotText, 'function');
  assert.strictEqual(typeof mockBrowserRoot.parseProfileScreenshotText, 'function');

  // 5. Test user screenshot profile OCR text
  const userScreenshotText = `
[A433]ranu
Сила: 158 204 982
Убито: 84 778 531
Очки за убийство: 7 588 165 023
VIP 12
  `;
  const parsedUser = logic.parseProfileScreenshotText(userScreenshotText);
  assert.strictEqual(parsedUser.isProfile, true);
  assert.strictEqual(parsedUser.sector.name, 'ranu');
  assert.strictEqual(parsedUser.sector.allianceTag, 'A433');
  assert.strictEqual(parsedUser.sector.power, 158204982);
  assert.strictEqual(parsedUser.sector.kills, 84778531);
  assert.strictEqual(parsedUser.sector.killPoints, 7588165023);
});

test('formatInputNumber and parseInputNumber format numbers with spaces and parse accurately', () => {
  // 1. Целые числа
  assert.strictEqual(formatInputNumber(158204982), '158 204 982');
  assert.strictEqual(formatInputNumber('84778531'), '84 778 531');
  assert.strictEqual(formatInputNumber('158 204 982'), '158 204 982');
  assert.strictEqual(formatInputNumber(629500), '629 500');
  assert.strictEqual(formatInputNumber(0), '0');
  assert.strictEqual(formatInputNumber('0'), '0');
  assert.strictEqual(formatInputNumber(''), '');
  assert.strictEqual(formatInputNumber(null), '');
  assert.strictEqual(formatInputNumber(undefined), '');

  // 2. Дробные числа (allowDecimals = true)
  assert.strictEqual(formatInputNumber('7588165023.5', true), '7 588 165 023.5');
  assert.strictEqual(formatInputNumber('7588165023,5', true), '7 588 165 023,5');
  assert.strictEqual(formatInputNumber(7588165023.5, true), '7 588 165 023.5');
  assert.strictEqual(formatInputNumber('1234,', true), '1 234,');

  // 3. Парсинг parseInputNumber
  assert.strictEqual(parseInputNumber('158 204 982'), 158204982);
  assert.strictEqual(parseInputNumber('84 778 531'), 84778531);
  assert.strictEqual(parseInputNumber('7 588 165 023.5', true), 7588165023.5);
  assert.strictEqual(parseInputNumber('7 588 165 023,5', true), 7588165023.5);
  assert.strictEqual(parseInputNumber('0'), 0);
  assert.strictEqual(parseInputNumber(''), 0);
  assert.strictEqual(parseInputNumber(null), 0);
  assert.strictEqual(parseInputNumber(undefined), 0);
  assert.strictEqual(parseInputNumber(158204982), 158204982);
});

test('SKILL_PROGRESSION_COSTS and calculateSkillMedalsProgress follow the 16-step 690-medal game progression', () => {
  // 1. Проверка структуры ряда из 16 шагов
  assert.strictEqual(SKILL_PROGRESSION_COSTS.length, 16);
  const totalSum = SKILL_PROGRESSION_COSTS.reduce((a, b) => a + b, 0);
  assert.strictEqual(totalSum, 690, 'Сумма 16 шагов должна быть строго 690 медалей');
  assert.deepStrictEqual(SKILL_PROGRESSION_COSTS, [
    10, 10, 15, 15, 30, 30, 40, 40, 45, 45, 50, 50, 75, 75, 80, 80
  ]);

  // 2. Начальный уровень 1-1-1-1
  const zero = calculateSkillMedalsProgress([1, 1, 1, 1]);
  assert.strictEqual(zero.spentMedals, 0);
  assert.strictEqual(zero.totalMedals, 690);
  assert.strictEqual(zero.remainingMedals, 690);
  assert.strictEqual(zero.isMaxSkills, false);

  // 3. Прокачка одного навыка до 5-го уровня (4 апа): 10 + 10 + 15 + 15 = 50
  const step4 = calculateSkillMedalsProgress([5, 1, 1, 1]);
  assert.strictEqual(step4.spentMedals, 50);
  assert.strictEqual(step4.remainingMedals, 640);

  // 4. Прокачка двух навыков до 5-го уровня (8 апов): 50 + 30 + 30 + 40 + 40 = 190
  const step8 = calculateSkillMedalsProgress([5, 5, 1, 1]);
  assert.strictEqual(step8.spentMedals, 190);
  assert.strictEqual(step8.remainingMedals, 500);

  // 5. Прокачка трех навыков до 5-го уровня (12 апов): 190 + 45 + 45 + 50 + 50 = 380
  const step12 = calculateSkillMedalsProgress([5, 5, 5, 1]);
  assert.strictEqual(step12.spentMedals, 380);
  assert.strictEqual(step12.remainingMedals, 310);

  // 6. Максимальная прокачка 5-5-5-5 (16 апов): 380 + 75 + 75 + 80 + 80 = 690
  const step16 = calculateSkillMedalsProgress([5, 5, 5, 5]);
  assert.strictEqual(step16.spentMedals, 690);
  assert.strictEqual(step16.remainingMedals, 0);
  assert.strictEqual(step16.isMaxSkills, true);

  // 7. Динамический потолок из карточки каталога (напр. 480)
  const custom = calculateSkillMedalsProgress([5, 5, 5, 5], 480);
  assert.strictEqual(custom.totalMedals, 480);
  assert.strictEqual(custom.spentMedals, 480);
  assert.strictEqual(custom.remainingMedals, 0);
  assert.strictEqual(custom.isMaxSkills, true);
});

test('calculateStarStockDelta manages stock deduction and refunds with coupons-first priority', () => {
  // Запас склада: 3000 купонов звезды (курс 300 = 110 очков, т.е. 1 100 очков) + 2 звезды III (2*960=1920) + 1 звезда I (110)
  const stock = {
    starCoupons: 3000,
    legendaryStars1: 1,
    legendaryStars2: 0,
    legendaryStars3: 2,
  };

  // Повышение 0★ -> 1★ (требуется 500 очков звёзд)
  // Курс: 300 купонов за 110 очков.
  // Для 500 очков купонов достаточно: 500 * (300 / 110) = 1363.6 -> 1364 купона
  const res1 = calculateStarStockDelta(0, 1, stock, 300);
  assert.strictEqual(res1.canAfford, true);
  assert.strictEqual(res1.points, 500);
  assert.strictEqual(res1.delta.legendaryStars3, 0);
  assert.strictEqual(res1.delta.legendaryStars1, 0);
  assert(res1.delta.starCoupons < 0, 'Купоны должны списаться');

  // Повышение 3★ -> 4★ (требуется 25 000 очков). На складе всего ~3 130 очков.
  const resOverflow = calculateStarStockDelta(3, 4, stock, 300);
  assert.strictEqual(resOverflow.canAfford, false);
  assert(resOverflow.deficitPoints > 0);

  // Понижение 4★ -> 3★ (возврат 25 000 очков)
  const resRefund = calculateStarStockDelta(4, 3, stock, 300);
  assert.strictEqual(resRefund.canAfford, true);
  assert.strictEqual(resRefund.points, -25000);
  assert(resRefund.delta.starCoupons > 0, 'Купоны должны вернуться на склад');
});

test('sortOfficersByGeneration sorts officers by descending catalog generation and tie-breakers', () => {
  const { sortOfficersByGeneration } = require('./logic.js');

  const catalog = [
    { id: 'cat-rex', name: 'Генерал Рекс', generation: 7 },
    { id: 'cat-liora', name: 'Лиора', generation: 7 },
    { id: 'cat-valk', name: 'Валькирия', generation: 9 },
    { id: 'cat-aurora', name: 'Аврора', generation: 8 },
    { id: 'cat-tank9', name: 'ТАНК9', generation: 9 },
  ];

  const officers = [
    { id: 'o-liora', catalogId: 'cat-liora', name: 'Лиора', stars: 6, level: 180 },
    { id: 'o-rex', catalogId: 'cat-rex', name: 'Генерал Рекс', stars: 5, level: 120 },
    { id: 'o-tank9', catalogId: 'cat-tank9', name: 'ТАНК9', stars: 0, level: 0 },
    { id: 'o-valk', catalogId: 'cat-valk', name: 'Валькирия', stars: 4, level: 60 },
    { id: 'o-aurora', catalogId: 'cat-aurora', name: 'Аврора', stars: 6, level: 180 },
  ];

  const sorted = sortOfficersByGeneration(officers, catalog);
  assert.strictEqual(sorted.length, 5);
  // Ген 9: Валькирия (4★), затем ТАНК9 (0★)
  assert.strictEqual(sorted[0].id, 'o-valk');
  assert.strictEqual(sorted[1].id, 'o-tank9');
  // Ген 8: Аврора
  assert.strictEqual(sorted[2].id, 'o-aurora');
  // Ген 7: Лиора (6★), затем Рекс (5★)
  assert.strictEqual(sorted[3].id, 'o-liora');
  assert.strictEqual(sorted[4].id, 'o-rex');
});

test('calculateStarStockDelta tracks invested resources and refunds exact stars and coupons (user scenario)', () => {
  const { calculateStarStockDelta, INVESTED_ZERO } = require('./logic.js');

  // Сценарий пользователя:
  // Было купонов звезды: 253 000 (по курсу 300 за 110 это ~92 766 очков)
  // Было звёзд III (960): 200 шт (192 000 очков)
  // Качаем офицера 0★ -> 6★ (требуется 98 000 очков звёзд)
  const stock = {
    starCoupons: 253000,
    legendaryStars1: 0,
    legendaryStars2: 0,
    legendaryStars3: 200,
  };

  const initialInvested = { ...INVESTED_ZERO };

  // 1. Повышение 0★ -> 6★:
  // Все 253 000 купонов звезды списываются (покрывают 92 766 очков).
  // Остаток очков 98 000 - 92 766 = 5 234 очка покрывается звёздами III.
  // 5234 / 960 = 5.45 -> списывается 6 звёзд III (или 5 звёзд III и остаток).
  const upgradeRes = calculateStarStockDelta(0, 6, stock, 300, initialInvested);
  assert.strictEqual(upgradeRes.canAfford, true);
  assert.strictEqual(upgradeRes.delta.starCoupons, -253000);
  assert.ok(upgradeRes.delta.legendaryStars3 < 0, 'Звёзды III должны списаться');
  assert.ok(upgradeRes.newInvested, 'Должен сформироваться newInvested');
  assert.strictEqual(upgradeRes.newInvested.starCoupons, 253000);
  assert.strictEqual(upgradeRes.newInvested.legendaryStars3, Math.abs(upgradeRes.delta.legendaryStars3));

  // 2. Понижение 6★ -> 0★ с учётом invested:
  // Должны вернуться ровно 253 000 купонов и ровно списанные звёзды III!
  const refundRes = calculateStarStockDelta(6, 0, stock, 300, upgradeRes.newInvested);
  assert.strictEqual(refundRes.canAfford, true);
  assert.strictEqual(refundRes.delta.starCoupons, 253000, 'Купоны звезды должны вернуться в исходном объеме');
  assert.strictEqual(refundRes.delta.legendaryStars3, upgradeRes.newInvested.legendaryStars3, 'Списанные звёзды III должны вернуться на склад!');
  assert.strictEqual(refundRes.delta.legendaryStars1, 0);
  assert.strictEqual(refundRes.delta.legendaryStars2, 0);
  assert.strictEqual(refundRes.newInvested.starCoupons, 0);
  assert.strictEqual(refundRes.newInvested.legendaryStars3, 0);

  // 3. Офицер вне трекера (invested = 0):
  // При понижении 6★ -> 0★ ресурсы на склад НЕ возвращаются (delta = 0)
  const untrackedRefund = calculateStarStockDelta(6, 0, stock, 300, INVESTED_ZERO);
  assert.strictEqual(untrackedRefund.canAfford, true);
  assert.strictEqual(untrackedRefund.delta.starCoupons, 0, 'Для офицера вне трекера купоны не начисляются');
  assert.strictEqual(untrackedRefund.delta.legendaryStars3, 0, 'Для офицера вне трекера звёзды не начисляются');
});

test('calculateSkillStockDelta and calculateLevelStockDelta track invested and do not refund untracked officers', () => {
  const { calculateSkillStockDelta, calculateLevelStockDelta, INVESTED_ZERO } = require('./logic.js');

  const stock = { coupons: 12000, puzzles: 50 };
  const initialInvested = { ...INVESTED_ZERO };

  // 1. Повышение навыков 1-1-1-1 -> 5-1-1-1 (50 медалей: 12 000 купонов + 30 медалей)
  const skillUp = calculateSkillStockDelta([1, 1, 1, 1], [5, 1, 1, 1], stock, 600, 'standard', 690, initialInvested);
  assert.strictEqual(skillUp.canAfford, true);
  assert.strictEqual(skillUp.delta.coupons, -12000);
  assert.strictEqual(skillUp.delta.puzzles, -30);
  assert.strictEqual(skillUp.newInvested.coupons, 12000);
  assert.strictEqual(skillUp.newInvested.puzzles, 30);

  // 2. Понижение навыков 5-1-1-1 -> 1-1-1-1 с invested:
  // Возвращаются ровно 12 000 купонов и 30 медалей
  const skillRefund = calculateSkillStockDelta([5, 1, 1, 1], [1, 1, 1, 1], stock, 600, 'standard', 690, skillUp.newInvested);
  assert.strictEqual(skillRefund.canAfford, true);
  assert.strictEqual(skillRefund.delta.coupons, 12000);
  assert.strictEqual(skillRefund.delta.puzzles, 30);
  assert.strictEqual(skillRefund.newInvested.coupons, 0);
  assert.strictEqual(skillRefund.newInvested.puzzles, 0);

  // 3. Офицер вне трекера: понижение 5-5-5-5 -> 1-1-1-1 без вложений даёт delta = 0
  const untrackedSkill = calculateSkillStockDelta([5, 5, 5, 5], [1, 1, 1, 1], stock, 600, 'standard', 690, INVESTED_ZERO);
  assert.strictEqual(untrackedSkill.delta.coupons, 0);
  assert.strictEqual(untrackedSkill.delta.puzzles, 0);

  // 4. Подготовка / уровни: 0 -> 10 ур. с invested
  const lvlUp = calculateLevelStockDelta(0, 10, stock, 600, 'standard', initialInvested);
  assert.strictEqual(lvlUp.newInvested.coupons, 12000);
  assert.strictEqual(lvlUp.newInvested.puzzles, 30);

  // 5. Понижение уровней 10 -> 0 с invested
  const lvlRefund = calculateLevelStockDelta(10, 0, stock, 600, 'standard', lvlUp.newInvested);
  assert.strictEqual(lvlRefund.delta.coupons, 12000);
  assert.strictEqual(lvlRefund.delta.puzzles, 30);

  // 6. Уровень вне трекера: 180 -> 0 ур. без вложений даёт delta = 0
  const untrackedLvl = calculateLevelStockDelta(180, 0, stock, 600, 'standard', INVESTED_ZERO);
  assert.strictEqual(untrackedLvl.delta.coupons, 0);
  assert.strictEqual(untrackedLvl.delta.puzzles, 0);
});









