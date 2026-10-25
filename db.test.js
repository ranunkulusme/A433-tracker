const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

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

test('db initializes tables, seeds admin user and handles registration approval', () => {
  const dbModule = require('./db.js');
  const db = dbModule.initDb(':memory:');

  // Проверка авто-бутстрапа админа
  const admin = dbModule.findUserByUsername('admin');
  assert(admin);
  assert.equal(admin.rank, 'r5');
  assert.equal(admin.is_approved, 1);

  // Регистрация нового игрока
  const regResult = dbModule.registerUser({ username: 'shkiper', password: 'password123', playerName: 'Шкипер' });
  assert.equal(regResult.is_approved, 0);

  // Попытка входа до одобрения
  const loginBefore = dbModule.loginUser('shkiper', 'password123');
  assert.equal(loginBefore.error, 'PENDING_APPROVAL');

  // Одобрение чиновником
  dbModule.approveUser(regResult.userId, 'r3');
  const loginAfter = dbModule.loginUser('shkiper', 'password123');
  assert(loginAfter.token);
  assert.equal(loginAfter.user.rank, 'r3');
});

test('handles duplicate usernames and linking to existing playerId', () => {
  const dbModule = require('./db.js');
  const db = dbModule.initDb(':memory:');

  // Attempt duplicate registration
  const dup = dbModule.registerUser({ username: 'admin', password: 'newpassword' });
  assert.equal(dup.error, 'USERNAME_TAKEN');

  // Register linked to existing player
  const existingPlayer = dbModule.getPlayers()[1]; // Морской Волк, id: 2
  const regLinked = dbModule.registerUser({
    username: 'seawolf_user',
    password: 'password456',
    playerId: existingPlayer.id
  });
  assert.equal(regLinked.playerId, existingPlayer.id);
  assert.equal(regLinked.is_approved, 0);

  // Attempt to link already linked player
  const dupPlayer = dbModule.registerUser({
    username: 'another_user',
    password: 'password789',
    playerId: existingPlayer.id
  });
  assert.equal(dupPlayer.error, 'PLAYER_ALREADY_LINKED');

  // Attempt to link non-existent player
  const missingPlayer = dbModule.registerUser({
    username: 'missing_user',
    password: 'password789',
    playerId: 999999
  });
  assert.equal(missingPlayer.error, 'PLAYER_NOT_FOUND');

  // Approve as r4
  dbModule.approveUser(regLinked.userId, 'r4');
  const user = dbModule.findUserById(regLinked.userId);
  assert.equal(user.rank, 'r4');
  assert.equal(user.player_id, existingPlayer.id);

  // Check all users list
  const allUsers = dbModule.getUsers();
  assert(allUsers.length >= 2);
  const foundUser = allUsers.find(u => u.username === 'seawolf_user');
  assert(foundUser);
  assert.equal(foundUser.playerName, 'Морской Волк');
});

test('hashPassword and verifyPassword work correctly with salt', () => {
  const dbModule = require('./db.js');
  const hash = dbModule.hashPassword('secret123');
  assert(typeof hash === 'string');
  assert(hash.includes(':'));

  assert.equal(dbModule.verifyPassword('secret123', hash), true);
  assert.equal(dbModule.verifyPassword('wrongpass', hash), false);
  assert.equal(dbModule.verifyPassword('', hash), false);
});

test('sessions can be created, verified and deleted', () => {
  const dbModule = require('./db.js');
  const db = dbModule.initDb(':memory:');

  const admin = dbModule.findUserByUsername('admin');
  const token = dbModule.createSession(admin.id);
  assert(token && typeof token === 'string');

  const sessionUser = dbModule.verifySession(token);
  assert(sessionUser);
  assert.equal(sessionUser.id, admin.id);
  assert.equal(sessionUser.username, 'admin');
  assert.equal(sessionUser.rank, 'r5');

  dbModule.deleteSession(token);
  const afterDelete = dbModule.verifySession(token);
  assert.equal(afterDelete, null);
});

test('auto-bootstraps catalog, demo players and initial events in empty db', () => {
  const dbModule = require('./db.js');
  const db = dbModule.initDb(':memory:');

  const catalog = dbModule.getCatalog();
  assert(catalog.length >= 3);
  assert(catalog.some(c => c.name === 'Адмирал Нейтон'));

  const players = dbModule.getPlayers();
  assert(players.length >= 5);
  const komandor = players.find(p => p.name === 'Командор');
  assert(komandor);
  assert(komandor.officers.length > 0);

  const eventTypes = dbModule.getEventTypes();
  assert(eventTypes.length >= 2);
  assert(eventTypes.some(et => et.name === 'Король Войны'));

  const events = dbModule.getEvents();
  assert(events.length >= 3);
  assert(events[0].assignments.length > 0);
});

