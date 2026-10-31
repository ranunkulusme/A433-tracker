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

  // Delete player and ensure linked user's player_id is cleared
  const regUser = dbModule.registerUser({ username: 'del_player_user_' + Date.now(), password: 'password123', playerId: newPlayer.id });
  assert.equal(regUser.playerId, newPlayer.id);

  dbModule.deletePlayer(newPlayer.id);
  assert.equal(dbModule.getPlayerById(newPlayer.id), null);
  const userAfterDelete = dbModule.findUserById(regUser.userId || regUser.id);
  assert.equal(userAfterDelete.player_id, null);
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
      dbModule.getDb().close();
    } catch (e) {}
    try {
      fs.rmSync(testDbDir, { recursive: true, force: true });
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
    assert(playerCols.includes('stock_star_coupons'));
    assert(playerCols.includes('stock_legendary_stars_1'));
    assert(playerCols.includes('stock_legendary_stars_2'));
    assert(playerCols.includes('stock_legendary_stars_3'));

    assert.strictEqual(player.stock.starCoupons, 0);
    assert.strictEqual(player.stock.legendaryStars1, 0);
    assert.strictEqual(player.stock.legendaryStars2, 0);
    assert.strictEqual(player.stock.legendaryStars3, 0);

    const officerCols = dbModule.getDb().prepare("PRAGMA table_info(player_officers)").all().map(c => c.name);
    assert(officerCols.includes('skills_json'));
  } finally {
    try {
      dbModule.getDb().close();
    } catch (e) {}
    try {
      fs.rmSync(testDbDir, { recursive: true, force: true });
    } catch (e) {}
  }
});

