const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createOcrAdapter,
  cleanOcrNumber,
  parseProfileScreenshotText,
  parseWarehouseScreenshotText,
  classifyScreenshotText,
  parseSmartScanText,
  mergeScanResults,
  parseExchangeShopScreenshotText
} = require('./ocr-adapter.js');

function calculateTotalStarPointsLocal(stock = {}) {
  return (Number(stock.legendaryStars1 || 0) * 110) +
    (Number(stock.legendaryStars2 || 0) * 420) +
    (Number(stock.legendaryStars3 || 0) * 960);
}

test('cleanOcrNumber removes artifacts, replaces O/I/l and handles K/M/B multipliers', () => {
  assert.strictEqual(cleanOcrNumber(' 157,660,593 '), 157660593);
  assert.strictEqual(cleanOcrNumber('7 588 164 323'), 7588164323);
  assert.strictEqual(cleanOcrNumber('419.202'), 419202);
  assert.strictEqual(cleanOcrNumber('2,077'), 2077);
  assert.strictEqual(cleanOcrNumber('l,097'), 1097);
  assert.strictEqual(cleanOcrNumber('I097'), 1097);
  assert.strictEqual(cleanOcrNumber('95o'), 950);
  assert.strictEqual(cleanOcrNumber('42O'), 420);
  assert.strictEqual(cleanOcrNumber("1'097"), 1097);
  assert.strictEqual(cleanOcrNumber('7.6B'), 7600000000);
  assert.strictEqual(cleanOcrNumber('7,6 b'), 7600000000);
  assert.strictEqual(cleanOcrNumber('15M'), 15000000);
  assert.strictEqual(cleanOcrNumber('2.5K'), 2500);
  assert.strictEqual(cleanOcrNumber(419202), 419202);
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

test('parseProfileScreenshotText correctly parses total power, kills and exact killPoints with sub-powers', () => {
  const realProfileText = `
[A433]ranu
Сила 165,752,844
Убито 84,863,033
Очки за убийство 7.6B

СИЛА
Сила юнитов 26,788,097
Сила построек 32,794,324
Сила исследований 65,476,911
Сила офицера 4,892,754
Сила военного корабля 32,179,698

СТАТИСТИКА БОЕВ
Выиграно боев 958
Проиграно боев 292
Уничтожено юнитов 84,863,033
Количество разведок 885
Очки за убийство 7,589,192,717

Уничтожен/серьезно ранен Очки за убийство
1,732,777 1,732,777
  `;

  const parsed = parseProfileScreenshotText(realProfileText);
  assert.strictEqual(parsed.isProfile, true);
  assert.strictEqual(parsed.sector.allianceTag, 'A433');
  assert.strictEqual(parsed.sector.name, 'ranu');
  assert.strictEqual(parsed.sector.power, 165752844);
  assert.strictEqual(parsed.sector.kills, 84863033);
  assert.strictEqual(parsed.sector.killPoints, 7589192717);
});

test('parseProfileScreenshotText recognizes English and German player profiles', () => {
  const enProfile = parseProfileScreenshotText(`
[USA]EagleOne
Power: 145,200,300
VIP 14
Kills: 65,400,200
Kill Points: 5,120,400,000
  `);
  assert.strictEqual(enProfile.isProfile, true);
  assert.strictEqual(enProfile.sector.power, 145200300);

  const deProfile = parseProfileScreenshotText(`
[GER]Kaiser
Macht: 88,100,500
Eliminierungen: 32,400,000
Tötungspunkte: 3.5B
  `);
  assert.strictEqual(deProfile.isProfile, true);
  assert.strictEqual(deProfile.sector.power, 88100500);
  assert.strictEqual(deProfile.sector.killPoints, 3500000000);
});

test('parseWarehouseScreenshotText recognizes parallel columns, chests, stars and English/German text', () => {
  const parsedCols = parseWarehouseScreenshotText({
    leftText: `Купон готовности офицера\nВ наличии: 482,611\n‘легендарного. ед; офицера\nВ наличии: 2.253`,
    rightText: `Купон готовности звезды\nВ наличии: 283,818\nМедаль Звезда\nВ наличии: 672`
  });
  assert.strictEqual(parsedCols.isWarehouse, true);
  assert.strictEqual(parsedCols.stock.coupons, 482611);
  assert.strictEqual(parsedCols.stock.starCoupons, 283818);
  assert.strictEqual(parsedCols.stock.puzzles, 2253);
  assert.strictEqual(parsedCols.stock.legendaryStars1, 672);

  const realWarehouse = parseWarehouseScreenshotText({
    leftText: `Сундук медалей\nлегендарного\nофицера\nВ наличии: 3\nЛегендарная звезда II\n420\n1\nВ наличии: 104`,
    rightText: `Сундук выбора\nмедали\nлегендарного\nофицера\nВ наличии: 604\nЛегендарная звезда III\n960\nВ наличии: 27`
  });
  assert.strictEqual(realWarehouse.stock.chests, 3);
  assert.strictEqual(realWarehouse.stock.legendaryStars2, 104);
  assert.strictEqual(realWarehouse.stock.legendaryStars3, 27);
  assert.strictEqual(realWarehouse.stock.puzzles, undefined);

  const enParsed = parseWarehouseScreenshotText(`
Officer Readiness Coupon\nIn Stock: 520,100
Legendary Officer Medal\nOwned: 3,450
Star Readiness Coupon\nIn Stock: 88,200
Legendary Star I\nOwned: 1,230
Legendary Star II\nOwned: 140
Legendary Star III\nOwned: 35
  `);
  assert.strictEqual(enParsed.stock.coupons, 520100);
  assert.strictEqual(enParsed.stock.puzzles, 3450);
  assert.strictEqual(enParsed.stock.legendaryStars3, 35);

  const deParsed = parseWarehouseScreenshotText(`
Offiziersbereitschafts-Gutschein\nVorhanden: 15,200
Legendäre Offiziersmedaille\nIm Besitz: 820
Sternbereitschafts-Gutschein\nVorhanden: 4,500
Legendärer Stern I\n110\nIm Besitz: 310
Legendärer Stern II\n420\nIm Besitz: 45
Legendärer Stern III\n960\nIm Besitz: 12
  `);
  assert.strictEqual(deParsed.stock.coupons, 15200);
  assert.strictEqual(deParsed.stock.legendaryStars3, 12);
});

test('parseSmartScanText rejects app UI screenshots and classifies screenshots accurately', () => {
  const blankScan = parseSmartScanText('случайный текст без игровых данных и цифр');
  assert.strictEqual(blankScan.hasRecognizedData, false);
  assert.strictEqual(blankScan.detectedType, 'unknown');

  const whScan = parseSmartScanText('Купон готовности офицера\nВ наличии: 10,000');
  assert.strictEqual(whScan.hasRecognizedData, true);
  assert.strictEqual(whScan.detectedType, 'warehouse');
  assert.strictEqual(whScan.stock.coupons, 10000);

  const profScan = parseSmartScanText('[RUS]Лидер\nСила: 50,000,000\nУбито: 10,000,000');
  assert.strictEqual(profScan.hasRecognizedData, true);
  assert.strictEqual(profScan.detectedType, 'profile');
});

test('mergeScanResults combines multiple screenshots without losing or overwriting data', () => {
  let merged = mergeScanResults({}, {
    isProfile: true,
    sector: { name: 'ranu', allianceTag: 'A433', power: 157660593, kills: 84778517, killPoints: 7600000000 },
  });
  merged = mergeScanResults(merged, {
    isProfile: true,
    sector: { name: 'ranu', allianceTag: 'A433', power: 157660593, kills: 84778517, killPoints: 7588164323 },
  });
  merged = mergeScanResults(merged, {
    isWarehouse: true,
    stock: { coupons: 419202, puzzles: 2077 },
  });
  merged = mergeScanResults(merged, {
    isWarehouse: true,
    stock: { starCoupons: 244712, legendaryStars1: 1097, legendaryStars2: 95, legendaryStars3: 22 },
  });
  assert.strictEqual(merged.sector.killPoints, 7588164323);
  assert.strictEqual(calculateTotalStarPointsLocal(merged.stock), 181690);
});

test('parseExchangeShopScreenshotText extracts officers, seasons, puzzle coupons, and star coupons', () => {
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
С 7
Ройшин
x1 600 ОБМЕН
110 x1 300 ОБМЕН
  `;

  const results = parseExchangeShopScreenshotText(sampleOcrText);
  assert.strictEqual(results.length, 3);
  assert.strictEqual(results.find(o => o.name === 'По').couponPerPuzzle, 720);
  assert.strictEqual(results.find(o => o.name === 'Ройшин').couponPerPuzzle, 600);
});

test('OcrAdapter: encapsulate column recognition without marker leaks, recognize chest-only stock, and handle exchange mode', async () => {
  const adapter = createOcrAdapter({
    customRunner: async () => ({
      fullText: 'Сундук выбора\nВ наличии: 604',
      leftText: 'Сундук медалей\nлегендарного\nофицера\nВ наличии: 5',
      rightText: 'Легендарная звезда II\n420\nВ наличии: 18'
    })
  });

  // 1. recognizeStock handles chest-only + stars II without coupons/puzzles
  const stock = await adapter.recognizeStock(Buffer.from('FAKE_PNG'));
  assert.ok(stock, 'Stock with only chests and legendaryStars2 must not be dropped');
  assert.strictEqual(stock.chests, 5);
  assert.strictEqual(stock.legendaryStars2, 18);

  // 2. scanImages does not leak column marker protocol strings into rawTexts or require markers
  const scanRes = await adapter.scanImages([Buffer.from('FAKE_PNG')]);
  assert.strictEqual(scanRes.success, true);
  assert.strictEqual(scanRes.detectedType, 'warehouse');
  assert.strictEqual(scanRes.stock.chests, 5);
  assert.strictEqual(scanRes.stock.legendaryStars2, 18);
  assert.ok(!JSON.stringify(scanRes).includes('=== LEFT COLUMN ==='));

  // 3. Exchange shop mode returns structured officers for Catalog UI
  adapter.setRunner(async () => ({
    text: 'Обмен на медали офицера, сезон 8\nS8 По\nx1 720 ОБМЕН\n110 x1 360 ОБМЕН'
  }));
  const exchangeRes = await adapter.scanImages([Buffer.from('FAKE_EXCHANGE')], { mode: 'exchange' });
  assert.strictEqual(exchangeRes.success, true);
  assert.strictEqual(exchangeRes.detectedType, 'exchange_shop');
  assert.strictEqual(exchangeRes.hasRecognizedData, true);
  assert.strictEqual(exchangeRes.officers.length, 1);
  assert.strictEqual(exchangeRes.officers[0].name, 'По');
  assert.strictEqual(exchangeRes.officers[0].couponPerPuzzle, 720);
});
