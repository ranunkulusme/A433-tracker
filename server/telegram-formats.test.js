const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseTelegramStockCommand,
  formatStockUpdateSuccessMessage,
  formatTelegramMeMessage,
  formatTelegramDeficitMessage,
  formatTelegramEventsListMessage,
  getTelegramEventsKeyboard,
  formatTelegramEventDetailMessage,
  formatEventDetailRegistrationKeyboard,
  getTelegramMainMenuKeyboard,
  formatEventRegistrationKeyboard,
  formatEventRegistrationConfirmedKeyboard,
  formatTelegramWhoMessage,
  formatTelegramStaleReport,
  formatTelegramDigestMessage,
  formatTelegramOcrConfirmationMessage,
  getTelegramOcrConfirmationKeyboard,
  getTelegramStockFallbackKeyboard,
  formatTmaUrl
} = require('./telegram-formats.js');

test('parseTelegramStockCommand parses /stock and /склад commands accurately', () => {
  assert.deepStrictEqual(parseTelegramStockCommand('/stock 15000 350'), { coupons: 15000, puzzles: 350 });
  assert.deepStrictEqual(parseTelegramStockCommand('/склад 25 000 450'), { coupons: 25000, puzzles: 450 });
  assert.deepStrictEqual(parseTelegramStockCommand('/stock 12500'), { coupons: 12500, puzzles: 0 });
  assert.deepStrictEqual(parseTelegramStockCommand('/stock 50000 400 120 10 5 2'), {
    coupons: 50000, puzzles: 400, starCoupons: 120, legendaryStars1: 10, legendaryStars2: 5, legendaryStars3: 2
  });
  assert.deepStrictEqual(parseTelegramStockCommand('/stock@kow_bot 18000 220'), { coupons: 18000, puzzles: 220 });
  assert.strictEqual(parseTelegramStockCommand('/help'), null);
  assert.strictEqual(parseTelegramStockCommand('/stock'), null);
  assert.strictEqual(parseTelegramStockCommand(null), null);
});

test('formatStockUpdateSuccessMessage formats message with stocks, diff and deficit', () => {
  const msg = formatStockUpdateSuccessMessage(
    { summary: '+5 000 куп., +50 пазл.' },
    { coupons: 25000, puzzles: 350, starCoupons: 120 },
    { sectorName: 'Alpha Base', targetOfficer: 'Элизабет', targetDeficit: 8000 }
  );
  assert.ok(msg.includes('✅ <b>Склад успешно обновлен!</b>'));
  assert.ok(msg.includes('Alpha Base'));
  assert.ok(msg.includes('25 000'));
  assert.ok(msg.includes('Элизабет'));
  assert.ok(msg.includes('8 000'));
});

test('telegram fighter suite formatters and keyboards', () => {
  const meText = formatTelegramMeMessage({
    user: { id: 1, username: 'ranger', rank: 'r3' },
    player: { id: 1, name: 'Sector 7 (Рейнджер)', power: 48200000, vip: 14, stock: { coupons: 18450, puzzles: 320 } },
    freshness: { status: 'fresh', days: 2, label: '2 дн. назад' },
    targetOfficer: { name: 'Элизабет', skills: [5, 4, 3, 2], stars: 4 },
    targetDeficit: 4200
  });
  assert.ok(meText.includes('Sector 7 (Рейнджер)'));
  assert.ok(meText.includes('Элизабет'));

  const deficitText = formatTelegramDeficitMessage({
    player: { name: 'Sector 7' },
    targetOfficer: { name: 'Элизабет', skills: [5, 4, 3, 2], stars: 4 },
    deficit: { coupons: 4200, puzzles: 84, medalsRemaining: 140 },
    dailyRewards: { coupons: 300, puzzles: 0 },
    daysEstimate: 14
  });
  assert.ok(deficitText.includes('Элизабет'));
  assert.ok(deficitText.includes('14 дн'));

  const eventsText = formatTelegramEventsListMessage({
    events: [
      { id: 1, title: 'Мощные силы', dateFrom: '2026-11-15T00:00:00Z', assignments: [{ playerId: 1, place: 1, coupons: 50, rsvpStatus: 'confirmed' }] }
    ],
    playerId: 1
  });
  assert.ok(eventsText.includes('Мощные силы'));

  const detailMsg = formatTelegramEventDetailMessage({
    event: { id: 6, title: 'Мощные Силы', dateFrom: '2026-11-14T00:00:00Z' },
    eventType: { name: 'Мощные Силы', places: [{ place: 1, coupons: 18000 }] },
    registration: { desiredPlace: 2 }
  });
  assert.ok(detailMsg.includes('Мощные Силы'));

  const kb = formatEventDetailRegistrationKeyboard({
    eventId: 6,
    eventType: { places: [{ place: 1, coupons: 18000 }] },
    registration: { desiredPlace: 2 }
  });
  assert.ok(kb.inline_keyboard.flat().some(b => b.callback_data === 'unreg_event:6'));

  const upcomingKb = getTelegramEventsKeyboard({ events: [{ id: 6, title: 'Мощные Силы' }], mode: 'upcoming' });
  assert.ok(upcomingKb.inline_keyboard.flat().some(b => b.callback_data === 'cmd_ev_view:6'));
});

test('telegram event registration keyboards and TMA URL helper', () => {
  const regKb = formatEventRegistrationKeyboard(42);
  assert.ok(regKb.inline_keyboard.flat().some(b => b.callback_data === 'reg_event:42:0'));
  const confKb = formatEventRegistrationConfirmedKeyboard(42, 1);
  assert.ok(confKb.inline_keyboard.flat().some(b => b.callback_data === 'unreg_event:42'));

  assert.strictEqual(formatTmaUrl('https://kow.example.com'), 'https://kow.example.com/?tma=1');
  assert.strictEqual(formatTmaUrl('ftp://example.com'), null);

  const menuKb = getTelegramMainMenuKeyboard({ isStaff: false, webAppUrl: 'https://kow.timeweb.app' });
  assert.strictEqual(menuKb.inline_keyboard[0][0].web_app.url, 'https://kow.timeweb.app/?tma=1');
});

test('telegram officer suite and OCR fallback formatters', () => {
  const whoText = formatTelegramWhoMessage({
    player: { id: 5, name: 'Sector 12', power: 42000000, vip: 13, stock: { coupons: 5000, puzzles: 120 } },
    user: { id: 10, username: 'viking_lord', rank: 'r3' }
  });
  assert.ok(whoText.includes('Sector 12'));

  const staleText = formatTelegramStaleReport({ stalePlayers: [{ name: 'Sector 9', days: 22, username: 'soldier9' }] });
  assert.ok(staleText.includes('@soldier9'));

  const digestText = formatTelegramDigestMessage({ totalSectors: 42, freshnessStats: { fresh: 28, warning: 8, stale: 6 } });
  assert.ok(digestText.includes('42'));

  const ocrMsg = formatTelegramOcrConfirmationMessage({
    player: { name: 'Sector 77' },
    recognizedStock: { coupons: 14500, puzzles: 320, starCoupons: 15, legendaryStars1: 2, legendaryStars2: 1, legendaryStars3: 0 }
  });
  assert.ok(ocrMsg.includes('14 500'));
  assert.strictEqual(getTelegramOcrConfirmationKeyboard(42).inline_keyboard[0][0].callback_data, 'confirm_ocr_stock:42');
  assert.strictEqual(getTelegramStockFallbackKeyboard().inline_keyboard[0][0].callback_data, 'confirm_current_stock');
});
