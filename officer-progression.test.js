const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const testDbPath = path.join(__dirname, 'data', 'test-officer-progression.db');
if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);

process.env.DB_PATH = testDbPath;
const db = require('./db.js');
db.initDb();

const logic = require('./logic.js');
const { createOfficerProgression } = require('./officer-progression.js');

test('OfficerProgression: addOfficer with initial stock deduction deducts resources atomically', async () => {
  const progression = createOfficerProgression({ db, logic });

  const uRes = db.registerUser({ username: 'prog_user_1', password: 'password123' });
  const player = db.createPlayer({
    userId: uRes.userId,
    name: 'Sector Prog 1',
    stock: {
      coupons: 50000,
      puzzles: 100,
      starCoupons: 1000,
      legendaryStars1: 5,
      legendaryStars2: 2,
      legendaryStars3: 1
    }
  });

  const catEntry = db.saveCatalogItem({
    id: 'cat_katya',
    name: 'Катя',
    generation: 7,
    coupon_cost: 600,
    star_coupon_cost: 300,
    medals_before_training: 690
  });

  const res = progression.addOfficer(player.id, {
    catalogId: catEntry.id,
    name: 'Катя',
    level: 0,
    stars: 2,
    skills: [1, 1, 1, 1]
  }, { isRetro: false, deductStock: true, userId: uRes.userId });

  assert.equal(res.ok, true);
  assert.ok(res.officer);
  assert.equal(res.officer.stars, 2);
  assert.equal(res.stockDeducted, true);
  assert.ok(res.newStock);

  // Check persisted player
  const updatedPlayer = db.getPlayerById(player.id);
  assert.equal(updatedPlayer.officers.length, 1);
  assert.equal(updatedPlayer.officers[0].stars, 2);
  assert.ok(updatedPlayer.stock.starCoupons < 1000);

  // Check audit history record
  const history = db.getStockHistoryByPlayerId(player.id);
  assert.ok(history.length >= 1);
  assert.ok(history[0].diffSummary.includes('Катя') || history[0].diffSummary.includes('прокачка') || history[0].diffSummary.includes('звезд'));
});

test('OfficerProgression: addOfficer aborts when stock is insufficient', async () => {
  const progression = createOfficerProgression({ db, logic });

  const uRes = db.registerUser({ username: 'poor_user', password: 'password123' });
  const player = db.createPlayer({
    userId: uRes.userId,
    name: 'Sector Poor',
    stock: {
      coupons: 100,
      puzzles: 0,
      starCoupons: 0,
      legendaryStars1: 0,
      legendaryStars2: 0,
      legendaryStars3: 0
    }
  });

  const catEntry = db.saveCatalogItem({
    id: 'cat_liza',
    name: 'Лиза',
    generation: 7,
    coupon_cost: 600,
    star_coupon_cost: 300
  });

  const res = progression.addOfficer(player.id, {
    catalogId: catEntry.id,
    name: 'Лиза',
    level: 0,
    stars: 4,
    skills: [1, 1, 1, 1]
  }, { isRetro: false, deductStock: true, userId: uRes.userId });

  assert.equal(res.ok, false);
  assert.equal(res.error, 'INSUFFICIENT_STOCK');

  // Verify DB was NOT mutated
  const updatedPlayer = db.getPlayerById(player.id);
  assert.equal(updatedPlayer.officers.length, 0);
  assert.equal(updatedPlayer.stock.coupons, 100);
});

test('OfficerProgression: addOfficer in retro mode creates officer without mutating stock', async () => {
  const progression = createOfficerProgression({ db, logic });

  const uRes = db.registerUser({ username: 'retro_user', password: 'password123' });
  const player = db.createPlayer({
    userId: uRes.userId,
    name: 'Sector Retro',
    stock: { coupons: 5000, puzzles: 50 }
  });

  const catEntry = db.saveCatalogItem({
    id: 'cat_chloe',
    name: 'Хлоя',
    generation: 6,
    coupon_cost: 500
  });

  const res = progression.addOfficer(player.id, {
    catalogId: catEntry.id,
    name: 'Хлоя',
    level: 50,
    stars: 5,
    skills: [5, 5, 5, 5]
  }, { isRetro: true, userId: uRes.userId });

  assert.equal(res.ok, true);
  assert.equal(res.stockDeducted, false);

  const updatedPlayer = db.getPlayerById(player.id);
  assert.equal(updatedPlayer.officers.length, 1);
  assert.equal(updatedPlayer.officers[0].stars, 5);
  assert.equal(updatedPlayer.stock.coupons, 5000);
});

