const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const testDbPath = path.join(__dirname, '..', 'data', 'test-notifications.db');
if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);

process.env.DB_PATH = testDbPath;
const db = require('./db.js');
db.initDb();

const logic = require('../shared/logic.js');
const { createNotificationEngine } = require('./notification-engine.js');

test('NotificationEngine: dispatchNotification renders template and sends to personal chat', async () => {
  const sentMessages = [];
  const fakeTelegram = {
    sendTelegramMessage: async (payload) => {
      sentMessages.push(payload);
      return { ok: true };
    }
  };

  db.setAppSetting('telegram_bot_token', 'fake_token_123');

  const engine = createNotificationEngine({
    db,
    logic,
    telegram: fakeTelegram,
    getAppBaseUrl: () => 'http://localhost:3000'
  });

  const uRes = db.registerUser({ username: 'notif_hero', password: 'password123' });
  db.bindUserTelegram(uRes.userId, 777666, 'notif_hero');

  const res = await engine.dispatchNotification('stock_reminder_personal', {
    username: 'notif_hero',
    sectorName: 'Альфа 1',
    daysOverdue: '5',
    link: 'http://localhost:3000/#cabinet'
  }, { userId: uRes.userId });

  assert.equal(res.sent, true);
  assert.equal(sentMessages.length, 1);
  assert.equal(sentMessages[0].chatId, 777666);
  assert.ok(sentMessages[0].text.includes('Альфа 1'));
  assert.ok(sentMessages[0].text.includes('5'));
});

test('NotificationEngine: dispatchNotification routes to staff chat and respects smart silence', async () => {
  const sentMessages = [];
  const fakeTelegram = {
    sendTelegramMessage: async (payload) => {
      sentMessages.push(payload);
      return { ok: true };
    }
  };

  db.setAppSetting('telegram_bot_token', 'fake_token_123');
  db.setAppSetting('telegram_staff_chat_id', '-100123456789');

  const engine = createNotificationEngine({
    db,
    logic,
    telegram: fakeTelegram,
    getAppBaseUrl: () => 'http://localhost:3000'
  });

  // Force stale check with 0 stale sectors -> staff alert is sent if force=true
  const res = await engine.checkStaleStockReminders(null, { force: true });
  assert.equal(res.staffAlertSent, true);
  assert.equal(sentMessages.length, 1);
  assert.equal(sentMessages[0].chatId, -100123456789);

  // Scheduled check with smartSilence -> skipped
  db.updateStaleAlertSchedule({ frequency: 'daily', time: '12:00', smartSilence: true });
  sentMessages.length = 0;
  const silentRes = await engine.checkStaleStockReminders(null, { isScheduled: true, force: false });
  assert.equal(silentRes.silent, true);
  assert.equal(silentRes.staffAlertSent, false);
  assert.equal(sentMessages.length, 0);
});

test('NotificationEngine: checkScheduledEventMorningReminders sends morning briefings', async () => {
  const sentMessages = [];
  const fakeTelegram = {
    sendTelegramMessage: async (payload) => {
      sentMessages.push(payload);
      return { ok: true };
    }
  };

  db.setAppSetting('telegram_bot_token', 'fake_token_123');

  const engine = createNotificationEngine({
    db,
    logic,
    telegram: fakeTelegram,
    getAppBaseUrl: () => 'http://localhost:3000'
  });

  const uRes = db.registerUser({ username: 'morning_fighter', password: 'password123' });
  db.bindUserTelegram(uRes.userId, 888999, 'morning_fighter');
  const player = db.createPlayer({
    userId: uRes.userId,
    name: 'Sector Sunrise'
  });

  const et = db.saveEventType({ name: 'Война за ресурсы', places: [{ place: 1, coupons: 5000 }] });
  const ev = db.saveEvent({
    typeId: et.id,
    dateFrom: '2026-11-15T09:00:00.000Z',
    dateTo: '2026-11-17T09:00:00.000Z',
    assignments: [{ place: 1, playerId: player.id }]
  });

  const res = await engine.checkScheduledEventMorningReminders(null, {
    force: true,
    now: new Date('2026-11-15T06:00:00.000Z') // 09:00 in UTC+3
  });

  assert.ok(res.remindersSent >= 1);
  assert.equal(sentMessages.length, 1);
  assert.equal(sentMessages[0].chatId, 888999);
  assert.ok(sentMessages[0].text.includes('Война за ресурсы'));
});