test('initDb preserves existing catalog officers and migrates missing columns without force-re-seeding', () => {
  const { DatabaseSync } = require('node:sqlite');
  const dbModule = require('./db.js');
  const testDbDir = path.join(__dirname, 'data-test-community');
  const testDbPath = path.join(testDbDir, 'kow-community.db');

  try {
    if (!fs.existsSync(testDbDir)) fs.mkdirSync(testDbDir, { recursive: true });
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);

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
        rank TEXT NOT NULL DEFAULT 'r3',
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
        upgrade_type TEXT NOT NULL DEFAULT 'standard',
        medals_before_training INTEGER DEFAULT 690,
        medals_training INTEGER DEFAULT 900,
        medals_total INTEGER DEFAULT 1590
      );
      INSERT INTO users (username, password_hash, rank, is_approved, created_at)
      VALUES ('admin', 'hash', 'r5', 1, '2026-01-01');
      INSERT INTO officer_catalog (id, name, type) VALUES ('admiral-nathon', 'Адмирал Нейтон', 'Пехота');
      INSERT INTO officer_catalog (id, name, type) VALUES ('general-rex', 'Генерал Рекс', 'Танки');
      INSERT INTO officer_catalog (id, name, type) VALUES ('captain-black', 'Капитан Блэк', 'Артиллерия');
    `);
    legacyDb.close();

    // Запускаем initDb на существующей БД с 3 офицерами
    dbModule.initDb(testDbPath);

    // Должно остаться ровно 3 офицера (без принудительного перезаписывания) с миграцией колонок
    const catalog = dbModule.getCatalog();
    assert.strictEqual(catalog.length, 3);
    const nathon = catalog.find(o => o.id === 'admiral-nathon');
    assert(nathon);
    assert.strictEqual(nathon.starCouponCost, 360);
    assert.strictEqual(nathon.upgradeType, 'standard');
  } finally {
    try {
      dbModule.getDb().close();
    } catch (e) {}
    try {
      fs.rmSync(testDbDir, { recursive: true, force: true });
    } catch (e) {}
  }
});

test('player CRUD and export/import support star stock fields (starCoupons, legendaryStars1-3)', () => {
  const dbModule = require('./db.js');
  const db = dbModule.initDb(':memory:');

  // 1. Create player with star stock
  const player = dbModule.createPlayer({
    name: 'Звездный Маршал',
    realName: 'Алексей',
    rank: 'r4',
    stock: {
      coupons: 10000,
      puzzles: 50,
      starCoupons: 25000,
      legendaryStars1: 15,
      legendaryStars2: 8,
      legendaryStars3: 3,
      chests: 5
    }
  });

  assert(player.id);
  assert.equal(player.stock.starCoupons, 25000);
  assert.equal(player.stock.legendaryStars1, 15);
  assert.equal(player.stock.legendaryStars2, 8);
  assert.equal(player.stock.legendaryStars3, 3);
  assert.equal(player.stock.coupons, 10000);

  // 2. Fetch by ID
  const fetched = dbModule.getPlayerById(player.id);
  assert.equal(fetched.stock.starCoupons, 25000);
  assert.equal(fetched.stock.legendaryStars1, 15);
  assert.equal(fetched.stock.legendaryStars2, 8);
  assert.equal(fetched.stock.legendaryStars3, 3);

  // 3. Update player star stock
  dbModule.updatePlayer(player.id, {
    stock: {
      starCoupons: 30000,
      legendaryStars1: 20,
      legendaryStars2: 10,
      legendaryStars3: 5
    }
  });

  const updated = dbModule.getPlayerById(player.id);
  assert.equal(updated.stock.starCoupons, 30000);
  assert.equal(updated.stock.legendaryStars1, 20);
  assert.equal(updated.stock.legendaryStars2, 10);
  assert.equal(updated.stock.legendaryStars3, 5);
  // Unmodified stock fields should be preserved from existing
  assert.equal(updated.stock.coupons, 10000);
  assert.equal(updated.stock.puzzles, 50);
  assert.equal(updated.stock.chests, 5);

  // 4. Export / Import roundtrip
  const dump = dbModule.exportKowJson();
  const exportedPlayer = dump.players.find(p => p.id === player.id);
  assert(exportedPlayer);
  assert.equal(exportedPlayer.stock.starCoupons, 30000);
  assert.equal(exportedPlayer.stock.legendaryStars1, 20);
  assert.equal(exportedPlayer.stock.legendaryStars2, 10);
  assert.equal(exportedPlayer.stock.legendaryStars3, 5);

  // Fresh DB and import
  dbModule.initDb(':memory:');
  dbModule.importKowJson(dump);
  const reimported = dbModule.getPlayerById(player.id);
  assert(reimported);
  assert.equal(reimported.stock.starCoupons, 30000);
  assert.equal(reimported.stock.legendaryStars1, 20);
  assert.equal(reimported.stock.legendaryStars2, 10);
  assert.equal(reimported.stock.legendaryStars3, 5);
});

test('players table user_id migration and safe backfill from users.player_id', () => {
  const { DatabaseSync } = require('node:sqlite');
  const dbModule = require('./db.js');
  
  // Создаем базу вручную со старой схемой (без players.user_id)
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      rank TEXT NOT NULL DEFAULT 'r3',
      is_approved INTEGER NOT NULL DEFAULT 1,
      player_id INTEGER NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE players (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      real_name TEXT DEFAULT '',
      rank TEXT NOT NULL DEFAULT 'r3',
      vip_level INTEGER DEFAULT 0,
      vip_points INTEGER NOT NULL DEFAULT 0,
      confidentiality_level INTEGER DEFAULT 0,
      power REAL DEFAULT 0,
      kills REAL DEFAULT 0,
      kill_points REAL DEFAULT 0,
      stock_coupons INTEGER DEFAULT 0,
      stock_puzzles INTEGER DEFAULT 0,
      stock_star_coupons INTEGER NOT NULL DEFAULT 0,
      stock_legendary_stars_1 INTEGER NOT NULL DEFAULT 0,
      stock_legendary_stars_2 INTEGER NOT NULL DEFAULT 0,
      stock_legendary_stars_3 INTEGER NOT NULL DEFAULT 0,
      stock_chests INTEGER DEFAULT 0,
      updated_at TEXT NOT NULL
    );
    INSERT INTO players (id, name, updated_at) VALUES (1, 'Старый Игрок 1', '2026-01-01');
    INSERT INTO players (id, name, updated_at) VALUES (2, 'Старый Игрок 2', '2026-01-01');
    INSERT INTO users (id, username, password_hash, player_id, created_at)
      VALUES (10, 'old_user_1', 'hash', 1, '2026-01-01');
  `);

  // Проверяем, что колонки user_id в players изначально нет
  const colsBefore = db.prepare('PRAGMA table_info(players)').all().map(c => c.name);
  assert.equal(colsBefore.includes('user_id'), false);

  // Вызываем initDb / migrateSchema
  // Для тестирования передаем существующий db или используем initDb
  // В dbModule.initDb(':memory:') создается новая база, поэтому проверим миграцию через временный файл
  const tmpFile = path.join(__dirname, 'data', `kow-migration-test-${Date.now()}.db`);
  try {
    const fileDb = new DatabaseSync(tmpFile);
    fileDb.exec(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        rank TEXT NOT NULL DEFAULT 'r3',
        is_approved INTEGER NOT NULL DEFAULT 1,
        player_id INTEGER NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE players (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        real_name TEXT DEFAULT '',
        rank TEXT NOT NULL DEFAULT 'r3',
        vip_level INTEGER DEFAULT 0,
        vip_points INTEGER NOT NULL DEFAULT 0,
        confidentiality_level INTEGER DEFAULT 0,
        power REAL DEFAULT 0,
        kills REAL DEFAULT 0,
        kill_points REAL DEFAULT 0,
        stock_coupons INTEGER DEFAULT 0,
        stock_puzzles INTEGER DEFAULT 0,
        stock_star_coupons INTEGER NOT NULL DEFAULT 0,
        stock_legendary_stars_1 INTEGER NOT NULL DEFAULT 0,
        stock_legendary_stars_2 INTEGER NOT NULL DEFAULT 0,
        stock_legendary_stars_3 INTEGER NOT NULL DEFAULT 0,
        stock_chests INTEGER DEFAULT 0,
        updated_at TEXT NOT NULL
      );
      INSERT INTO players (id, name, updated_at) VALUES (1, 'Старый Игрок 1', '2026-01-01');
      INSERT INTO players (id, name, updated_at) VALUES (2, 'Старый Игрок 2', '2026-01-01');
      INSERT INTO users (id, username, password_hash, player_id, created_at)
        VALUES (10, 'old_user_1', 'hash', 1, '2026-01-01');
      CREATE TABLE IF NOT EXISTS player_officers (
        id TEXT PRIMARY KEY,
        player_id INTEGER NOT NULL,
        catalog_id TEXT NOT NULL,
        name TEXT NOT NULL,
        level INTEGER NOT NULL DEFAULT 0,
        coupons INTEGER NOT NULL DEFAULT 0,
        stars INTEGER NOT NULL DEFAULT 0,
        skills_json TEXT NOT NULL DEFAULT '[1,1,1,1]'
      );
      CREATE TABLE IF NOT EXISTS officer_catalog (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        generation INTEGER NOT NULL DEFAULT 7,
        coupon_per_puzzle INTEGER NOT NULL DEFAULT 500,
        upgrade_type TEXT NOT NULL DEFAULT 'standard',
        medals_before_training INTEGER DEFAULT 690,
        medals_training INTEGER DEFAULT 900,
        medals_total INTEGER DEFAULT 1590
      );
      CREATE TABLE IF NOT EXISTS event_types (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        color TEXT NOT NULL DEFAULT '#8b5cf6',
        places_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type_id INTEGER NOT NULL,
        date_from TEXT NOT NULL,
        date_to TEXT NOT NULL,
        note TEXT DEFAULT '',
        assignments_json TEXT NOT NULL DEFAULT '[]'
      );
      CREATE TABLE IF NOT EXISTS event_registrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id INTEGER NOT NULL,
        player_id INTEGER NOT NULL,
        officer_id TEXT NOT NULL,
        desired_place INTEGER NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS stock_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        player_id INTEGER NOT NULL,
        date TEXT NOT NULL,
        coupons INTEGER NOT NULL,
        puzzles INTEGER NOT NULL,
        chests INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT
      );
    `);
    fileDb.close();

    // Запускаем initDb на этом файле
    const migratedDb = dbModule.initDb(tmpFile);
    const colsAfter = migratedDb.prepare('PRAGMA table_info(players)').all().map(c => c.name);
    assert(colsAfter.includes('user_id'), 'players table must have user_id column');

    // Проверяем, что связь безопасно перенесена
    const p1 = migratedDb.prepare('SELECT user_id FROM players WHERE id = 1').get();
    assert.equal(p1.user_id, 10, 'players id=1 should have user_id=10 from users.player_id');

    const p2 = migratedDb.prepare('SELECT user_id FROM players WHERE id = 2').get();
    assert.equal(p2.user_id, null, 'players id=2 should have user_id=null');
  } finally {
    try { fs.unlinkSync(tmpFile); } catch (e) {}
  }
});

test('getPlayers and getPlayerById enrich sector with userId, username, userRank', () => {
  const dbModule = require('./db.js');
  dbModule.initDb(':memory:');

  // Админ привязан к первому сектору (Командор)
  const players = dbModule.getPlayers();
  assert(players.length > 0);
  const p1 = players.find(p => p.id === 1);
  assert(p1);
  assert.equal(p1.userId, 1);
  assert.equal(p1.username, 'admin');
  assert.equal(p1.userRank, 'r5');

  // getPlayerById(1)
  const single = dbModule.getPlayerById(1);
  assert(single);
  assert.equal(single.userId, 1);
  assert.equal(single.username, 'admin');
  assert.equal(single.userRank, 'r5');

  // Сектор без владельца (id: 2)
  const p2 = dbModule.getPlayerById(2);
  assert(p2);
  assert.equal(p2.userId, null);
  assert.equal(p2.username, null);
  assert.equal(p2.userRank, null);
});

test('getPlayersByUserId returns all sectors owned by user', () => {
  const dbModule = require('./db.js');
  dbModule.initDb(':memory:');

  const reg = dbModule.registerUser({ username: 'multisector_user', password: 'pwd', playerName: 'База 1' });
  dbModule.approveUser(reg.userId, 'r3');

  // Создаем второй сектор для этого же пользователя
  const sec2 = dbModule.createPlayer({
    name: 'База 2 (Ферма)',
    userId: reg.userId,
    stock: { coupons: 500 }
  });

  const sectors = dbModule.getPlayersByUserId(reg.userId);
  assert.equal(sectors.length, 2);
  assert(sectors.some(s => s.name === 'База 1'));
  assert(sectors.some(s => s.name === 'База 2 (Ферма)'));
  assert.equal(sectors[0].userId, reg.userId);
  assert.equal(sectors[0].username, 'multisector_user');
  assert.equal(sectors[1].userId, reg.userId);

  // Несуществующий пользователь возвращает пустой массив
  const empty = dbModule.getPlayersByUserId(99999);
  assert.deepEqual(empty, []);
});

test('setUserActiveSector switches active player_id only if user owns the sector', () => {
  const dbModule = require('./db.js');
  dbModule.initDb(':memory:');

  const reg = dbModule.registerUser({ username: 'activesec_user', password: 'pwd', playerName: 'Мейн' });
  dbModule.approveUser(reg.userId, 'r3');

  const farm = dbModule.createPlayer({
    name: 'Ферма',
    userId: reg.userId
  });

  // Успешная смена активного сектора на Ферму
  const resSuccess = dbModule.setUserActiveSector(reg.userId, farm.id);
  assert.equal(resSuccess.ok, true);
  assert.equal(resSuccess.activeSectorId, farm.id);

  const user = dbModule.findUserById(reg.userId);
  assert.equal(user.player_id, farm.id);

  // Попытка переключиться на чужой сектор (например, сектор админа id: 1)
  const resFail = dbModule.setUserActiveSector(reg.userId, 1);
  assert.equal(resFail.ok, false);
  assert.equal(resFail.error, 'NOT_OWNER');

  // Активный сектор остался прежним
  const userUnchanged = dbModule.findUserById(reg.userId);
  assert.equal(userUnchanged.player_id, farm.id);
});

test('registerUser supports registration without sector (Сделать позже) and with sector', () => {
  const dbModule = require('./db.js');
  dbModule.initDb(':memory:');

  const playersCountBefore = dbModule.getPlayers().length;

  // 1. Без сектора
  const regNoSector = dbModule.registerUser({ username: 'lazy_user', password: 'pwd' });
  assert.equal(regNoSector.playerId, null);
  assert.equal(regNoSector.player_id, null);
  const playersCountAfter1 = dbModule.getPlayers().length;
  assert.equal(playersCountAfter1, playersCountBefore, 'no sector should be created');

  const userInDb = dbModule.findUserById(regNoSector.userId);
  assert.equal(userInDb.player_id, null);

  // 2. С созданием сектора
  const regWithSector = dbModule.registerUser({ username: 'active_user', password: 'pwd', playerName: 'Новая База' });
  assert(regWithSector.playerId);
  const createdSector = dbModule.getPlayerById(regWithSector.playerId);
  assert.equal(createdSector.name, 'Новая База');
  assert.equal(createdSector.userId, regWithSector.userId);
  assert.equal(createdSector.username, 'active_user');

  const userWithSectorInDb = dbModule.findUserById(regWithSector.userId);
  assert.equal(userWithSectorInDb.player_id, regWithSector.playerId);
});

test('updatePlayer updates sector userId to reassign or unassign owner', () => {
  const dbModule = require('./db.js');
  dbModule.initDb(':memory:');

  const reg = dbModule.registerUser({ username: 'owner_user', password: 'pwd', playerName: 'База Владельца' });
  const sectorId = reg.playerId;

  // Создаем другого пользователя
  const reg2 = dbModule.registerUser({ username: 'new_owner', password: 'pwd' });

  // Переназначаем владельца
  dbModule.updatePlayer(sectorId, { userId: reg2.userId });
  const updated = dbModule.getPlayerById(sectorId);
  assert.equal(updated.userId, reg2.userId);
  assert.equal(updated.username, 'new_owner');

  // Отвязываем владельца (userId: null)
  dbModule.updatePlayer(sectorId, { userId: null });
  const unlinked = dbModule.getPlayerById(sectorId);
  assert.equal(unlinked.userId, null);
  assert.equal(unlinked.username, null);
});

test('exportKowJson and importKowJson preserve sector userId', () => {
  const dbModule = require('./db.js');
  dbModule.initDb(':memory:');

  const reg = dbModule.registerUser({ username: 'export_user', password: 'pwd', playerName: 'Экспортный Сектор' });
  const sectorId = reg.playerId;

  // Создаем еще один сектор с несуществующим пользователем в будущем
  const sectorGhost = dbModule.createPlayer({ name: 'Сектор Призрака', userId: 1 });

  const exported = dbModule.exportKowJson();
  const exportedSector = exported.players.find(p => p.id === sectorId);
  assert(exportedSector);
  assert.equal(exportedSector.userId, reg.userId);

  // Импорт в новую базу, где админ (userId=1) существует, а export_user зарегистрирован
  dbModule.initDb(':memory:');
  const regInNewDb = dbModule.registerUser({ username: 'export_user', password: 'pwd' });
  assert.equal(regInNewDb.userId, reg.userId);

  dbModule.importKowJson(exported);

  const reimportedSector = dbModule.getPlayerById(sectorId);
  assert(reimportedSector);
  assert.equal(reimportedSector.userId, reg.userId);

  const reimportedGhost = dbModule.getPlayerById(sectorGhost.id);
  assert(reimportedGhost);
  assert.equal(reimportedGhost.userId, 1);
});

test('importKowJson safely handles sector with non-existent userId without crashing', () => {
  const dbModule = require('./db.js');
  dbModule.initDb(':memory:');

  const payload = {
    version: 3,
    players: [
      { id: 99, name: 'Сектор без пользователя в целевой БД', userId: 9999 }
    ]
  };

  // Не должно выбрасывать FOREIGN KEY constraint failed
  dbModule.importKowJson(payload);
  const imported = dbModule.getPlayerById(99);
  assert(imported);
  assert.equal(imported.userId, null);
});

test('vip tiers initialized by default with 30 levels and VIP 14 is 750000 points', () => {
  const dbModule = require('./db.js');
  dbModule.initDb(':memory:');

  const tiers = dbModule.getVipTiers();
  assert.equal(Array.isArray(tiers), true);
  assert.equal(tiers.length, 30);

  const vip14 = tiers.find(t => t.level === 14);
  assert(vip14);
  assert.equal(vip14.points, 750000);
  assert.equal(vip14.dailyPuzzles, 3);
  assert.equal(vip14.dailyChests, 1);

  const vip1 = tiers.find(t => t.level === 1);
  assert.equal(vip1.points, 0);

  const vip30 = tiers.find(t => t.level === 30);
  assert(vip30);
  assert(vip30.points > 750000);
});

test('setVipTiers validates and updates VIP tiers points and daily rewards', () => {
  const dbModule = require('./db.js');
  dbModule.initDb(':memory:');

  const updatedTiers = [
    { level: 1, points: 0, dailyPuzzles: 0, dailyChests: 1 },
    { level: 14, points: 760000, dailyPuzzles: 4, dailyChests: 1 },
    { level: 30, points: 50000000, dailyPuzzles: 15, dailyChests: 2 }
  ];

  dbModule.setVipTiers(updatedTiers);
  const tiers = dbModule.getVipTiers();
  const v14 = tiers.find(t => t.level === 14);
  assert.equal(v14.points, 760000);
  assert.equal(v14.dailyPuzzles, 4);
});

test('catalog officer supports star_coupon_cost, medals before/training, total sum and default values (480, 900, 1380)', () => {
  const dbModule = require('./db.js');
  dbModule.initDb(':memory:');

  // Сохраняем офицера с дефолтными значениями
  const saved = dbModule.saveCatalogItem({
    id: 'officer-po',
    name: 'По',
    type: 'Танк',
    generation: 8,
    couponPerPuzzle: 720,
    starCouponCost: 360
  });

  assert.equal(saved.medalsBeforeTraining, 690);
  assert.equal(saved.medalsTraining, 900);
  assert.equal(saved.medalsTotal, 1590);
  assert.equal(saved.starCouponCost, 360);
  assert.equal(saved.couponPerPuzzle, 720);

  const catalog = dbModule.getCatalog();
  const po = catalog.find(o => o.id === 'officer-po');
  assert(po);
  assert.equal(po.name, 'По');
  assert.equal(po.medalsBeforeTraining, 690);
  assert.equal(po.medalsTraining, 900);
  assert.equal(po.medalsTotal, 1590);
  assert.equal(po.starCouponCost, 360);

  // Редактируем с кастомными медалями
  dbModule.saveCatalogItem({
    id: 'officer-po',
    name: 'По (кастомный)',
    type: 'Танк',
    generation: 8,
    couponPerPuzzle: 720,
    starCouponCost: 360,
    medalsBeforeTraining: 500,
    medalsTraining: 1000
  });

  const updatedPo = dbModule.getCatalog().find(o => o.id === 'officer-po');
  assert.equal(updatedPo.medalsBeforeTraining, 500);
  assert.equal(updatedPo.medalsTraining, 1000);
  assert.equal(updatedPo.medalsTotal, 1500);
});

test('catalog does not re-seed deleted officers on db reload and clearCatalog clears all', () => {
  const dbModule = require('./db.js');
  dbModule.initDb(':memory:');

  dbModule.saveCatalogItem({
    id: 'temp-officer',
    name: 'Временный',
    type: 'Пехота'
  });
  assert(dbModule.getCatalog().length >= 1);

  dbModule.clearCatalog();
  assert.equal(dbModule.getCatalog().length, 0);

  // При повторном initDb на той же базе удаленные офицеры не должны воскресать
  const testDbDir = path.join(__dirname, 'test-db-catalog-' + Date.now());
  const testDbPath = path.join(testDbDir, 'kow.db');
  fs.mkdirSync(testDbDir, { recursive: true });
  try {
    const db1 = dbModule.initDb(testDbPath);
    dbModule.clearCatalog();
    assert.equal(dbModule.getCatalog().length, 0);
    db1.close();

    const db2 = dbModule.initDb(testDbPath);
    assert.equal(dbModule.getCatalog().length, 0);
    db2.close();
  } finally {
    try {
      fs.rmSync(testDbDir, { recursive: true, force: true });
    } catch (e) {}
  }
});

test('isDefaultAdminPassword tracks admin password changes correctly', () => {
  const dbModule = require('./db.js');
  dbModule.initDb(':memory:');

  assert.strictEqual(dbModule.isDefaultAdminPassword(), true, 'Initially admin has default password admin123');

  const admin = dbModule.findUserByUsername('admin');
  assert.ok(admin);

  dbModule.changePassword(admin.id, 'MyNewSecretPass2026!');
  assert.strictEqual(dbModule.isDefaultAdminPassword(), false, 'isDefaultAdminPassword returns false after password change');
});

test('player officers store and retrieve invested resources across CRUD and export/import', () => {
  const dbModule = require('./db.js');
  dbModule.initDb(':memory:');

  const p = dbModule.createPlayer({ name: 'Тестовый сектор' });
  assert.ok(p && p.id);

  // Добавляем офицера с вложенными ресурсами
  const off = dbModule.addPlayerOfficer(p.id, {
    catalogId: 'admiral-nathon',
    name: 'Адмирал Нейтон',
    stars: 6,
    level: 180,
    skills: [5, 5, 5, 5],
    invested: {
      starCoupons: 253000,
      legendaryStars3: 6,
      coupons: 12000,
      puzzles: 30
    }
  });

  assert.strictEqual(off.invested.starCoupons, 253000);
  assert.strictEqual(off.invested.legendaryStars3, 6);
  assert.strictEqual(off.invested.coupons, 12000);
  assert.strictEqual(off.invested.puzzles, 30);
  assert.strictEqual(off.invested.legendaryStars1, 0);

  // Проверяем получение через getPlayerById
  const pLoaded = dbModule.getPlayerById(p.id);
  const offLoaded = pLoaded.officers.find(o => o.id === off.id);
  assert.ok(offLoaded);
  assert.strictEqual(offLoaded.invested.starCoupons, 253000);
  assert.strictEqual(offLoaded.invested.legendaryStars3, 6);

  // Обновляем офицера
  const offUpdated = dbModule.updatePlayerOfficer(p.id, off.id, {
    stars: 0,
    invested: {
      starCoupons: 0,
      legendaryStars3: 0,
      coupons: 0,
      puzzles: 0
    }
  });
  assert.strictEqual(offUpdated.stars, 0);
  assert.strictEqual(offUpdated.invested.starCoupons, 0);
  assert.strictEqual(offUpdated.invested.legendaryStars3, 0);

  // Проверяем exportKowJson / importKowJson
  dbModule.updatePlayerOfficer(p.id, off.id, {
    invested: { starCoupons: 9999 }
  });
  const exported = dbModule.exportKowJson();
  dbModule.initDb(':memory:');
  dbModule.importKowJson(exported);

  const importedPlayer = dbModule.getPlayerById(p.id);
  const importedOff = importedPlayer.officers.find(o => o.id === off.id);
  assert.ok(importedOff);
  assert.strictEqual(importedOff.invested.starCoupons, 9999);
});

test('event_types supports schedule cadence fields and migration', () => {
  const dbModule = require('./db.js');
  dbModule.initDb(':memory:');

  const types = dbModule.getEventTypes();
  assert.ok(types.length >= 3);

  const kow = types.find(t => t.name === 'Король Войны');
  assert.ok(kow);
  assert.strictEqual(kow.startDayOfWeek, 2);
  assert.strictEqual(kow.endDayOfWeek, 3);
  assert.strictEqual(kow.isPeriodic, 1);

  const mf = types.find(t => t.name === 'Мощные Силы');
  assert.ok(mf);
  assert.strictEqual(mf.startDayOfWeek, 6);
  assert.strictEqual(mf.endDayOfWeek, 1); // Переход через выходные

  const pot = types.find(t => t.name === 'Сила Времени');
  assert.ok(pot);
  assert.strictEqual(pot.startDayOfWeek, 2);
  assert.strictEqual(pot.endDayOfWeek, 4);
  assert.strictEqual(pot.weekOffset, 1);

  // Сохранение нового типа ивента с полями расписания
  const created = dbModule.saveEventType({
    name: 'Битва Альянсов',
    color: '#3b82f6',
    isPeriodic: 1,
    startDayOfWeek: 5,
    endDayOfWeek: 7,
    activeWeeks: 2,
    breakWeeks: 1,
    weekOffset: 0,
    places: [{ place: 1, label: '1 место', coupons: 15000 }]
  });

  assert.ok(created.id);
  const allUpdated = dbModule.getEventTypes();
  const found = allUpdated.find(t => t.id === created.id);
  assert.ok(found);
  assert.strictEqual(found.startDayOfWeek, 5);
  assert.strictEqual(found.endDayOfWeek, 7);
  assert.strictEqual(found.activeWeeks, 2);
  assert.strictEqual(found.breakWeeks, 1);
});

test('updateBulkEventTypeRewards updates prizes across selected event types', () => {
  const dbModule = require('./db.js');
  dbModule.initDb(':memory:');

  const types = dbModule.getEventTypes();
  const typeIds = types.slice(0, 2).map(t => t.id);

  const newPlaces = [
    { place: 1, label: '🥇 1 место', coupons: 20000 },
    { place: 2, label: '🥈 2 место', coupons: 10000 }
  ];

  const updatedCount = dbModule.updateBulkEventTypeRewards(typeIds, newPlaces);
  assert.strictEqual(updatedCount, 2);

  const refreshed = dbModule.getEventTypes();
  for (const tid of typeIds) {
    const et = refreshed.find(t => t.id === tid);
    assert.ok(et);
    assert.strictEqual(et.places.length, 2);
    assert.strictEqual(et.places[0].coupons, 20000);
    assert.strictEqual(et.places[1].coupons, 10000);
  }
});

test('player_officers stores, updates and exports personal_puzzles', () => {
  const dbModule = require('./db.js');
  dbModule.initDb(':memory:');

  const p = dbModule.createPlayer({ name: 'Командир Танков' });
  const off = dbModule.addPlayerOfficer(p.id, {
    catalogId: 'admiral-nathon',
    name: 'Адмирал Нейтон',
    stars: 3,
    level: 40,
    coupons: 1200,
    personalPuzzles: 45
  });

  assert.strictEqual(off.personalPuzzles, 45);

  const pLoaded = dbModule.getPlayerById(p.id);
  const offLoaded = pLoaded.officers.find(o => o.id === off.id);
  assert.ok(offLoaded);
  assert.strictEqual(offLoaded.personalPuzzles, 45);

  // Обновление
  const updated = dbModule.updatePlayerOfficer(p.id, off.id, {
    personalPuzzles: 60
  });
  assert.strictEqual(updated.personalPuzzles, 60);

  // Экспорт / импорт
  const exported = dbModule.exportKowJson();
  dbModule.initDb(':memory:');
  dbModule.importKowJson(exported);

  const importedPlayer = dbModule.getPlayerById(p.id);
  const importedOff = importedPlayer.officers.find(o => o.id === off.id);
  assert.ok(importedOff);
  assert.strictEqual(importedOff.personalPuzzles, 60);
});

test('player_officers stores, updates and exports only_personal_puzzles setting', () => {
  const dbModule = require('./db.js');
  dbModule.initDb(':memory:');

  const p = dbModule.createPlayer({ name: 'Генерал Базы' });
  const off = dbModule.addPlayerOfficer(p.id, {
    catalogId: 'angel',
    name: 'Анхель',
    stars: 5,
    level: 102,
    personalPuzzles: 169,
    onlyPersonalPuzzles: true
  });

  assert.strictEqual(off.onlyPersonalPuzzles, true);

  const pLoaded = dbModule.getPlayerById(p.id);
  const offLoaded = pLoaded.officers.find(o => o.id === off.id);
  assert.ok(offLoaded);
  assert.strictEqual(offLoaded.onlyPersonalPuzzles, true);

  // Обновление на false
  const updated = dbModule.updatePlayerOfficer(p.id, off.id, {
    onlyPersonalPuzzles: false
  });
  assert.strictEqual(updated.onlyPersonalPuzzles, false);

  // Обратно на true и проверка экспорт/импорт
  dbModule.updatePlayerOfficer(p.id, off.id, { onlyPersonalPuzzles: true });
  const exported = dbModule.exportKowJson();
  dbModule.initDb(':memory:');
  dbModule.importKowJson(exported);

  const importedPlayer = dbModule.getPlayerById(p.id);
  const importedOff = importedPlayer.officers.find(o => o.id === off.id);
  assert.ok(importedOff);
  assert.strictEqual(importedOff.onlyPersonalPuzzles, true);
});

test('users table migration adds permissions column with default [] in legacy database', () => {
  const { DatabaseSync } = require('node:sqlite');
  const testDbDir = path.join('/tmp', 'kow-permissions-' + Date.now());
  const testDbPath = path.join(testDbDir, 'permissions_legacy.db');
  fs.mkdirSync(testDbDir, { recursive: true });

  try {
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
      INSERT INTO users (username, password_hash, rank, is_approved, created_at)
      VALUES ('legacy_admin', 'hash123', 'r5', 1, '2026-01-01');
    `);
    legacyDb.close();

    const dbModule = require('./db.js');
    dbModule.initDb(testDbPath);

    const userCols = dbModule.getDb().prepare("PRAGMA table_info(users)").all().map(c => c.name);
    assert.ok(userCols.includes('permissions'), 'users table must have permissions column');

    const user = dbModule.findUserByUsername('legacy_admin');
    assert.ok(user, 'user should be found');
    assert.deepStrictEqual(user.permissions, [], 'legacy user should have default empty permissions array');
  } finally {
    try { fs.rmSync(testDbDir, { recursive: true, force: true }); } catch (e) {}
  }
});