test('player and player officer CRUD operations', () => {
  const dbModule = require('./db.js');
  const db = dbModule.initDb(':memory:');

  // Create player
  const newPlayer = dbModule.createPlayer({
    name: 'Тестовый Игрок',
    realName: 'Василий',
    rank: 'r3',
    vipLevel: 10,
    confidentialityLevel: 5,
    power: 1200000,
    kills: 350000,
    stock: { coupons: 1500, puzzles: 10, chests: 2 }
  });
  assert(newPlayer.id);
  assert.equal(newPlayer.name, 'Тестовый Игрок');

  // Read player
  const fetched = dbModule.getPlayerById(newPlayer.id);
  assert.equal(fetched.name, 'Тестовый Игрок');
  assert.equal(fetched.realName, 'Василий');
  assert.equal(fetched.sector.vipLevel, 10);
  assert.equal(fetched.stock.coupons, 1500);

  // Update player
  dbModule.updatePlayer(newPlayer.id, {
    power: 1500000,
    stock: { coupons: 2000, puzzles: 12, chests: 3 }
  });
  const updated = dbModule.getPlayerById(newPlayer.id);
  assert.equal(updated.sector.power, 1500000);
  assert.equal(updated.stock.coupons, 2000);

  // Add officer
  const officer = dbModule.addPlayerOfficer(newPlayer.id, {
    catalogId: 'admiral-nathon',
    name: 'Адмирал Нейтон',
    level: 15,
    coupons: 1200,
    stars: 2
  });
  assert(officer.id);

  // Verify officer in player profile
  const playerWithOfficer = dbModule.getPlayerById(newPlayer.id);
  assert.equal(playerWithOfficer.officers.length, 1);
  assert.equal(playerWithOfficer.officers[0].level, 15);

  // Update officer
  dbModule.updatePlayerOfficer(newPlayer.id, officer.id, {
    level: 16,
    coupons: 500,
    stars: 3
  });
  const playerUpdatedOfficer = dbModule.getPlayerById(newPlayer.id);
  assert.equal(playerUpdatedOfficer.officers[0].level, 16);
  assert.equal(playerUpdatedOfficer.officers[0].stars, 3);

  // Delete officer
  dbModule.deletePlayerOfficer(newPlayer.id, officer.id);
  const playerNoOfficer = dbModule.getPlayerById(newPlayer.id);
  assert.equal(playerNoOfficer.officers.length, 0);

  // Delete player
  dbModule.deletePlayer(newPlayer.id);
  assert.equal(dbModule.getPlayerById(newPlayer.id), null);
});

test('event registrations CRUD and queries', () => {
  const dbModule = require('./db.js');
  const db = dbModule.initDb(':memory:');

  const events = dbModule.getEvents();
  const eventId = events[0].id;

  // Register for event
  dbModule.registerForEvent({
    eventId,
    playerId: 2,
    officerId: 'o3',
    desiredPlace: 1
  });

  const regs = dbModule.getRegistrationsByEventId(eventId);
  assert.equal(regs.length, 1);
  assert.equal(regs[0].playerId, 2);
  assert.equal(regs[0].desiredPlace, 1);

  // Update registration (UPSERT)
  dbModule.registerForEvent({
    eventId,
    playerId: 2,
    officerId: 'o3',
    desiredPlace: 2
  });
  const updatedRegs = dbModule.getRegistrationsByEventId(eventId);
  assert.equal(updatedRegs.length, 1);
  assert.equal(updatedRegs[0].desiredPlace, 2);

  // Unregister
  dbModule.unregisterFromEvent(eventId, 2);
  const emptyRegs = dbModule.getRegistrationsByEventId(eventId);
  assert.equal(emptyRegs.length, 0);
});

