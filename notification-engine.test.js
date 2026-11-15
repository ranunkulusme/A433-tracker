const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const testDbPath = path.join(__dirname, 'data', 'test-notifications.db');
if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);

process.env.DB_PATH = testDbPath;
const db = require('./db.js');
db.initDb();

const logic = require('./logic.js');
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

test('NotificationEngine: templates CRUD, reset and test render', async () => {
  const engine = createNotificationEngine({ db, logic });

  const templates = engine.getTemplates();
  assert.ok(Array.isArray(templates));
  assert.ok(templates.length > 0);

  const tpl = engine.getTemplate('staff_new_user_pending');
  assert.ok(tpl);

  // Update
  const updated = engine.saveTemplate('staff_new_user_pending', {
    template: 'Тест: боец {username} ({characterName})'
  });
  assert.ok(updated.template.includes('Тест:'));

  // Test render
  const testRes = engine.testTemplate('staff_new_user_pending', { username: 'BraveOne', characterName: 'Сектор 1' });
  assert.equal(testRes.renderedText, 'Тест: боец BraveOne (Сектор 1)');

  // Reset
  const resetRes = engine.resetTemplate('staff_new_user_pending');
  assert.ok(!resetRes.template.includes('Тест:'));
});