test('updateUser saves, persists and returns parsed permissions', () => {
  const dbModule = require('./db.js');
  dbModule.initDb(':memory:');

  const reg = dbModule.registerUser({ username: 'tactician_r3', password: 'password123', playerName: 'Тактик' });
  dbModule.approveUser(reg.userId, 'r3');

  const initial = dbModule.findUserById(reg.userId);
  assert.deepStrictEqual(initial.permissions, []);

  // Обновление прав
  const permsToSet = ['view_sectors', 'manage_events'];
  const updated = dbModule.updateUser(reg.userId, { permissions: permsToSet });
  assert.deepStrictEqual(updated.permissions, permsToSet);

  // Проверка из findUserById
  const reFetched = dbModule.findUserById(reg.userId);
  assert.deepStrictEqual(reFetched.permissions, permsToSet);

  // Проверка прямого чтения из базы (сохранено как JSON-строка)
  const rawRow = dbModule.getDb().prepare('SELECT permissions FROM users WHERE id = ?').get(reg.userId);
  assert.strictEqual(rawRow.permissions, JSON.stringify(permsToSet));

  // Очистка прав
  const cleared = dbModule.updateUser(reg.userId, { permissions: [] });
  assert.deepStrictEqual(cleared.permissions, []);
  assert.deepStrictEqual(dbModule.findUserById(reg.userId).permissions, []);
});

