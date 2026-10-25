const assert = require('node:assert/strict');
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
  calculateSkillMedalsProgress,
  OFFICER_PAIRINGS,
  getRecommendedPairings,
  EVENT_PRESETS,
  generateSeasonSchedule,
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
  assert.deepEqual(migrated.players[0].stock, { coupons: 0, puzzles: 0, chests: 0 });
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
  assert.equal(starCostFor(5), 65000);
  assert.equal(starCostFor(6), 98000);
});

test('exports full list of 5 officer types', () => {
  assert.deepEqual(OFFICER_TYPES, ['Танк', 'ПТ', 'Пехота', 'Гарнизон', 'Осада']);
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

  // Тест VIP дефицита
  const vipRes = calculateVipDeficit({ currentLevel: 10, currentPoints: 350000, targetLevel: 12 });
  assert.strictEqual(vipRes.pointsNeeded, 400000);
  assert.strictEqual(vipRes.dailyPuzzlesIncrease, 2);

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

  // Промежуточная прокачка навыка 1 до 5
  const skillsPartial = calculateSkillMedalsProgress([5, 1, 1, 1]);
  assert.strictEqual(skillsPartial.spentMedals, 100);
  assert.strictEqual(skillsPartial.remainingMedals, 590);

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



