/**
 * Unit tests for EventOperations module.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const db = require('./db.js');
const logic = require('./logic.js');
const { createEventOperations } = require('./event-ops.js');

const TEST_DB = path.join(__dirname, 'data', `kow-event-ops-test-${Date.now()}.db`);

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

  // 1. Register
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
  assert.ok(dispatched.some(d => d.key === 'staff_event_registration'));

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
});