test('verifySession returns parsed permissions of authenticated user', () => {
  const dbModule = require('./db.js');
  dbModule.initDb(':memory:');

  const reg = dbModule.registerUser({ username: 'analyst_r3', password: 'password123', playerName: 'Аналитик' });
  dbModule.approveUser(reg.userId, 'r3');
  dbModule.updateUser(reg.userId, { permissions: ['view_sectors', 'view_stocks', 'view_matrix'] });

  const token = dbModule.createSession(reg.userId);
  const sessionUser = dbModule.verifySession(token);
  assert.ok(sessionUser);
  assert.strictEqual(sessionUser.username, 'analyst_r3');
  assert.deepStrictEqual(sessionUser.permissions, ['view_sectors', 'view_stocks', 'view_matrix']);
});

test('getUsers and getPendingUsers return permissions as parsed array', () => {
  const dbModule = require('./db.js');
  dbModule.initDb(':memory:');

  // Pending user
  const regPending = dbModule.registerUser({ username: 'pending_user', password: 'pwd', playerName: 'Новичок' });
  const pendingUsers = dbModule.getPendingUsers();
  const foundPending = pendingUsers.find(u => u.username === 'pending_user');
  assert.ok(foundPending);
  assert.deepStrictEqual(foundPending.permissions, []);

  // Approved user with permissions
  dbModule.approveUser(regPending.userId, 'r3');
  dbModule.updateUser(regPending.userId, { permissions: ['approve_users'] });

  const allUsers = dbModule.getUsers();
  const foundApproved = allUsers.find(u => u.username === 'pending_user');
  assert.ok(foundApproved);
  assert.deepStrictEqual(foundApproved.permissions, ['approve_users']);
});