test('NotificationEngine: hides shallow DB pass-throughs and routes direct, photo and template tests via Mieru proxy', async () => {
  const sentMessages = [];
  const sentPhotos = [];
  const fakeTelegram = {
    sendTelegramMessage: async (payload, sendOpts = {}) => {
      sentMessages.push({ payload, sendOpts });
      return { ok: true, result: { message_id: 700 + sentMessages.length } };
    },
    sendTelegramPhoto: async (payload, sendOpts = {}) => {
      sentPhotos.push({ payload, sendOpts });
      return { ok: true, result: { message_id: 800 + sentPhotos.length } };
    }
  };

  db.setAppSetting('telegram_bot_token', 'fake_token_123');
  db.setAppSetting('telegram_staff_chat_id', '-100333222');
  db.setAppSetting('telegram_announcement_chat_id', '-100555444');
  db.saveMieruSettings({ enabled: true, socks5Port: 1088 });

  const engine = createNotificationEngine({
    db,
    logic,
    telegram: fakeTelegram,
    getAppBaseUrl: () => 'https://kow.example.com'
  });

  // Shallow DB CRUD wrappers must be absent ("replace, don't layer")
  assert.equal(engine.getTemplates, undefined);
  assert.equal(engine.getTemplate, undefined);
  assert.equal(engine.saveTemplate, undefined);
  assert.equal(engine.resetTemplate, undefined);
  assert.equal(engine.testTemplate, undefined);

  // 1. sendDirectMessage routes through Mieru SOCKS5 proxy
  const directRes = await engine.sendDirectMessage({
    channel: 'staff',
    text: '<b>Alert</b>'
  });
  assert.equal(directRes.sent, true);
  assert.equal(sentMessages.length, 1);
  assert.equal(sentMessages[0].payload.chatId, -100333222);
  assert.equal(sentMessages[0].sendOpts.proxyUrl, 'socks5://127.0.0.1:1088');

  // 2. sendChannelPhoto handles staff / channel / both with Mieru proxy
  const badPhoto = await engine.sendChannelPhoto({ target: 'staff', photo: '' });
  assert.equal(badPhoto.ok, false);
  assert.equal(badPhoto.status, 400);

  const photoRes = await engine.sendChannelPhoto({
    target: 'both',
    photo: 'data:image/png;base64,AAA',
    caption: 'Test Grid'
  });
  assert.equal(photoRes.ok, true);
  assert.equal(photoRes.sentCount, 2);
  assert.equal(sentPhotos.length, 2);
  assert.equal(sentPhotos[0].sendOpts.proxyUrl, 'socks5://127.0.0.1:1088');
  assert.equal(sentPhotos[1].sendOpts.proxyUrl, 'socks5://127.0.0.1:1088');

  // 3. sendTemplateTest sends personal / staff tests via Mieru proxy
  const uRes = db.registerUser({ username: 'tpl_tester', password: 'password123' });
  const unlinkedUser = db.findUserById(uRes.userId);
  const noTgRes = await engine.sendTemplateTest({
    key: 'event_place_assigned',
    user: unlinkedUser
  });
  assert.equal(noTgRes.ok, false);
  assert.equal(noTgRes.status, 400);
  assert.equal(noTgRes.error, 'NO_TELEGRAM_LINKED');

  db.bindUserTelegram(uRes.userId, 555777, 'tpl_tester');
  const linkedUser = db.findUserById(uRes.userId);
  const personalTest = await engine.sendTemplateTest({
    key: 'event_place_assigned',
    user: linkedUser,
    template: 'Custom #{place} -> {sectorName}'
  });
  assert.equal(personalTest.ok, true);
  assert.equal(sentMessages[sentMessages.length - 1].payload.chatId, 555777);
  assert.ok(sentMessages[sentMessages.length - 1].payload.text.includes('Custom #1'));
  assert.equal(sentMessages[sentMessages.length - 1].sendOpts.proxyUrl, 'socks5://127.0.0.1:1088');

  db.saveMieruSettings({ enabled: false });
});