test('OfficerProgression: updateOfficer upgrades stars and deducts star resources atomically', async () => {
  const progression = createOfficerProgression({ db, logic });

  const uRes = db.registerUser({ username: 'upgrader_user', password: 'password123' });
  const player = db.createPlayer({
    userId: uRes.userId,
    name: 'Sector Upgrader',
    stock: {
      coupons: 10000,
      puzzles: 100,
      starCoupons: 2000,
      legendaryStars1: 10,
      legendaryStars2: 10,
      legendaryStars3: 10
    }
  });

  const catEntry = db.saveCatalogItem({
    id: 'cat_emma',
    name: 'Эмма',
    generation: 7,
    coupon_cost: 600,
    star_coupon_cost: 300
  });

  // First add officer at 1 star retro
  const addRes = progression.addOfficer(player.id, {
    catalogId: catEntry.id,
    name: 'Эмма',
    stars: 1,
    skills: [1, 1, 1, 1]
  }, { isRetro: true, userId: uRes.userId });
  assert.equal(addRes.ok, true);

  const officerId = addRes.officer.id;

  // Now upgrade to 2 stars with normal stock deduction
  const updateRes = progression.updateOfficer(player.id, officerId, {
    stars: 2
  }, { isRetro: false, deductStock: true, userId: uRes.userId });

  assert.equal(updateRes.ok, true);
  assert.equal(updateRes.officer.stars, 2);
  assert.equal(updateRes.stockDeducted, true);

  const updatedPlayer = db.getPlayerById(player.id);
  assert.equal(updatedPlayer.officers[0].stars, 2);
  assert.ok(updatedPlayer.stock.starCoupons < 2000);
});

test('OfficerProgression: updateOfficer aborts when star resources are insufficient', async () => {
  const progression = createOfficerProgression({ db, logic });

  const uRes = db.registerUser({ username: 'cant_afford_user', password: 'password123' });
  const player = db.createPlayer({
    userId: uRes.userId,
    name: 'Sector Cant Afford',
    stock: {
      coupons: 1000,
      puzzles: 10,
      starCoupons: 10,
      legendaryStars1: 0,
      legendaryStars2: 0,
      legendaryStars3: 0
    }
  });

  const catEntry = db.saveCatalogItem({
    id: 'cat_diana',
    name: 'Диана',
    generation: 7,
    coupon_cost: 600,
    star_coupon_cost: 300
  });

  const addRes = progression.addOfficer(player.id, {
    catalogId: catEntry.id,
    name: 'Диана',
    stars: 1,
    skills: [1, 1, 1, 1]
  }, { isRetro: true, userId: uRes.userId });
  assert.equal(addRes.ok, true);

  const officerId = addRes.officer.id;

  const updateRes = progression.updateOfficer(player.id, officerId, {
    stars: 4
  }, { isRetro: false, deductStock: true, userId: uRes.userId });

  assert.equal(updateRes.ok, false);
  assert.equal(updateRes.error, 'INSUFFICIENT_STOCK');

  const updatedPlayer = db.getPlayerById(player.id);
  assert.equal(updatedPlayer.officers[0].stars, 1);
  assert.equal(updatedPlayer.stock.starCoupons, 10);
});

test('OfficerProgression: deleteOfficer removes officer from sector', async () => {
  const progression = createOfficerProgression({ db, logic });

  const uRes = db.registerUser({ username: 'del_user', password: 'password123' });
  const player = db.createPlayer({
    userId: uRes.userId,
    name: 'Sector Del'
  });

  const addRes = progression.addOfficer(player.id, {
    name: 'Нэнси',
    stars: 3,
    skills: [1, 1, 1, 1]
  }, { isRetro: true, userId: uRes.userId });
  assert.equal(addRes.ok, true);

  const delRes = progression.deleteOfficer(player.id, addRes.officer.id);
  assert.equal(delRes.ok, true);

  const updatedPlayer = db.getPlayerById(player.id);
  assert.equal(updatedPlayer.officers.length, 0);
});
