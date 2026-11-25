/**
 * Unit tests for TelegramBotController module.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const db = require('./db.js');
const logic = require('../shared/logic.js');
const { createEventOperations } = require('./event-ops.js');
const { createTelegramBotController } = require('./bot-controller.js');

const TEST_DB = path.join(__dirname, '..', 'data', `kow-bot-ctrl-test-${Date.now()}.db`);

function cleanupDb() {
  try { if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB); } catch (_) {}
  try { if (fs.existsSync(TEST_DB + '-shm')) fs.unlinkSync(TEST_DB + '-shm'); } catch (_) {}
  try { if (fs.existsSync(TEST_DB + '-wal')) fs.unlinkSync(TEST_DB + '-wal'); } catch (_) {}
}

test.beforeEach(() => {
  cleanupDb();
  db.initDb(TEST_DB);
  db.setAppSetting('telegram_bot_token', 'TEST_BOT_TOKEN');
});

test.afterEach(() => {
  cleanupDb();
});

test('TelegramBotController: rejects invalid update', async () => {
  const botCtrl = createTelegramBotController({ db, logic });
  const res = await botCtrl.handleUpdate(null);
  assert.equal(res.ok, false);
  assert.equal(res.error, 'INVALID_UPDATE');
});

test('TelegramBotController: binds user via /start bind_<token>', async () => {
  const sentMessages = [];
  const fakeTelegram = {
    sendTelegramMessage: async (payload) => {
      sentMessages.push(payload);
      return { ok: true };
    }
  };

  const botCtrl = createTelegramBotController({
    db,
    logic,
    telegram: fakeTelegram
  });

  const uRes = db.registerUser({ username: 'tg_user', password: 'password123' });
  const token = 'test_bind_token_123';
  db.createTelegramBindToken(uRes.userId, token, new Date(Date.now() + 60000).toISOString());

  const update = {
    update_id: 1001,
    message: {
      message_id: 1,
      chat: { id: 998877, type: 'private' },
      from: { id: 998877, username: 'tg_user' },
      text: `/start bind_${token}`
    }
  };

  const res = await botCtrl.handleUpdate(update);
  assert.equal(res.ok, true);
  assert.equal(res.bound, true);
  assert.equal(res.userId, uRes.userId);

  // Check user is bound in db
  const boundUser = db.findUserByTelegramChatId(998877);
  assert.ok(boundUser);
  assert.equal(boundUser.id, uRes.userId);

  // Check confirmation message sent
  assert.equal(sentMessages.length, 1);
  assert.equal(sentMessages[0].chatId, 998877);
  assert.ok(sentMessages[0].text.includes('успешно подключен'));
});

test('TelegramBotController: handles /stock command and updates player warehouse', async () => {
  const sentMessages = [];
  const fakeTelegram = {
    sendTelegramMessage: async (payload) => {
      sentMessages.push(payload);
      return { ok: true };
    }
  };

  const botCtrl = createTelegramBotController({
    db,
    logic,
    telegram: fakeTelegram
  });

  const uRes = db.registerUser({ username: 'stock_boss', password: 'password123' });
  const player = db.createPlayer({
    userId: uRes.userId,
    name: 'Sector 55',
    stock: { coupons: 1000 }
  });
  db.bindUserTelegram(uRes.userId, 777111, 'stock_boss');

  const update = {
    update_id: 1002,
    message: {
      message_id: 2,
      chat: { id: 777111, type: 'private' },
      from: { id: 777111, username: 'stock_boss' },
      text: '/stock 15000 500 200 10 5 2'
    }
  };

  const res = await botCtrl.handleUpdate(update);
  assert.equal(res.ok, true);
  assert.equal(res.updated, true);

  const updatedPlayer = db.getPlayerById(player.id);
  assert.equal(updatedPlayer.stock.coupons, 15000);
  assert.equal(updatedPlayer.stock.puzzles, 500);

  assert.equal(sentMessages.length, 1);
  assert.ok(sentMessages[0].text.includes('Склад успешно обновлен'));
});

test('TelegramBotController: routes RSVP callback query via eventOps', async () => {
  const answeredCallbacks = [];
  const editedMessages = [];

  const fakeTelegram = {
    answerTelegramCallback: async (payload) => {
      answeredCallbacks.push(payload);
      return { ok: true };
    },
    editTelegramMessageText: async (payload) => {
      editedMessages.push(payload);
      return { ok: true };
    }
  };

  const eventOps = createEventOperations({ db, logic, telegram: fakeTelegram });
  const dispatchedBotNotifs = [];
  const botCtrl = createTelegramBotController({
    db,
    logic,
    telegram: fakeTelegram,
    eventOps,
    dispatchNotification: async (k, d) => dispatchedBotNotifs.push({ k, d })
  });

  const uRes = db.registerUser({ username: 'rsvp_hero', password: 'password123' });
  const player = db.createPlayer({
    userId: uRes.userId,
    name: 'Sector RSVP'
  });
  db.bindUserTelegram(uRes.userId, 444333, 'rsvp_hero');

  const et = db.saveEventType({ name: 'Кинг', places: [{ place: 1, coupons: 10000 }] });
  const ev = db.saveEvent({
    typeId: et.id,
    dateFrom: '2026-12-10',
    dateTo: '2026-12-12',
    assignments: [{ place: 1, playerId: player.id, rsvpStatus: 'pending' }]
  });

  const update = {
    update_id: 1003,
    callback_query: {
      id: 'cq_999',
      from: { id: 444333, username: 'rsvp_hero' },
      message: { chat: { id: 444333 }, message_id: 55, text: 'Вам назначено место #1' },
      data: `rsvp_event:confirm:${ev.id}:1`
    }
  };

  const res = await botCtrl.handleUpdate(update);
  assert.equal(res.ok, true);
  assert.equal(res.action, 'confirmed');

  const updatedEv = db.getEventById(ev.id);
  assert.equal(updatedEv.assignments[0].rsvpStatus, 'confirmed');

  assert.equal(answeredCallbacks.length, 1);
  assert.equal(editedMessages.length, 1);
  assert.ok(editedMessages[0].text.includes('Участие подтверждено'));
});

test('TelegramBotController: routes event registration and unregistration callbacks via eventOps', async () => {
  const answeredCallbacks = [];
  const fakeTelegram = {
    answerTelegramCallback: async (payload) => {
      answeredCallbacks.push(payload);
      return { ok: true };
    },
    editTelegramMessageText: async () => ({ ok: true }),
    sendTelegramMessage: async () => ({ ok: true })
  };

  const eventOps = createEventOperations({ db, logic, telegram: fakeTelegram });
  const dispatchedBotNotifs = [];
  const botCtrl = createTelegramBotController({
    db,
    logic,
    telegram: fakeTelegram,
    eventOps,
    dispatchNotification: async (k, d) => dispatchedBotNotifs.push({ k, d })
  });

  const uRes = db.registerUser({ username: 'reg_hero', password: 'password123' });
  const player = db.createPlayer({
    userId: uRes.userId,
    name: 'Sector Reg',
    officers: [
      { id: 'off_1', name: 'Белла', catalogId: 'admiral-nathon', level: 180, skills: [5, 5, 5, 5], stars: 5 },
      { id: 'off_2', name: 'Рекс', catalogId: 'general-rex', level: 100, skills: [2, 2, 2, 2], stars: 2 }
    ]
  });
  db.bindUserTelegram(uRes.userId, 555666, 'reg_hero');

  const et = db.saveEventType({ name: 'Война', places: [{ place: 1, coupons: 5000 }] });
  const ev = db.saveEvent({
    typeId: et.id,
    dateFrom: '2026-12-15',
    dateTo: '2026-12-17'
  });

  // Register
  const regUpdate = {
    update_id: 1004,
    callback_query: {
      id: 'cq_reg_1',
      from: { id: 555666, username: 'reg_hero' },
      message: { chat: { id: 555666 }, message_id: 60, text: 'Регистрация' },
      data: `reg_event:${ev.id}:1`
    }
  };

  const regRes = await botCtrl.handleUpdate(regUpdate);
  assert.equal(regRes.ok, true);
  assert.equal(regRes.action, 'registered');

  let regs = db.getRegistrationsByEventId(ev.id);
  assert.equal(regs.length, 1);
  assert.equal(regs[0].playerId, player.id);
  assert.equal(regs[0].officerId, 'general-rex');
  assert.equal(dispatchedBotNotifs.length, 0, 'Bot controller should not call dispatchNotification a second time when eventOps handles registration');

  // Unregister
  const unregUpdate = {
    update_id: 1005,
    callback_query: {
      id: 'cq_unreg_1',
      from: { id: 555666, username: 'reg_hero' },
      message: { chat: { id: 555666 }, message_id: 60, text: 'Регистрация' },
      data: `unreg_event:${ev.id}`
    }
  };

  const unregRes = await botCtrl.handleUpdate(unregUpdate);
  assert.equal(unregRes.ok, true);
  assert.equal(unregRes.action, 'unregistered');

  regs = db.getRegistrationsByEventId(ev.id);
  assert.equal(regs.length, 0);
});

test('TelegramBotController: routes event result submission via eventOps and awards coupons', async () => {
  const answeredCallbacks = [];
  const fakeTelegram = {
    answerTelegramCallback: async (payload) => {
      answeredCallbacks.push(payload);
      return { ok: true };
    },
    editTelegramMessageText: async () => ({ ok: true }),
    sendTelegramMessage: async () => ({ ok: true })
  };

  const eventOps = createEventOperations({ db, logic, telegram: fakeTelegram });
  const dispatchedBotNotifs = [];
  const botCtrl = createTelegramBotController({
    db,
    logic,
    telegram: fakeTelegram,
    eventOps,
    dispatchNotification: async (k, d) => dispatchedBotNotifs.push({ k, d })
  });

  const uRes = db.registerUser({ username: 'result_hero', password: 'password123' });
  const player = db.createPlayer({
    userId: uRes.userId,
    name: 'Sector Winner',
    stock: { coupons: 1000 }
  });
  db.bindUserTelegram(uRes.userId, 777888, 'result_hero');

  const et = db.saveEventType({ name: 'Финал', places: [{ place: 1, coupons: 25000 }] });
  const ev = db.saveEvent({
    typeId: et.id,
    dateFrom: '2026-12-20',
    dateTo: '2026-12-22',
    assignments: [{ place: 1, playerId: player.id, rsvpStatus: 'confirmed' }]
  });

  const resultUpdate = {
    update_id: 1006,
    callback_query: {
      id: 'cq_res_1',
      from: { id: 777888, username: 'result_hero' },
      message: { chat: { id: 777888 }, message_id: 70, text: 'Подтвердите результат' },
      data: `event_result:submit:${ev.id}:1`
    }
  };

  const res = await botCtrl.handleUpdate(resultUpdate);
  assert.equal(res.ok, true);
  assert.equal(res.action, 'result_submitted');
  assert.equal(res.prizeCoupons, 25000);

  const updatedEv = db.getEventById(ev.id);
  assert.equal(updatedEv.assignments[0].actualPlace, 1);
  assert.equal(updatedEv.assignments[0].accrued, true);

  const updatedPlayer = db.getPlayerById(player.id);
  assert.equal(updatedPlayer.stock.coupons, 26000);
});

test('TelegramBotController: photo OCR via ocrAdapter recognizes chest-only & star-II stock without losing chests', async () => {
  const { createOcrAdapter } = require('./ocr-adapter.js');
  const sentMessages = [];
  const fakeTelegram = {
    getTelegramFile: async () => ({ ok: true, result: { file_path: 'photos/chests.png' } }),
    downloadTelegramFile: async () => Buffer.from('FAKE_PNG'),
    sendTelegramMessage: async (payload) => { sentMessages.push(payload); return { ok: true }; }
  };
  const ocrAdapter = createOcrAdapter({
    customRunner: async () => ({
      leftText: 'Сундук медалей\nлегендарного\nофицера\nВ наличии: 9',
      rightText: 'Легендарная звезда II\n420\nВ наличии: 44'
    })
  });
  const botCtrl = createTelegramBotController({
    db,
    logic,
    telegram: fakeTelegram,
    ocrAdapter
  });

  const uRes = db.registerUser({ username: 'chest_ocr_user', password: 'password123' });
  db.createPlayer({
    userId: uRes.userId,
    name: 'Sector Chest OCR',
    stock: { coupons: 1000, chests: 1, legendaryStars2: 10 }
  });
  db.bindUserTelegram(uRes.userId, 888999, 'chest_ocr_user');
  db.setAppSetting('telegram_bot_token', 'fake_token');

  const res = await botCtrl.handleUpdate({
    update_id: 2001,
    message: {
      chat: { id: 888999, type: 'private' },
      from: { id: 888999, username: 'chest_ocr_user' },
      photo: [{ file_id: 'f_chest_1' }]
    }
  });

  assert.equal(res.ok, true);
  assert.equal(res.ocr, true);
  assert.equal(res.recognizedStock.chests, 9);
  assert.equal(res.recognizedStock.legendaryStars2, 44);
  assert.ok(sentMessages.some(m => m.text.includes('Сундуки медалей') && m.text.includes('9')));
});
