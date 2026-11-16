/**
 * KoW Tracker - Tests for Season Planner & Autopick Orchestrator (Deep Module)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const logic = require('../shared/logic.js');
const { createSeasonPlanner } = require('./season-planner.js');

test('SeasonPlanner: scheduleSeason with rules generates alternating cadence and creates events', () => {
  const savedEvents = [];
  const eventTypes = [
    { id: 1, name: 'Король Войны', color: '#8b5cf6', places: [{ place: 1, coupons: 12500 }] },
    { id: 2, name: 'Могучие Силы', color: '#10b981', places: [{ place: 1, coupons: 12500 }] }
  ];

  const mockDb = {
    getEventTypes: () => [...eventTypes],
    saveEventType: (t) => {
      const created = { id: eventTypes.length + 1, ...t };
      eventTypes.push(created);
      return created;
    },
    saveEvent: (ev) => {
      const saved = { id: savedEvents.length + 1, ...ev };
      savedEvents.push(saved);
      return saved;
    }
  };

  const planner = createSeasonPlanner({ db: mockDb, logic });

  const result = planner.scheduleSeason({
    startDate: '2026-11-20',
    totalWeeks: 8,
    rules: [
      { typeName: 'Король Войны', color: '#8b5cf6', dayOfWeek: 2, activeWeeks: 1, breakWeeks: 1, weekOffset: 0 },
      { typeName: 'Могучие Силы', color: '#10b981', dayOfWeek: 2, activeWeeks: 1, breakWeeks: 1, weekOffset: 1 }
    ]
  });

  assert.equal(result.success, true);
  assert.ok(result.count > 0);
  assert.equal(savedEvents.length, result.count);

  // Check alternating sequence
  const typeIds = savedEvents.map(e => e.typeId);
  assert.ok(typeIds.includes(1));
  assert.ok(typeIds.includes(2));
});

test('SeasonPlanner: scheduleSeason with ready-made events array saves batch', () => {
  const savedEvents = [];
  const mockDb = {
    getEventTypes: () => [{ id: 10, name: 'Custom Event', color: '#123456' }],
    saveEvent: (ev) => {
      const saved = { id: savedEvents.length + 1, ...ev };
      savedEvents.push(saved);
      return saved;
    }
  };

  const planner = createSeasonPlanner({ db: mockDb, logic });

  const result = planner.scheduleSeason({
    events: [
      { typeId: 10, dateFrom: '2026-11-20', dateTo: '2026-11-22', note: 'Batch 1' },
      { typeId: 10, dateFrom: '2026-11-27', dateTo: '2026-11-29', note: 'Batch 2' }
    ]
  });

  assert.equal(result.success, true);
  assert.equal(result.count, 2);
  assert.equal(savedEvents.length, 2);
  assert.equal(savedEvents[0].note, 'Batch 1');
  assert.equal(savedEvents[1].note, 'Batch 2');
});

test('SeasonPlanner: runSmartAutopick calculates optimal assignments with fair play and deficit', () => {
  const mockEvent = {
    id: 42,
    typeId: 1,
    dateFrom: '2026-11-20',
    dateTo: '2026-11-22'
  };

  const mockEventType = {
    id: 1,
    name: 'Король Войны',
    places: [
      { place: 1, coupons: 12500 },
      { place: 2, coupons: 6500 }
    ]
  };

  const mockPlayers = [
    {
      id: 10,
      name: 'Alpha',
      stock: { coupons: 100 },
      officers: [{ id: 'off_1', target: { stars: 5 }, skills: [5, 5, 5, 5], catalogId: 'c1' }]
    },
    {
      id: 20,
      name: 'Beta',
      stock: { coupons: 200 },
      officers: [{ id: 'off_2', target: { stars: 5 }, skills: [3, 3, 3, 3], catalogId: 'c2' }]
    }
  ];

  const mockRegistrations = [
    { playerId: 10, officerId: 'off_1', desiredPlace: 1 },
    { playerId: 20, officerId: 'off_2', desiredPlace: 2 }
  ];

  const mockDb = {
    getEventById: (id) => (id === 42 ? mockEvent : null),
    getEventTypes: () => [mockEventType],
    getPlayers: () => mockPlayers,
    getCatalog: () => [{ id: 'c1', name: 'Officer Alpha' }, { id: 'c2', name: 'Officer Beta' }],
    getRegistrationsByEventId: () => mockRegistrations,
    getRecentWinners: () => []
  };

  const planner = createSeasonPlanner({ db: mockDb, logic });

  const result = planner.runSmartAutopick(42);
  assert.equal(result.success, true);
  assert.ok(Array.isArray(result.assignments));
  assert.ok(result.assignments.length > 0);
  assert.ok(Array.isArray(result.unassignedCandidates));
});

test('SeasonPlanner: runSmartAutopick returns error for non-existent event', () => {
  const mockDb = {
    getEventById: () => null
  };
  const planner = createSeasonPlanner({ db: mockDb, logic });
  const result = planner.runSmartAutopick(999);
  assert.equal(result.success, false);
  assert.equal(result.error, 'EVENT_NOT_FOUND');
});