test('importKowJson and exportKowJson preserve and restore state', () => {
  const dbModule = require('./db.js');
  const db = dbModule.initDb(':memory:');

  const exported = dbModule.exportKowJson();
  assert(exported.players.length >= 5);
  assert(exported.officerCatalog.length >= 3);
  assert(exported.eventTypes.length >= 2);
  assert(exported.events.length >= 3);

  // Modify exported state and re-import
  const modified = JSON.parse(JSON.stringify(exported));
  modified.players.push({
    id: 999,
    name: 'Импортированный Воин',
    realName: 'Иван',
    rank: 'r3',
    sector: { vipLevel: 5, confidentialityLevel: 3, power: 500000, kills: 100000 },
    stock: { coupons: 3000, puzzles: 5, chests: 1 },
    officers: [
      { id: 'imp-o1', catalogId: 'general-rex', name: 'Генерал Рекс', level: 10, coupons: 200, stars: 1 }
    ]
  });

  dbModule.importKowJson(modified);

  const newExport = dbModule.exportKowJson();
  const found = newExport.players.find(p => p.id === 999);
  assert(found);
  assert.equal(found.name, 'Импортированный Воин');
  assert.equal(found.officers.length, 1);
});

test('rejectUser deletes pending registration and changePassword updates password', () => {
  const dbModule = require('./db.js');
  const db = dbModule.initDb(':memory:');

  const reg = dbModule.registerUser({ username: 'toberejected', password: 'pass', playerName: 'Отвергнутый' });
  assert.equal(reg.is_approved, 0);

  const pendingBefore = dbModule.getPendingUsers();
  assert(pendingBefore.some(u => u.username === 'toberejected'));

  dbModule.rejectUser(reg.userId);
  const pendingAfter = dbModule.getPendingUsers();
  assert(!pendingAfter.some(u => u.username === 'toberejected'));
  assert.equal(dbModule.findUserByUsername('toberejected'), null);

  // Password change
  const admin = dbModule.findUserByUsername('admin');
  dbModule.changePassword(admin.id, 'newpass123');
  const failOld = dbModule.loginUser('admin', 'admin123');
  assert.equal(failOld.error, 'INVALID_CREDENTIALS');
  const successNew = dbModule.loginUser('admin', 'newpass123');
  assert(successNew.token);
});

test('handles persistent file path and creates parent directory', () => {
  const dbModule = require('./db.js');
  const testDbDir = path.join('/tmp', 'kow-test-' + Date.now());
  const testDbPath = path.join(testDbDir, 'test.db');

  try {
    const db = dbModule.initDb(testDbPath);
    assert(fs.existsSync(testDbPath));
    const admin = dbModule.findUserByUsername('admin');
    assert(admin);
    assert.equal(admin.rank, 'r5');
  } finally {
    try {
      if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
      if (fs.existsSync(testDbDir)) fs.rmdirSync(testDbDir);
    } catch (e) {}
  }
});

test('db stores skills, vip_points, upgrade_type and retrieves recent winners', () => {
  const dbModule = require('./db.js');
  const db = dbModule.initDb(':memory:');

  // 1. Проверка сохранения vipPoints и навыков офицера
  const player = dbModule.createPlayer({
    name: 'Командор VIP',
    sector: { vipLevel: 12, vipPoints: 450000 },
    officers: [{ id: 'o-vip', catalogId: 'general-rex', name: 'Генерал Рекс', level: 10, skills: [5, 5, 1, 1] }]
  });

  const fetched = dbModule.getPlayerById(player.id);
  assert.strictEqual(fetched.sector.vipPoints, 450000);
  assert.deepStrictEqual(fetched.officers[0].skills, [5, 5, 1, 1]);

  // 2. Обновление vipPoints и навыков
  dbModule.updatePlayer(player.id, { sector: { vipPoints: 520000 } });
  const updatedPlayer = dbModule.getPlayerById(player.id);
  assert.strictEqual(updatedPlayer.sector.vipPoints, 520000);

  dbModule.updatePlayerOfficer(player.id, 'o-vip', { skills: [5, 5, 5, 2] });
  const updatedOfficer = dbModule.getPlayerById(player.id);
  assert.deepStrictEqual(updatedOfficer.officers[0].skills, [5, 5, 5, 2]);

  // 3. Каталог и upgradeType
  const catalog = dbModule.getCatalog();
  assert(catalog.length >= 12, 'Catalog should be seeded with COMMUNITY_OFFICERS');
  const angel = catalog.find(c => c.id === 'angel');
  assert(angel, 'Angel officer should exist in catalog');
  assert.strictEqual(angel.upgradeType, 'special');

  dbModule.saveCatalogItem({
    id: 'custom-hero',
    name: 'Кастом Герой',
    type: 'Танк',
    upgradeType: 'special'
  });
  const custom = dbModule.getCatalog().find(c => c.id === 'custom-hero');
  assert.strictEqual(custom.upgradeType, 'special');

  // 4. Проверка метода getRecentWinners
  assert(typeof dbModule.getRecentWinners === 'function');
  const kwWinners = dbModule.getRecentWinners(1, 2);
  assert.deepStrictEqual(kwWinners, [5, 3]);

  const kwWinnerSingle = dbModule.getRecentWinners(1, 1);
  assert.deepStrictEqual(kwWinnerSingle, [5]);

  const kwWinnerExclude = dbModule.getRecentWinners(1, 2, 3);
  assert.deepStrictEqual(kwWinnerExclude, [3]);

  // 5. Проверка exportKowJson и importKowJson с новыми полями
  const exported = dbModule.exportKowJson();
  const exportedPlayer = exported.players.find(p => p.id === player.id);
  assert.strictEqual(exportedPlayer.sector.vipPoints, 520000);
  assert.deepStrictEqual(exportedPlayer.officers[0].skills, [5, 5, 5, 2]);

  // Чистый импорт в новую базу
  dbModule.initDb(':memory:');
  dbModule.importKowJson(exported);
  const reFetched = dbModule.getPlayerById(player.id);
  assert.strictEqual(reFetched.sector.vipPoints, 520000);
  assert.deepStrictEqual(reFetched.officers[0].skills, [5, 5, 5, 2]);
});

