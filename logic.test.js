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