test('NotificationEngine: dispatchNotification routes to announcement channel and handles missing channel', async () => {
  const sentMessages = [];
  const fakeTelegram = {
    sendTelegramMessage: async (payload) => {
      sentMessages.push(payload);
      return { ok: true };
    }
  };

  db.setAppSetting('telegram_bot_token', 'fake_token_123');
  db.setAppSetting('telegram_announcement_chat_id', '');

  const engine = createNotificationEngine({
    db,
    logic,
    telegram: fakeTelegram,
    getAppBaseUrl: () => 'http://localhost:3000'
  });

  // Save template configured for announcement channel
  db.updateNotificationTemplate('event_registration_opened', {
    channel: 'announcement'
  });

  // 1. Without announcement chat ID -> fails with no_announcement_chat_id
  const failRes = await engine.dispatchNotification('event_registration_opened', {
    eventName: 'Битва за Ресурсы',
    eventDate: '2026-11-20',
    totalPlaces: '15',
    link: 'http://localhost:3000/#events'
  });
  assert.equal(failRes.sent, false);
  assert.equal(failRes.reason, 'no_announcement_chat_id');
  assert.equal(sentMessages.length, 0);

  // 2. Set announcement chat ID -> successfully sent to announcement channel
  db.setAppSetting('telegram_announcement_chat_id', '-100777888999');

  const successRes = await engine.dispatchNotification('event_registration_opened', {
    eventName: 'Битва за Ресурсы',
    eventDate: '2026-11-20',
    totalPlaces: '15',
    link: 'http://localhost:3000/#events'
  });

  assert.equal(successRes.sent, true);
  assert.equal(sentMessages.length, 1);
  assert.equal(sentMessages[0].chatId, -100777888999);
  assert.ok(sentMessages[0].text.includes('Битва за Ресурсы'));

  // Reset template back to default
  db.resetNotificationTemplate('event_registration_opened');
});

test('NotificationEngine: staff_event_registration includes inline button, throttles duplicate, and edits in-place on change', async () => {
  const sentMessages = [];
  const editedMessages = [];
  let messageIdCounter = 500;

  const fakeTelegram = {
    sendTelegramMessage: async (payload) => {
      const msgId = ++messageIdCounter;
      sentMessages.push({ ...payload, messageId: msgId });
      return { ok: true, result: { message_id: msgId } };
    },
    editTelegramMessageText: async (payload) => {
      editedMessages.push(payload);
      return { ok: true, result: { message_id: payload.messageId } };
    }
  };

  db.setAppSetting('telegram_bot_token', 'fake_token_123');
  db.setAppSetting('telegram_staff_chat_id', '-100999888777');

  const engine = createNotificationEngine({
    db,
    logic,
    telegram: fakeTelegram,
    getAppBaseUrl: () => 'https://kow.example.com'
  });

  // 1. Initial registration for #1
  const res1 = await engine.dispatchNotification('staff_event_registration', {
    eventId: 42,
    playerId: 10,
    eventName: 'Мощные силы',
    sectorName: 'Xolesik',
    desiredPlace: '#1',
    link: 'https://kow.example.com/#event/42'
  });

  assert.equal(res1.sent, true);
  assert.equal(sentMessages.length, 1);
  assert.equal(sentMessages[0].chatId, -100999888777);
  assert.ok(sentMessages[0].text.includes('Xolesik'));
  assert.ok(sentMessages[0].text.includes('#1'));
  // Verifying inline keyboard with direct tracker link
  assert.ok(sentMessages[0].replyMarkup, 'Should include replyMarkup');
  assert.deepEqual(sentMessages[0].replyMarkup.inline_keyboard[0][0], {
    text: '🔗 Открыть распределение мест',
    url: 'https://kow.example.com/#event/42'
  });

  // 2. Duplicate registration with SAME desiredPlace within cooldown -> should be skipped
  const res2 = await engine.dispatchNotification('staff_event_registration', {
    eventId: 42,
    playerId: 10,
    eventName: 'Мощные силы',
    sectorName: 'Xolesik',
    desiredPlace: '#1',
    link: 'https://kow.example.com/#event/42'
  });

  assert.equal(res2.sent, false);
  assert.equal(res2.skipped, true);
  assert.equal(res2.reason, 'duplicate_unchanged');
  assert.equal(sentMessages.length, 1, 'No new message should be sent');

  // 3. Changed desiredPlace to #3 within cooldown -> should edit existing message in-place
  const res3 = await engine.dispatchNotification('staff_event_registration', {
    eventId: 42,
    playerId: 10,
    eventName: 'Мощные силы',
    sectorName: 'Xolesik',
    desiredPlace: '#3',
    link: 'https://kow.example.com/#event/42'
  });

  assert.equal(res3.sent, true);
  assert.equal(res3.edited, true);
  assert.equal(sentMessages.length, 1, 'No new message sent, edited previous');
  assert.equal(editedMessages.length, 1);
  assert.equal(editedMessages[0].messageId, sentMessages[0].messageId);
  assert.ok(editedMessages[0].text.includes('#3'));
  assert.deepEqual(editedMessages[0].replyMarkup.inline_keyboard[0][0], {
    text: '🔗 Открыть распределение мест',
    url: 'https://kow.example.com/#event/42'
  });
});