test('db migrates legacy database schema safely adding missing columns', () => {
  const { DatabaseSync } = require('node:sqlite');
  const testDbDir = path.join('/tmp', 'kow-legacy-' + Date.now());
  const testDbPath = path.join(testDbDir, 'legacy.db');
  fs.mkdirSync(testDbDir, { recursive: true });

  try {
    // 1. Создаем старую схему v3.0.0 без новых колонок
    const legacyDb = new DatabaseSync(testDbPath);
    legacyDb.exec(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        rank TEXT NOT NULL DEFAULT 'r3',
        is_approved INTEGER NOT NULL DEFAULT 0,
        player_id INTEGER NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE players (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        real_name TEXT DEFAULT '',
        rank TEXT NOT NULL DEFAULT 'r3',
        vip_level INTEGER DEFAULT 0,
        confidentiality_level INTEGER DEFAULT 0,
        power REAL DEFAULT 0,
        kills REAL DEFAULT 0,
        kill_points REAL DEFAULT 0,
        stock_coupons INTEGER DEFAULT 0,
        stock_puzzles INTEGER DEFAULT 0,
        stock_chests INTEGER DEFAULT 0,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE player_officers (
        id TEXT PRIMARY KEY,
        player_id INTEGER NOT NULL REFERENCES players(id),
        catalog_id TEXT NOT NULL,
        name TEXT NOT NULL,
        level INTEGER NOT NULL DEFAULT 0,
        coupons INTEGER NOT NULL DEFAULT 0,
        stars INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE officer_catalog (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        generation INTEGER NOT NULL DEFAULT 7,
        coupon_per_puzzle INTEGER NOT NULL DEFAULT 500,
        medals_before_training INTEGER DEFAULT 690,
        medals_training INTEGER DEFAULT 900,
        medals_total INTEGER DEFAULT 1590
      );
      INSERT INTO users (username, password_hash, rank, is_approved, created_at)
      VALUES ('admin', 'hash', 'r5', 1, '2026-01-01');
      INSERT INTO players (name, rank, updated_at) VALUES ('Ветеран', 'r3', '2026-01-01');
      INSERT INTO player_officers (id, player_id, catalog_id, name) VALUES ('po-legacy', 1, 'admiral-nathon', 'Адмирал');
    `);
    legacyDb.close();

    // 2. Инициализируем через initDb — должна произойти безопасная миграция
    const dbModule = require('./db.js');
    dbModule.initDb(testDbPath);

    const player = dbModule.getPlayerById(1);
    assert.strictEqual(player.sector.vipPoints, 0);
    assert.deepStrictEqual(player.officers[0].skills, [1, 1, 1, 1]);

    const catalogCols = dbModule.getDb().prepare("PRAGMA table_info(officer_catalog)").all().map(c => c.name);
    assert(catalogCols.includes('upgrade_type'));

    const playerCols = dbModule.getDb().prepare("PRAGMA table_info(players)").all().map(c => c.name);
    assert(playerCols.includes('vip_points'));

    const officerCols = dbModule.getDb().prepare("PRAGMA table_info(player_officers)").all().map(c => c.name);
    assert(officerCols.includes('skills_json'));
  } finally {
    try {
      if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
      if (fs.existsSync(testDbDir)) fs.rmdirSync(testDbDir);
    } catch (e) {}
  }
});