test('exportKowJson includes userPermissions and importKowJson safely restores them without touching passwords', () => {
  const dbModule = require('./db.js');
  dbModule.initDb(':memory:');

  const reg = dbModule.registerUser({ username: 'hr_specialist', password: 'original_password', playerName: 'Кадровик' });
  dbModule.approveUser(reg.userId, 'r3');
  dbModule.updateUser(reg.userId, { permissions: ['view_sectors', 'approve_users'] });

  // 1. Export check
  const exported = dbModule.exportKowJson();
  assert.ok(exported.userPermissions, 'export must include userPermissions');
  assert.deepStrictEqual(exported.userPermissions['hr_specialist'], ['view_sectors', 'approve_users']);
  // Safe export: no passwords
  assert.strictEqual(JSON.stringify(exported).includes('original_password'), false);
  assert.strictEqual(JSON.stringify(exported).includes('password_hash'), false);

  // 2. Re-import into a DB where hr_specialist exists but has different permissions
  dbModule.updateUser(reg.userId, { permissions: [] });
  assert.deepStrictEqual(dbModule.findUserById(reg.userId).permissions, []);

  // Import should restore permissions
  dbModule.importKowJson(exported);
  const reloadedUser = dbModule.findUserById(reg.userId);
  assert.deepStrictEqual(reloadedUser.permissions, ['view_sectors', 'approve_users']);

  // Password still works
  const loginResult = dbModule.loginUser('hr_specialist', 'original_password');
  assert.ok(loginResult.token, 'login must succeed with original password after import');

  // 3. Import with unknown users should not create new users
  const countBefore = dbModule.getUsers().length;
  dbModule.importKowJson({
    ...exported,
    userPermissions: {
      hr_specialist: ['view_sectors'],
      phantom_user: ['all']
    }
  });
  const countAfter = dbModule.getUsers().length;
  assert.strictEqual(countAfter, countBefore, 'unknown users in userPermissions must not create new accounts');
  assert.strictEqual(dbModule.findUserByUsername('phantom_user'), null);
});

test('importKowJson handles legacy dumps without userPermissions gracefully', () => {
  const dbModule = require('./db.js');
  dbModule.initDb(':memory:');

  const reg = dbModule.registerUser({ username: 'custom_user', password: 'pwd', playerName: 'Игрок' });
  dbModule.approveUser(reg.userId, 'r3');
  dbModule.updateUser(reg.userId, { permissions: ['view_stocks'] });

  // Legacy backup payload without userPermissions
  const legacyDump = {
    version: 2,
    players: [],
    officerCatalog: [],
    eventTypes: [],
    events: [],
    stockHistory: []
  };

  dbModule.importKowJson(legacyDump);

  // Existing user permissions must not be erased
  const user = dbModule.findUserById(reg.userId);
  assert.deepStrictEqual(user.permissions, ['view_stocks']);
});




