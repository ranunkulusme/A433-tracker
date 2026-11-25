/**
 * Unit tests for EventOperations module.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const db = require('./db.js');
const logic = require('../shared/logic.js');
const { createEventOperations } = require('./event-ops.js');
const { createNotificationEngine } = require('./notification-engine.js');

const TEST_DB = path.join(__dirname, '..', 'data', `kow-event-ops-test-${Date.now()}.db`);

function cleanupDb() {
  try { if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB); } catch (_) {}
  try { if (fs.existsSync(TEST_DB + '-shm')) fs.unlinkSync(TEST_DB + '-shm'); } catch (_) {}
  try { if (fs.existsSync(TEST_DB + '-wal')) fs.unlinkSync(TEST_DB + '-wal'); } catch (_) {}
}

test.beforeEach(() => {
  cleanupDb();
  db.initDb(TEST_DB);
});

test.afterEach(() => {
  cleanupDb();
});

test('EventOperations: rsvpEvent confirms and declines attendance', async () => {
  const dispatched = [];
  const fakeDispatch = async (key, payload, opts) => {
    dispatched.push({ key, payload, opts });
    return true;
  };

  const eventOps = createEventOperations({
    db,
    logic,
    dispatchNotification: fakeDispatch
  });

  // Setup test user and player
  const uRes = db.registerUser({ username: 'fighter1', password: 'pass123' });
  const user = db.findUserById(uRes.userId);
  const player = db.createPlayer({
    userId: user.id,
    name: 'Sector 7G',
    stock: { coupons: 1000 }
  });

  // Setup event type & event
  const et = db.saveEventType({
    name: 'Битва за трон',
    color: '#8b5cf6',
    places: [
      { place: 1, coupons: 30000 },
      { place: 2, coupons: 20000 }
    ]
  });

  const ev = db.saveEvent({
    typeId: et.id,
    dateFrom: '2026-11-20',
    dateTo: '2026-11-22',
    assignments: [
      { place: 1, playerId: player.id, rsvpStatus: 'pending' }
    ]
  });

  // 1. Confirm RSVP
  const confRes = await eventOps.rsvpEvent({
    eventId: ev.id,
    place: 1,
    status: 'confirmed',
    user
  });

  assert.equal(confRes.ok, true);
  assert.equal(confRes.action, 'confirmed');

  const updatedEv = db.getEventById(ev.id);
  const a1 = updatedEv.assignments.find(a => a.place === 1);
  assert.equal(a1.rsvpStatus, 'confirmed');
  assert.ok(a1.rsvpAt);

  // 2. Decline RSVP
  const declRes = await eventOps.rsvpEvent({
    eventId: ev.id,
    place: 1,
    status: 'declined',
    user
  });

  assert.equal(declRes.ok, true);
  assert.equal(declRes.action, 'declined');

  const declinedEv = db.getEventById(ev.id);
  const a2 = declinedEv.assignments.find(a => a.place === 1);
  assert.equal(a2.rsvpStatus, 'declined');
});

test('EventOperations: rsvpEvent rejects unauthorized user', async () => {
  const eventOps = createEventOperations({ db, logic });

  const u1 = db.registerUser({ username: 'owner1', password: 'pass123' });
  const user1 = db.findUserById(u1.userId);
  const p1 = db.createPlayer({ userId: user1.id, name: 'Sector 1' });

  const u2 = db.registerUser({ username: 'intruder', password: 'pass123' });
  const user2 = db.findUserById(u2.userId);

  const et = db.saveEventType({ name: 'Кинг', places: [{ place: 1, coupons: 10000 }] });
  const ev = db.saveEvent({
    typeId: et.id,
    dateFrom: '2026-11-20',
    dateTo: '2026-11-22',
    assignments: [{ place: 1, playerId: p1.id, rsvpStatus: 'pending' }]
  });

  const res = await eventOps.rsvpEvent({
    eventId: ev.id,
    place: 1,
    status: 'confirmed',
    user: user2
  });

  assert.equal(res.ok, false);
  assert.equal(res.error, 'FORBIDDEN');
});

test('EventOperations: submitEventResult accurately accrues stock and creates audit record', async () => {
  const eventOps = createEventOperations({ db, logic });

  const uRes = db.registerUser({ username: 'hero', password: 'pass123' });
  const user = db.findUserById(uRes.userId);
  const player = db.createPlayer({
    userId: user.id,
    name: 'Sector Alpha',
    stock: { coupons: 5000, puzzleCoupons: 100 }
  });

  const et = db.saveEventType({
    name: 'Сила времени',
    places: [
      { place: 1, coupons: 25000 },
      { place: 2, coupons: 15000 }
    ]
  });

  const ev = db.saveEvent({
    typeId: et.id,
    dateFrom: '2026-11-01',
    dateTo: '2026-11-02',
    assignments: [
      { place: 1, playerId: player.id, rsvpStatus: 'confirmed' }
    ]
  });

  const res = await eventOps.submitEventResult({
    eventId: ev.id,
    place: 1,
    actualPlace: 1,
    user,
    submittedBy: 'unit_test'
  });

  assert.equal(res.ok, true);
  assert.equal(res.prizeCoupons, 25000);
  assert.equal(res.actualPlace, 1);

  // Check updated player stock
  const updatedPlayer = db.getPlayerById(player.id);
  assert.equal(updatedPlayer.stock.coupons, 30000); // 5000 + 25000

  // Check event assignment
  const updatedEv = db.getEventById(ev.id);
  const a = updatedEv.assignments[0];
  assert.equal(a.accrued, true);
  assert.equal(a.actualPlace, 1);
  assert.equal(a.actualCoupons, 25000);

  // Check stock history record
  const history = db.getStockHistoryByPlayerId(player.id);
  assert.ok(history.length > 0);
  const latest = history[history.length - 1];
  assert.equal(latest.source, 'event_reward');
  assert.equal(latest.snapshotBefore.coupons, 5000);
  assert.equal(latest.snapshotAfter.coupons, 30000);

  // Submitting again should be rejected with already_accrued
  const dupRes = await eventOps.submitEventResult({
    eventId: ev.id,
    place: 1,
    actualPlace: 1,
    user
  });

  assert.equal(dupRes.ok, false);
  assert.equal(dupRes.error, 'ALREADY_ACCRUED');
});

test('EventOperations: registerForEvent and unregisterFromEvent manage registration lifecycle', async () => {
  const dispatched = [];
  const fakeDispatch = async (key, data) => {
    dispatched.push({ key, data });
  };

  const eventOps = createEventOperations({
    db,
    logic,
    dispatchNotification: fakeDispatch
  });

  const uRes = db.registerUser({ username: 'applicant', password: 'pass123' });
  const user = db.findUserById(uRes.userId);
  const player = db.createPlayer({ userId: user.id, name: 'Applicant Sector' });

  const et = db.saveEventType({ name: 'Война королей', places: [{ place: 1, coupons: 20000 }] });
  const ev = db.saveEvent({ typeId: et.id, dateFrom: '2026-12-01', dateTo: '2026-12-03' });

  // 1. Register without officerId: should automatically select optimal unmaxed officer over maxed first officer
  const off1 = db.addPlayerOfficer(player.id, { catalogId: 'admiral-nathon', name: 'Нейтон', level: 180, stars: 5, skills: [5, 5, 5, 5] });
  const off2 = db.addPlayerOfficer(player.id, { catalogId: 'general-rex', name: 'Рекс', level: 100, stars: 3, skills: [3, 2, 1, 1] });

  const regRes = await eventOps.registerForEvent({
    eventId: ev.id,
    playerId: player.id,
    desiredPlace: 1,
    user
  });

  assert.equal(regRes.ok, true);
  const regs = db.getRegistrationsByEventId(ev.id);
  assert.equal(regs.length, 1);
  assert.equal(regs[0].playerId, player.id);
  assert.equal(regs[0].desiredPlace, 1);
  assert.equal(regs[0].officerId, 'general-rex', 'Auto-selection should skip maxed Nathon and pick unmaxed Rex');
  const regNotifs = dispatched.filter(d => d.key === 'staff_event_registration');
  assert.equal(regNotifs.length, 1);
  assert.equal(regNotifs[0].data.eventId, ev.id);
  assert.equal(regNotifs[0].data.playerId, player.id);
  assert.ok(regNotifs[0].data.link.includes(`#event/${ev.id}`), 'Link should point directly to event');

  // Calling registerForEvent again with unchanged place/officer should NOT dispatch duplicate notification
  const dupRes = await eventOps.registerForEvent({
    eventId: ev.id,
    playerId: player.id,
    desiredPlace: 1,
    officerId: 'general-rex',
    user
  });
  assert.equal(dupRes.ok, true);
  const regNotifsAfterDup = dispatched.filter(d => d.key === 'staff_event_registration');
  assert.equal(regNotifsAfterDup.length, 1, 'Should NOT dispatch duplicate notification for unchanged registration');

  // 1b. Attempt to register an officer with onlyPersonalPuzzles or special officer (Angel)
  const personalOff = db.addPlayerOfficer(player.id, { catalogId: 'angel', level: 100, onlyPersonalPuzzles: true });
  const rejRes = await eventOps.registerForEvent({
    eventId: ev.id,
    playerId: player.id,
    officerId: personalOff.id,
    desiredPlace: 1,
    user
  });
  assert.equal(rejRes.ok, false);
  assert.equal(rejRes.status, 400);
  assert.equal(rejRes.error, 'OFFICER_ONLY_PERSONAL_PUZZLES');

  // 2. Unregister
  const unregRes = await eventOps.unregisterFromEvent({
    eventId: ev.id,
    playerId: player.id,
    user
  });

  assert.equal(unregRes.ok, true);
  const regsAfter = db.getRegistrationsByEventId(ev.id);
  assert.equal(regsAfter.length, 0);
});

test('EventOperations: notifyAssignedPlayers sends RSVP markup to newly assigned players', async () => {
  const notifications = [];
  const fakeDispatch = async (key, data, opts) => {
    notifications.push({ key, data, opts });
  };

  const eventOps = createEventOperations({
    db,
    logic,
    dispatchNotification: fakeDispatch
  });

  const uRes = db.registerUser({ username: 'assigned_player', password: 'pass123' });
  const user = db.findUserById(uRes.userId);
  const player = db.createPlayer({ userId: user.id, name: 'Lucky Sector' });

  const et = db.saveEventType({ name: 'Тестовый ивент', places: [{ place: 1, coupons: 30000 }] });
  const ev = db.saveEvent({
    typeId: et.id,
    dateFrom: '2026-12-05',
    dateTo: '2026-12-07',
    assignments: [{ place: 1, playerId: player.id }]
  });

  await eventOps.notifyAssignedPlayers({
    event: ev,
    previousAssignments: []
  });

  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].key, 'event_place_assigned');
  assert.equal(notifications[0].data.username, 'assigned_player');
  assert.equal(notifications[0].data.place, '1');
  assert.ok(notifications[0].opts.replyMarkup.inline_keyboard[0][0].callback_data.includes('rsvp_event:confirm:'));

  // Re-notify with includeStaffSummary should dispatch staff_event_autopick_summary
  notifications.length = 0;
  await eventOps.notifyAssignedPlayers({
    event: ev,
    previousAssignments: [],
    includeStaffSummary: true,
    isNew: true
  });
  assert.ok(notifications.some(n => n.key === 'event_place_assigned'));
  assert.ok(notifications.some(n => n.key === 'staff_event_autopick_summary'));
});

test('EventOperations: rsvpEvent decline routes staff alert through notificationEngine & Mieru proxy', async () => {
  const sentMessages = [];
  const fakeTelegram = {
    sendTelegramMessage: async (payload, sendOpts = {}) => {
      sentMessages.push({ payload, sendOpts });
      return { ok: true, result: { message_id: 901 } };
    }
  };
  db.setAppSetting('telegram_bot_token', 'token_123');
  db.setAppSetting('telegram_staff_chat_id', '-100888777');
  db.saveMieruSettings({ enabled: true, socks5Port: 1099 });

  const notificationEngine = createNotificationEngine({
    db,
    logic,
    telegram: fakeTelegram,
    getAppBaseUrl: () => 'http://localhost:3000'
  });
  const eventOps = createEventOperations({
    db,
    logic,
    dispatchNotification: (...args) => notificationEngine.dispatchNotification(...args),
    notificationEngine,
    telegram: fakeTelegram
  });

  const uRes = db.registerUser({ username: 'decliner_u', password: 'pass123' });
  const user = db.findUserById(uRes.userId);
  const player = db.createPlayer({ userId: user.id, name: 'Decline Sector' });
  const et = db.saveEventType({ name: 'Король Войны', places: [{ place: 1, coupons: 12000 }] });
  const ev = db.saveEvent({
    typeId: et.id,
    dateFrom: '2026-12-01',
    dateTo: '2026-12-02',
    assignments: [{ place: 1, playerId: player.id }]
  });

  const res = await eventOps.rsvpEvent({ eventId: ev.id, place: 1, status: 'declined', user });
  assert.equal(res.ok, true);
  assert.equal(sentMessages.length, 1);
  assert.equal(sentMessages[0].payload.chatId, -100888777);
  assert.ok(sentMessages[0].payload.text.includes('Отказ от участия'));
  assert.equal(sentMessages[0].sendOpts.proxyUrl, 'socks5://127.0.0.1:1099');

  db.saveMieruSettings({ enabled: false });
});

test('EventOperations: submitEventResult records correction diffSummary when recalculating changed actualPlace', async () => {
  const eventOps = createEventOperations({ db, logic });

  const uRes = db.registerUser({ username: 'corr_hero', password: 'pass123' });
  const user = db.findUserById(uRes.userId);
  const player = db.createPlayer({ userId: user.id, name: 'Corr Sector', stock: { coupons: 5000 } });
  const et = db.saveEventType({
    name: 'Кинг',
    places: [
      { place: 1, coupons: 25000 },
      { place: 2, coupons: 10000 }
    ]
  });
  const ev = db.saveEvent({
    typeId: et.id,
    dateFrom: '2026-11-01',
    dateTo: '2026-11-02',
    assignments: [{ place: 1, playerId: player.id }]
  });

  const first = await eventOps.submitEventResult({ eventId: ev.id, place: 1, actualPlace: 1, user });
  assert.equal(first.ok, true);
  assert.equal(db.getPlayerById(player.id).stock.coupons, 30000);

  const corrected = await eventOps.submitEventResult({ eventId: ev.id, place: 1, actualPlace: 2, user });
  assert.equal(corrected.ok, true);
  assert.equal(db.getPlayerById(player.id).stock.coupons, 15000);

  const history = db.getStockHistoryByPlayerId(player.id);
  assert.equal(history.length, 2);
  const latest = history[0];
  assert.equal(latest.source, 'event_reward');
  assert.ok(latest.diffSummary.includes('Корректировка награды'), `Expected correction summary, got: ${latest.diffSummary}`);
});

test('EventOperations: scheduleSeason with rules generates alternating cadence and creates events', () => {
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

  const eventOps = createEventOperations({ db: mockDb, logic });
  const result = eventOps.scheduleSeason({
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
  const typeIds = savedEvents.map(e => e.typeId);
  assert.ok(typeIds.includes(1));
  assert.ok(typeIds.includes(2));
});

test('EventOperations: scheduleSeason with ready-made events array saves batch', () => {
  const savedEvents = [];
  const mockDb = {
    getEventTypes: () => [{ id: 10, name: 'Custom Event', color: '#123456' }],
    saveEvent: (ev) => {
      const saved = { id: savedEvents.length + 1, ...ev };
      savedEvents.push(saved);
      return saved;
    }
  };

  const eventOps = createEventOperations({ db: mockDb, logic });
  const result = eventOps.scheduleSeason({
    events: [
      { typeId: 10, dateFrom: '2026-11-20', dateTo: '2026-11-22', note: 'Batch 1' },
      { typeId: 10, dateFrom: '2026-11-27', dateTo: '2026-11-29', note: 'Batch 2' }
    ]
  });

  assert.equal(result.success, true);
  assert.equal(result.count, 2);
  assert.equal(savedEvents[0].note, 'Batch 1');
  assert.equal(savedEvents[1].note, 'Batch 2');
});

test('EventOperations: runSmartAutopick calculates optimal assignments and handles missing event', () => {
  const mockEvent = { id: 42, typeId: 1, dateFrom: '2026-11-20', dateTo: '2026-11-22' };
  const mockEventType = {
    id: 1,
    name: 'Король Войны',
    places: [{ place: 1, coupons: 12500 }, { place: 2, coupons: 6500 }]
  };
  const mockPlayers = [
    { id: 10, name: 'Alpha', stock: { coupons: 100 }, officers: [{ id: 'off_1', target: { stars: 5 }, skills: [5, 5, 5, 5], catalogId: 'c1' }] },
    { id: 20, name: 'Beta', stock: { coupons: 200 }, officers: [{ id: 'off_2', target: { stars: 5 }, skills: [3, 3, 3, 3], catalogId: 'c2' }] }
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

  const eventOps = createEventOperations({ db: mockDb, logic });
  const result = eventOps.runSmartAutopick(42);
  assert.equal(result.success, true);
  assert.ok(result.assignments.length > 0);
  assert.ok(Array.isArray(result.unassignedCandidates));

  const missing = eventOps.runSmartAutopick(999);
  assert.equal(missing.success, false);
  assert.equal(missing.error, 'EVENT_NOT_FOUND');
});

test('EventOperations: finishEvent, summarizeEvent and shareEventGrid orchestrate end-of-event notifications', async () => {
  const sentDispatches = [];
  const sentPhotos = [];
  const fakeTelegram = {
    sendTelegramPhoto: async (payload, sendOpts = {}) => {
      sentPhotos.push({ payload, sendOpts });
      return { ok: true, result: { message_id: 950 } };
    }
  };
  db.setAppSetting('telegram_bot_token', 'tok_finish');
  db.setAppSetting('telegram_staff_chat_id', '-100444555');

  const notificationEngine = createNotificationEngine({
    db,
    logic,
    telegram: fakeTelegram,
    getAppBaseUrl: () => 'https://kow.example.com'
  });

  const eventOps = createEventOperations({
    db,
    logic,
    dispatchNotification: async (key, data, opts) => {
      sentDispatches.push({ key, data, opts });
      return { sent: true };
    },
    notificationEngine,
    getAppBaseUrl: () => 'https://kow.example.com'
  });

  const uRes = db.registerUser({ username: 'fin_hero', password: 'password123' });
  db.bindUserTelegram(uRes.userId, 112233, 'fin_hero');
  const p = db.createPlayer({ userId: uRes.userId, name: 'Finish Sector' });
  const et = db.saveEventType({ name: 'Битва за трон', places: [{ place: 1, coupons: 15000 }] });
  const ev = db.saveEvent({
    typeId: et.id,
    dateFrom: '2026-12-10',
    dateTo: '2026-12-12',
    assignments: [{ place: 1, playerId: p.id, actualCoupons: 15000, resultStatus: 'pending' }]
  });

  const finRes = await eventOps.finishEvent({ eventId: ev.id });
  assert.equal(finRes.ok, true);
  assert.equal(finRes.sentCount, 1);
  assert.equal(sentDispatches[0].key, 'event_result_prompt');

  const sumRes = await eventOps.summarizeEvent({ eventId: ev.id });
  assert.equal(sumRes.ok, true);
  assert.equal(sumRes.totalAssigned, 1);
  assert.equal(sentDispatches[1].key, 'staff_event_completed_summary');

  const shareRes = await eventOps.shareEventGrid({
    eventId: ev.id,
    target: 'staff',
    imageBase64: 'data:image/png;base64,AAA'
  });
  assert.equal(shareRes.ok, true);
  assert.equal(sentPhotos.length, 1);
  assert.equal(sentPhotos[0].payload.chatId, -100444555);
});

