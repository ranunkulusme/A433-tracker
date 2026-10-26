const { DatabaseSync } = require('node:sqlite');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { DEFAULT_OFFICERS, COMMUNITY_OFFICERS, migrateState } = require('./logic.js');

let currentDb = null;

function getDb() {
  if (!currentDb) {
    initDb();
  }
  return currentDb;
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const buf = crypto.scryptSync(password, salt, 64);
  return `${salt}:${buf.toString('hex')}`;
}

function verifyPassword(password, hash) {
  if (!hash || !password || typeof hash !== 'string' || !hash.includes(':')) return false;
  const [salt, key] = hash.split(':');
  if (!salt || !key) return false;
  try {
    const keyBuffer = Buffer.from(key, 'hex');
    const derived = crypto.scryptSync(password, salt, keyBuffer.length);
    return crypto.timingSafeEqual(keyBuffer, derived);
  } catch (e) {
    return false;
  }
}

function createSession(userId, token = null) {
  const sessionToken = token || crypto.randomBytes(32).toString('hex');
  const createdAt = new Date().toISOString();
  getDb().prepare('INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)').run(sessionToken, userId, createdAt);
  return sessionToken;
}

function verifySession(token) {
  if (!token) return null;
  const row = getDb().prepare(`
    SELECT s.token, s.user_id, s.created_at, s.expires_at,
           u.id, u.username, u.rank, u.is_approved, u.player_id,
           p.name as player_name
    FROM sessions s
    JOIN users u ON s.user_id = u.id
    LEFT JOIN players p ON u.player_id = p.id
    WHERE s.token = ?
  `).get(token);
  if (!row || row.is_approved !== 1) return null;
  return {
    id: row.id,
    username: row.username,
    rank: row.rank,
    is_approved: row.is_approved,
    playerId: row.player_id,
    player_id: row.player_id,
    playerName: row.player_name || ''
  };
}

function deleteSession(token) {
  getDb().prepare('DELETE FROM sessions WHERE token = ?').run(token);
  return true;
}

function clearUserSessions(userId) {
  getDb().prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
  return true;
}

function findUserByUsername(username) {
  if (!username) return null;
  const user = getDb().prepare('SELECT * FROM users WHERE LOWER(username) = LOWER(?)').get(username);
  return user || null;
}

function findUserById(id) {
  const user = getDb().prepare('SELECT * FROM users WHERE id = ?').get(id);
  return user || null;
}

function registerUser({ username, password, playerId, playerName }) {
  const db = getDb();
  const existing = findUserByUsername(username);
  if (existing) {
    return { error: 'USERNAME_TAKEN', message: 'Имя пользователя уже занято' };
  }

  let assignedPlayerId = null;
  if (playerId !== undefined && playerId !== null && playerId !== '') {
    assignedPlayerId = Number(playerId);
    const player = db.prepare('SELECT id, user_id FROM players WHERE id = ?').get(assignedPlayerId);
    if (!player) {
      return { error: 'PLAYER_NOT_FOUND', message: 'Игрок не найден' };
    }
    const alreadyLinked = db.prepare('SELECT id FROM users WHERE player_id = ?').get(assignedPlayerId);
    if (alreadyLinked || player.user_id) {
      return { error: 'PLAYER_ALREADY_LINKED', message: 'Этот персонаж уже привязан к другому аккаунту' };
    }
  }

  const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
  const isFirstUser = userCount === 0;
  const rank = isFirstUser ? 'r5' : 'r3';
  const isApproved = isFirstUser ? 1 : 0;

  const hash = hashPassword(password);
  const now = new Date().toISOString();
  const res = db.prepare(`
    INSERT INTO users (username, password_hash, rank, is_approved, player_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(username, hash, rank, isApproved, assignedPlayerId, now);

  const userId = Number(res.lastInsertRowid);

  if (assignedPlayerId) {
    db.prepare('UPDATE players SET user_id = ? WHERE id = ?').run(userId, assignedPlayerId);
  } else if (playerName) {
    const createdPlayer = createPlayer({
      name: playerName,
      rank,
      userId
    });
    assignedPlayerId = createdPlayer.id;
    db.prepare('UPDATE users SET player_id = ? WHERE id = ?').run(assignedPlayerId, userId);
  }

  return {
    userId,
    id: userId,
    username,
    rank,
    is_approved: isApproved,
    playerId: assignedPlayerId,
    player_id: assignedPlayerId,
    pendingApproval: isApproved === 0
  };
}

function loginUser(username, password) {
  const user = findUserByUsername(username);
  if (!user) {
    return { error: 'INVALID_CREDENTIALS' };
  }
  if (!verifyPassword(password, user.password_hash)) {
    return { error: 'INVALID_CREDENTIALS' };
  }
  if (user.is_approved === 0) {
    return { error: 'PENDING_APPROVAL' };
  }
  const token = createSession(user.id);
  let playerName = '';
  if (user.player_id) {
    const player = getPlayerById(user.player_id);
    if (player) playerName = player.name;
  }
  return {
    token,
    user: {
      id: user.id,
      username: user.username,
      rank: user.rank,
      is_approved: user.is_approved,
      playerId: user.player_id,
      player_id: user.player_id,
      playerName
    }
  };
}

function approveUser(userId, rank = 'r3') {
  const db = getDb();
  db.prepare('UPDATE users SET is_approved = 1, rank = ? WHERE id = ?').run(rank, userId);
  const user = findUserById(userId);
  if (user && user.player_id) {
    db.prepare('UPDATE players SET rank = ? WHERE id = ?').run(rank, user.player_id);
  }
  return user;
}

function rejectUser(userId) {
  const db = getDb();
  db.prepare('DELETE FROM users WHERE id = ?').run(userId);
  return true;
}

function getPendingUsers() {
  const db = getDb();
  return db.prepare(`
    SELECT u.id, u.username, u.rank, u.is_approved, u.player_id as playerId, u.player_id,
           u.created_at as createdAt, u.created_at,
           p.name as playerName
    FROM users u
    LEFT JOIN players p ON u.player_id = p.id
    WHERE u.is_approved = 0
    ORDER BY u.id ASC
  `).all();
}

function getUsers() {
  const db = getDb();
  return db.prepare(`
    SELECT u.id, u.username, u.rank, u.is_approved, u.player_id as playerId, u.player_id,
           u.created_at as createdAt, u.created_at,
           p.name as playerName
    FROM users u
    LEFT JOIN players p ON u.player_id = p.id
    ORDER BY u.id ASC
  `).all();
}

function updateUser(userId, updates = {}) {
  const db = getDb();
  const existing = findUserById(userId);
  if (!existing) return null;
  const rank = updates.rank !== undefined ? updates.rank : existing.rank;
  const isApproved = updates.is_approved !== undefined ? updates.is_approved : existing.is_approved;
  const playerId = updates.player_id !== undefined ? updates.player_id : (updates.playerId !== undefined ? updates.playerId : existing.player_id);

  db.prepare(`
    UPDATE users SET rank = ?, is_approved = ?, player_id = ? WHERE id = ?
  `).run(rank, isApproved, playerId, userId);

  return findUserById(userId);
}

function changePassword(userId, newPassword) {
  const db = getDb();
  const hash = hashPassword(newPassword);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, userId);
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
  return true;
}

// ─── PLAYERS & OFFICERS ──────────────────────────────────────
function parseSkills(skillsData) {
  let skills = [1, 1, 1, 1];
  if (Array.isArray(skillsData) && skillsData.length === 4) {
    skills = skillsData.map(n => Math.max(1, Math.min(5, Number(n) || 1)));
  } else if (typeof skillsData === 'string') {
    try {
      const parsed = JSON.parse(skillsData);
      if (Array.isArray(parsed) && parsed.length === 4) {
        skills = parsed.map(n => Math.max(1, Math.min(5, Number(n) || 1)));
      }
    } catch (e) {}
  }
  return skills;
}

function getCandidatePlayers() {
  const db = getDb();
  return db.prepare(`
    SELECT id, name, real_name as realName
    FROM players
    WHERE user_id IS NULL AND id NOT IN (SELECT player_id FROM users WHERE player_id IS NOT NULL)
    ORDER BY name COLLATE NOCASE ASC
  `).all();
}

function getPlayers() {
  const db = getDb();
  const playerRows = db.prepare(`
    SELECT p.*, u.username as owner_username, u.rank as owner_rank
    FROM players p
    LEFT JOIN users u ON u.id = p.user_id
    ORDER BY p.id ASC
  `).all();
  const officerRows = db.prepare('SELECT * FROM player_officers ORDER BY rowid ASC').all();
  const officersByPlayer = new Map();
  for (const o of officerRows) {
    if (!officersByPlayer.has(o.player_id)) officersByPlayer.set(o.player_id, []);
    officersByPlayer.get(o.player_id).push({
      id: o.id,
      catalogId: o.catalog_id,
      name: o.name,
      level: o.level,
      coupons: o.coupons,
      stars: o.stars,
      skills: parseSkills(o.skills_json)
    });
  }

  return playerRows.map(p => ({
    id: p.id,
    name: p.name,
    realName: p.real_name || '',
    rank: p.rank || 'r3',
    userId: p.user_id || null,
    username: p.owner_username || null,
    userRank: p.owner_rank || null,
    sector: {
      vipLevel: p.vip_level || 0,
      vipPoints: p.vip_points || 0,
      confidentialityLevel: p.confidentiality_level || 0,
      power: p.power || 0,
      kills: p.kills || 0,
      killPoints: p.kill_points || p.kills || 0
    },
    stock: {
      coupons: p.stock_coupons || 0,
      puzzles: p.stock_puzzles || 0,
      starCoupons: p.stock_star_coupons || 0,
      legendaryStars1: p.stock_legendary_stars_1 || 0,
      legendaryStars2: p.stock_legendary_stars_2 || 0,
      legendaryStars3: p.stock_legendary_stars_3 || 0,
      chests: p.stock_chests || 0
    },
    officers: officersByPlayer.get(p.id) || []
  }));
}

function getPlayerById(id) {
  const db = getDb();
  const p = db.prepare(`
    SELECT p.*, u.username as owner_username, u.rank as owner_rank
    FROM players p
    LEFT JOIN users u ON u.id = p.user_id
    WHERE p.id = ?
  `).get(id);
  if (!p) return null;
  const officerRows = db.prepare('SELECT * FROM player_officers WHERE player_id = ? ORDER BY rowid ASC').all(id);
  return {
    id: p.id,
    name: p.name,
    realName: p.real_name || '',
    rank: p.rank || 'r3',
    userId: p.user_id || null,
    username: p.owner_username || null,
    userRank: p.owner_rank || null,
    sector: {
      vipLevel: p.vip_level || 0,
      vipPoints: p.vip_points || 0,
      confidentialityLevel: p.confidentiality_level || 0,
      power: p.power || 0,
      kills: p.kills || 0,
      killPoints: p.kill_points || p.kills || 0
    },
    stock: {
      coupons: p.stock_coupons || 0,
      puzzles: p.stock_puzzles || 0,
      starCoupons: p.stock_star_coupons || 0,
      legendaryStars1: p.stock_legendary_stars_1 || 0,
      legendaryStars2: p.stock_legendary_stars_2 || 0,
      legendaryStars3: p.stock_legendary_stars_3 || 0,
      chests: p.stock_chests || 0
    },
    officers: officerRows.map(o => ({
      id: o.id,
      catalogId: o.catalog_id,
      name: o.name,
      level: o.level,
      coupons: o.coupons,
      stars: o.stars,
      skills: parseSkills(o.skills_json)
    }))
  };
}

function getPlayersByUserId(userId) {
  if (userId === undefined || userId === null) return [];
  const db = getDb();
  const playerRows = db.prepare(`
    SELECT p.*, u.username as owner_username, u.rank as owner_rank
    FROM players p
    LEFT JOIN users u ON u.id = p.user_id
    WHERE p.user_id = ?
    ORDER BY p.id ASC
  `).all(Number(userId));
  if (playerRows.length === 0) return [];

  const officerRows = db.prepare(`
    SELECT po.*
    FROM player_officers po
    JOIN players p ON p.id = po.player_id
    WHERE p.user_id = ?
    ORDER BY po.rowid ASC
  `).all(Number(userId));

  const officersByPlayer = new Map();
  for (const o of officerRows) {
    if (!officersByPlayer.has(o.player_id)) officersByPlayer.set(o.player_id, []);
    officersByPlayer.get(o.player_id).push({
      id: o.id,
      catalogId: o.catalog_id,
      name: o.name,
      level: o.level,
      coupons: o.coupons,
      stars: o.stars,
      skills: parseSkills(o.skills_json)
    });
  }

  return playerRows.map(p => ({
    id: p.id,
    name: p.name,
    realName: p.real_name || '',
    rank: p.rank || 'r3',
    userId: p.user_id || null,
    username: p.owner_username || null,
    userRank: p.owner_rank || null,
    sector: {
      vipLevel: p.vip_level || 0,
      vipPoints: p.vip_points || 0,
      confidentialityLevel: p.confidentiality_level || 0,
      power: p.power || 0,
      kills: p.kills || 0,
      killPoints: p.kill_points || p.kills || 0
    },
    stock: {
      coupons: p.stock_coupons || 0,
      puzzles: p.stock_puzzles || 0,
      starCoupons: p.stock_star_coupons || 0,
      legendaryStars1: p.stock_legendary_stars_1 || 0,
      legendaryStars2: p.stock_legendary_stars_2 || 0,
      legendaryStars3: p.stock_legendary_stars_3 || 0,
      chests: p.stock_chests || 0
    },
    officers: officersByPlayer.get(p.id) || []
  }));
}

function setUserActiveSector(userId, sectorId) {
  const db = getDb();
  const uId = Number(userId);
  const sId = Number(sectorId);

  const owned = db.prepare('SELECT id FROM players WHERE id = ? AND user_id = ?').get(sId, uId);
  if (!owned) {
    return { ok: false, error: 'NOT_OWNER' };
  }

  db.prepare('UPDATE users SET player_id = ? WHERE id = ?').run(sId, uId);
  return { ok: true, activeSectorId: sId };
}

function createPlayer(data = {}) {
  const db = getDb();
  const name = data.name || '';
  const realName = data.realName || data.real_name || '';
  const rank = data.rank || 'r3';
  let userId = data.userId !== undefined
    ? (data.userId ? Number(data.userId) : null)
    : (data.user_id !== undefined ? (data.user_id ? Number(data.user_id) : null) : null);
  if (userId) {
    const userExists = db.prepare('SELECT id FROM users WHERE id = ?').get(userId);
    if (!userExists) {
      userId = null;
    }
  }
  const sector = data.sector || {};
  const vipLevel = sector.vipLevel ?? data.vipLevel ?? data.vip_level ?? 0;
  const vipPoints = Number(sector.vipPoints ?? data.vipPoints ?? data.vip_points ?? 0) || 0;
  const confLevel = sector.confidentialityLevel ?? data.confidentialityLevel ?? data.confidentiality_level ?? 0;
  const power = sector.power ?? data.power ?? 0;
  const kills = sector.kills ?? data.kills ?? 0;
  const killPoints = sector.killPoints ?? data.killPoints ?? data.kill_points ?? kills;
  const stock = data.stock || {};
  const coupons = stock.coupons ?? data.stock_coupons ?? 0;
  const puzzles = stock.puzzles ?? data.stock_puzzles ?? 0;
  const starCoupons = Number(stock.starCoupons ?? data.stock_star_coupons) || 0;
  const legendaryStars1 = Number(stock.legendaryStars1 ?? data.stock_legendary_stars_1) || 0;
  const legendaryStars2 = Number(stock.legendaryStars2 ?? data.stock_legendary_stars_2) || 0;
  const legendaryStars3 = Number(stock.legendaryStars3 ?? data.stock_legendary_stars_3) || 0;
  const chests = stock.chests ?? data.stock_chests ?? 0;
  const now = new Date().toISOString();

  let playerId = data.id ? Number(data.id) : null;
  if (playerId) {
    db.prepare(`
      INSERT INTO players (id, name, real_name, rank, user_id, vip_level, vip_points, confidentiality_level, power, kills, kill_points, stock_coupons, stock_puzzles, stock_star_coupons, stock_legendary_stars_1, stock_legendary_stars_2, stock_legendary_stars_3, stock_chests, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        real_name = excluded.real_name,
        rank = excluded.rank,
        user_id = excluded.user_id,
        vip_level = excluded.vip_level,
        vip_points = excluded.vip_points,
        confidentiality_level = excluded.confidentiality_level,
        power = excluded.power,
        kills = excluded.kills,
        kill_points = excluded.kill_points,
        stock_coupons = excluded.stock_coupons,
        stock_puzzles = excluded.stock_puzzles,
        stock_star_coupons = excluded.stock_star_coupons,
        stock_legendary_stars_1 = excluded.stock_legendary_stars_1,
        stock_legendary_stars_2 = excluded.stock_legendary_stars_2,
        stock_legendary_stars_3 = excluded.stock_legendary_stars_3,
        stock_chests = excluded.stock_chests,
        updated_at = excluded.updated_at
    `).run(playerId, name, realName, rank, userId, vipLevel, vipPoints, confLevel, power, kills, killPoints, coupons, puzzles, starCoupons, legendaryStars1, legendaryStars2, legendaryStars3, chests, now);
  } else {
    const res = db.prepare(`
      INSERT INTO players (name, real_name, rank, user_id, vip_level, vip_points, confidentiality_level, power, kills, kill_points, stock_coupons, stock_puzzles, stock_star_coupons, stock_legendary_stars_1, stock_legendary_stars_2, stock_legendary_stars_3, stock_chests, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(name, realName, rank, userId, vipLevel, vipPoints, confLevel, power, kills, killPoints, coupons, puzzles, starCoupons, legendaryStars1, legendaryStars2, legendaryStars3, chests, now);
    playerId = Number(res.lastInsertRowid);
  }

  if (Array.isArray(data.officers)) {
    for (const o of data.officers) {
      addPlayerOfficer(playerId, o);
    }
  }

  return getPlayerById(playerId);
}

function updatePlayer(id, updates = {}) {
  const db = getDb();
  const existing = getPlayerById(id);
  if (!existing) return null;

  const name = updates.name !== undefined ? updates.name : existing.name;
  const realName = updates.realName !== undefined ? updates.realName : (updates.real_name !== undefined ? updates.real_name : existing.realName);
  const rank = updates.rank !== undefined ? updates.rank : existing.rank;
  let userId = updates.userId !== undefined
    ? (updates.userId ? Number(updates.userId) : null)
    : (updates.user_id !== undefined
        ? (updates.user_id ? Number(updates.user_id) : null)
        : existing.userId);
  if (userId) {
    const userExists = db.prepare('SELECT id FROM users WHERE id = ?').get(userId);
    if (!userExists) {
      userId = null;
    }
  }

  const sec = updates.sector || {};
  const vipLevel = sec.vipLevel !== undefined ? sec.vipLevel : (updates.vipLevel !== undefined ? updates.vipLevel : (updates.vip_level !== undefined ? updates.vip_level : existing.sector.vipLevel));
  const vipPoints = sec.vipPoints !== undefined ? Number(sec.vipPoints) || 0 : (updates.vipPoints !== undefined ? Number(updates.vipPoints) || 0 : (updates.vip_points !== undefined ? Number(updates.vip_points) || 0 : (existing.sector.vipPoints || 0)));
  const confLevel = sec.confidentialityLevel !== undefined ? sec.confidentialityLevel : (updates.confidentialityLevel !== undefined ? updates.confidentialityLevel : (updates.confidentiality_level !== undefined ? updates.confidentiality_level : existing.sector.confidentialityLevel));
  const power = sec.power !== undefined ? sec.power : (updates.power !== undefined ? updates.power : existing.sector.power);
  const kills = sec.kills !== undefined ? sec.kills : (updates.kills !== undefined ? updates.kills : existing.sector.kills);
  const killPoints = sec.killPoints !== undefined ? sec.killPoints : (updates.killPoints !== undefined ? updates.killPoints : (updates.kill_points !== undefined ? updates.kill_points : existing.sector.killPoints));

  const stk = updates.stock || {};
  const coupons = stk.coupons !== undefined ? stk.coupons : (updates.stock_coupons !== undefined ? updates.stock_coupons : existing.stock.coupons);
  const puzzles = stk.puzzles !== undefined ? stk.puzzles : (updates.stock_puzzles !== undefined ? updates.stock_puzzles : existing.stock.puzzles);
  const starCoupons = stk.starCoupons !== undefined ? Number(stk.starCoupons) || 0 : (updates.stock_star_coupons !== undefined ? Number(updates.stock_star_coupons) || 0 : (existing.stock.starCoupons || 0));
  const legendaryStars1 = stk.legendaryStars1 !== undefined ? Number(stk.legendaryStars1) || 0 : (updates.stock_legendary_stars_1 !== undefined ? Number(updates.stock_legendary_stars_1) || 0 : (existing.stock.legendaryStars1 || 0));
  const legendaryStars2 = stk.legendaryStars2 !== undefined ? Number(stk.legendaryStars2) || 0 : (updates.stock_legendary_stars_2 !== undefined ? Number(updates.stock_legendary_stars_2) || 0 : (existing.stock.legendaryStars2 || 0));
  const legendaryStars3 = stk.legendaryStars3 !== undefined ? Number(stk.legendaryStars3) || 0 : (updates.stock_legendary_stars_3 !== undefined ? Number(updates.stock_legendary_stars_3) || 0 : (existing.stock.legendaryStars3 || 0));
  const chests = stk.chests !== undefined ? stk.chests : (updates.stock_chests !== undefined ? updates.stock_chests : existing.stock.chests);
  const now = new Date().toISOString();

  db.prepare(`
    UPDATE players
    SET name = ?, real_name = ?, rank = ?, user_id = ?,
        vip_level = ?, vip_points = ?, confidentiality_level = ?, power = ?, kills = ?, kill_points = ?,
        stock_coupons = ?, stock_puzzles = ?, stock_star_coupons = ?, stock_legendary_stars_1 = ?, stock_legendary_stars_2 = ?, stock_legendary_stars_3 = ?, stock_chests = ?, updated_at = ?
    WHERE id = ?
  `).run(name, realName, rank, userId, vipLevel, vipPoints, confLevel, power, kills, killPoints, coupons, puzzles, starCoupons, legendaryStars1, legendaryStars2, legendaryStars3, chests, now, id);

  return getPlayerById(id);
}

function deletePlayer(id) {
  const db = getDb();
  db.prepare('UPDATE users SET player_id = NULL WHERE player_id = ?').run(id);
  db.prepare('DELETE FROM players WHERE id = ?').run(id);
  return true;
}

function addPlayerOfficer(playerId, officerData) {
  const db = getDb();
  const id = officerData.id || `po-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  const catalogId = officerData.catalogId || officerData.catalog_id || '';
  const name = officerData.name || '';
  const level = Number(officerData.level) || 0;
  const coupons = Number(officerData.coupons) || 0;
  const stars = Number(officerData.stars) || 0;
  const skills = parseSkills(officerData.skills ?? officerData.skills_json);
  const skillsJson = JSON.stringify(skills);

  db.prepare(`
    INSERT INTO player_officers (id, player_id, catalog_id, name, level, coupons, stars, skills_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      catalog_id = excluded.catalog_id,
      name = excluded.name,
      level = excluded.level,
      coupons = excluded.coupons,
      stars = excluded.stars,
      skills_json = excluded.skills_json
  `).run(id, playerId, catalogId, name, level, coupons, stars, skillsJson);

  return { id, playerId, catalogId, name, level, coupons, stars, skills };
}

function updatePlayerOfficer(playerId, officerId, updates) {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM player_officers WHERE id = ? AND player_id = ?').get(officerId, playerId);
  if (!existing) return null;

  const level = updates.level !== undefined ? Number(updates.level) : existing.level;
  const coupons = updates.coupons !== undefined ? Number(updates.coupons) : existing.coupons;
  const stars = updates.stars !== undefined ? Number(updates.stars) : existing.stars;
  const name = updates.name !== undefined ? updates.name : existing.name;

  let skills;
  if (updates.skills !== undefined || updates.skills_json !== undefined) {
    skills = parseSkills(updates.skills ?? updates.skills_json);
  } else {
    skills = parseSkills(existing.skills_json);
  }
  const skillsJson = JSON.stringify(skills);

  db.prepare(`
    UPDATE player_officers
    SET level = ?, coupons = ?, stars = ?, name = ?, skills_json = ?
    WHERE id = ? AND player_id = ?
  `).run(level, coupons, stars, name, skillsJson, officerId, playerId);

  return {
    id: officerId,
    catalogId: existing.catalog_id,
    name,
    level,
    coupons,
    stars,
    skills
  };
}

function deletePlayerOfficer(playerId, officerId) {
  const db = getDb();
  db.prepare('DELETE FROM player_officers WHERE id = ? AND player_id = ?').run(officerId, playerId);
  return true;
}

// ─── CATALOG ─────────────────────────────────────────────────
function getCatalog() {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM officer_catalog ORDER BY generation DESC, name ASC').all();
  return rows.map(r => ({
    id: r.id,
    name: r.name,
    type: r.type,
    generation: r.generation,
    couponPerPuzzle: r.coupon_per_puzzle,
    upgradeType: r.upgrade_type || 'standard',
    medalsBeforeTraining: r.medals_before_training,
    medalsTraining: r.medals_training,
    medalsTotal: r.medals_total
  }));
}

function saveCatalogItem(itemOrDb, maybeItem) {
  let db, item;
  if (itemOrDb && typeof itemOrDb.prepare === 'function') {
    db = itemOrDb;
    item = maybeItem;
  } else {
    db = getDb();
    item = itemOrDb;
  }
  const upgradeType = item.upgradeType || item.upgrade_type || 'standard';
  db.prepare(`
    INSERT INTO officer_catalog (id, name, type, generation, coupon_per_puzzle, upgrade_type, medals_before_training, medals_training, medals_total)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      type = excluded.type,
      generation = excluded.generation,
      coupon_per_puzzle = excluded.coupon_per_puzzle,
      upgrade_type = excluded.upgrade_type,
      medals_before_training = excluded.medals_before_training,
      medals_training = excluded.medals_training,
      medals_total = excluded.medals_total
  `).run(
    item.id,
    item.name,
    item.type || 'Пехота',
    item.generation || 7,
    item.couponPerPuzzle ?? item.coupon_per_puzzle ?? 500,
    upgradeType,
    item.medalsBeforeTraining ?? item.medals_before_training ?? 690,
    item.medalsTraining ?? item.medals_training ?? 900,
    item.medalsTotal ?? item.medals_total ?? 1590
  );
  return {
    ...item,
    upgradeType
  };
}

function deleteCatalogItem(id) {
  const db = getDb();
  db.prepare('DELETE FROM officer_catalog WHERE id = ?').run(id);
  return true;
}

// ─── EVENT TYPES & EVENTS ────────────────────────────────────
function getEventTypes() {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM event_types ORDER BY id ASC').all();
  return rows.map(r => ({
    id: r.id,
    name: r.name,
    color: r.color,
    places: JSON.parse(r.places_json || '[]')
  }));
}

function saveEventType(data) {
  const db = getDb();
  const placesJson = JSON.stringify(data.places || []);
  if (data.id) {
    db.prepare(`
      INSERT INTO event_types (id, name, color, places_json)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        color = excluded.color,
        places_json = excluded.places_json
    `).run(data.id, data.name, data.color || '#8b5cf6', placesJson);
    return data;
  } else {
    const res = db.prepare(`
      INSERT INTO event_types (name, color, places_json)
      VALUES (?, ?, ?)
    `).run(data.name, data.color || '#8b5cf6', placesJson);
    return { ...data, id: Number(res.lastInsertRowid) };
  }
}

function deleteEventType(id) {
  const db = getDb();
  db.prepare('DELETE FROM event_types WHERE id = ?').run(id);
  return true;
}

function getEvents() {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM events ORDER BY date_from ASC, id ASC').all();
  return rows.map(r => ({
    id: r.id,
    typeId: r.type_id,
    dateFrom: r.date_from,
    dateTo: r.date_to,
    note: r.note || '',
    assignments: JSON.parse(r.assignments_json || '[]')
  }));
}

function getEventById(id) {
  const db = getDb();
  const r = db.prepare('SELECT * FROM events WHERE id = ?').get(id);
  if (!r) return null;
  return {
    id: r.id,
    typeId: r.type_id,
    dateFrom: r.date_from,
    dateTo: r.date_to,
    note: r.note || '',
    assignments: JSON.parse(r.assignments_json || '[]')
  };
}

function saveEvent(data) {
  const db = getDb();
  const assignmentsJson = JSON.stringify(data.assignments || []);
  if (data.id) {
    db.prepare(`
      INSERT INTO events (id, type_id, date_from, date_to, note, assignments_json)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        type_id = excluded.type_id,
        date_from = excluded.date_from,
        date_to = excluded.date_to,
        note = excluded.note,
        assignments_json = excluded.assignments_json
    `).run(data.id, data.typeId, data.dateFrom, data.dateTo, data.note || '', assignmentsJson);
    return data;
  } else {
    const res = db.prepare(`
      INSERT INTO events (type_id, date_from, date_to, note, assignments_json)
      VALUES (?, ?, ?, ?, ?)
    `).run(data.typeId, data.dateFrom, data.dateTo, data.note || '', assignmentsJson);
    return { ...data, id: Number(res.lastInsertRowid) };
  }
}

function deleteEvent(id) {
  const db = getDb();
  db.prepare('DELETE FROM events WHERE id = ?').run(id);
  return true;
}

function getRecentWinners(eventTypeId, limit = 2, excludeEventId = null) {
  const db = getDb();
  const typeId = Number(eventTypeId);
  const numLimit = Number(limit) || 2;
  const rows = db.prepare(`
    SELECT assignments_json
    FROM events
    WHERE type_id = ? ${excludeEventId ? 'AND id != ?' : ''}
    ORDER BY date_from DESC, id DESC
  `).all(...(excludeEventId ? [typeId, excludeEventId] : [typeId]));

  const winners = [];
  for (const row of rows) {
    if (winners.length >= numLimit) break;
    try {
      const assignments = JSON.parse(row.assignments_json || '[]');
      const firstPlace = assignments.find(a => Number(a.place) === 1 && (a.playerId !== undefined && a.playerId !== null));
      if (firstPlace && firstPlace.playerId) {
        if (!winners.includes(firstPlace.playerId)) {
          winners.push(firstPlace.playerId);
        }
      }
    } catch (e) {}
  }
  return winners;
}

// ─── EVENT REGISTRATIONS ─────────────────────────────────────
function getRegistrationsByEventId(eventId) {
  const db = getDb();
  const rows = db.prepare(`
    SELECT r.id, r.event_id as eventId, r.player_id as playerId,
           r.officer_id as officerId, r.desired_place as desiredPlace,
           r.created_at as createdAt,
           p.name as playerName
    FROM event_registrations r
    LEFT JOIN players p ON r.player_id = p.id
    WHERE r.event_id = ?
    ORDER BY r.id ASC
  `).all(eventId);
  return rows;
}

function getUserRegistration(eventId, playerId) {
  const db = getDb();
  const r = db.prepare(`
    SELECT r.id, r.event_id as eventId, r.player_id as playerId,
           r.officer_id as officerId, r.desired_place as desiredPlace,
           r.created_at as createdAt,
           p.name as playerName
    FROM event_registrations r
    LEFT JOIN players p ON r.player_id = p.id
    WHERE r.event_id = ? AND r.player_id = ?
  `).get(eventId, playerId);
  return r || null;
}

function registerForEvent({ eventId, playerId, officerId, desiredPlace }) {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO event_registrations (event_id, player_id, officer_id, desired_place, created_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(event_id, player_id) DO UPDATE SET
      officer_id = excluded.officer_id,
      desired_place = excluded.desired_place,
      created_at = excluded.created_at
  `).run(eventId, playerId, officerId, desiredPlace, now);
  return getUserRegistration(eventId, playerId);
}

function unregisterFromEvent(eventId, playerId) {
  const db = getDb();
  db.prepare('DELETE FROM event_registrations WHERE event_id = ? AND player_id = ?').run(eventId, playerId);
  return true;
}

// ─── STOCK HISTORY ───────────────────────────────────────────
function getStockHistory() {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM stock_history ORDER BY date ASC, id ASC').all();
  return rows.map(r => ({
    id: r.id,
    playerId: r.player_id,
    date: r.date,
    coupons: r.coupons,
    puzzles: r.puzzles,
    chests: r.chests
  }));
}

function recordStockHistory(playerId, stock, date = null) {
  const db = getDb();
  const d = date || new Date().toISOString().slice(0, 10);
  db.prepare(`
    INSERT INTO stock_history (player_id, date, coupons, puzzles, chests)
    VALUES (?, ?, ?, ?, ?)
  `).run(playerId, d, stock.coupons || 0, stock.puzzles || 0, stock.chests || 0);
}

// ─── IMPORT / EXPORT ─────────────────────────────────────────
function exportKowJson() {
  const players = getPlayers();
  const officerCatalog = getCatalog();
  const eventTypes = getEventTypes();
  const events = getEvents();
  const stockHistory = getStockHistory();

  const maxId = Math.max(
    0,
    ...players.map(p => Number(p.id) || 0),
    ...eventTypes.map(t => Number(t.id) || 0),
    ...events.map(e => Number(e.id) || 0)
  );

  return {
    version: 3,
    players,
    officerCatalog,
    eventTypes,
    events,
    stockHistory,
    currentRole: 'r5',
    currentPlayerId: players[0]?.id || null,
    nextId: maxId + 1
  };
}

function importKowJson(rawJson) {
  const raw = typeof rawJson === 'string' ? JSON.parse(rawJson) : rawJson;
  const state = migrateState(raw);
  const db = getDb();

  const rawOfficersByPlayerAndId = new Map();
  const rawPlayerVipPoints = new Map();
  const rawPlayerUserId = new Map();
  if (Array.isArray(raw?.players)) {
    for (const rp of raw.players) {
      if (rp && rp.id !== undefined) {
        const vp = rp.sector?.vipPoints ?? rp.vipPoints ?? rp.vip_points ?? 0;
        rawPlayerVipPoints.set(rp.id, vp);
        const uid = rp.userId ?? rp.user_id ?? null;
        if (uid !== null && uid !== undefined) {
          rawPlayerUserId.set(rp.id, Number(uid));
        }
      }
      if (Array.isArray(rp?.officers)) {
        for (const ro of rp.officers) {
          if (ro && ro.id) {
            rawOfficersByPlayerAndId.set(`${rp.id}:${ro.id}`, ro);
          }
        }
      }
    }
  }
  const rawCatalogUpgradeTypes = new Map();
  if (Array.isArray(raw?.officerCatalog)) {
    for (const rc of raw.officerCatalog) {
      if (rc && rc.id) {
        rawCatalogUpgradeTypes.set(rc.id, rc.upgradeType || rc.upgrade_type || 'standard');
      }
    }
  }

  db.exec('BEGIN TRANSACTION');
  try {
    for (const item of state.officerCatalog || []) {
      if (rawCatalogUpgradeTypes.has(item.id)) {
        item.upgradeType = rawCatalogUpgradeTypes.get(item.id);
      }
      saveCatalogItem(item);
    }
    for (const et of state.eventTypes || []) {
      saveEventType(et);
    }
    for (const p of state.players || []) {
      if (rawPlayerVipPoints.has(p.id)) {
        p.sector = p.sector || {};
        p.sector.vipPoints = rawPlayerVipPoints.get(p.id);
      }
      if (rawPlayerUserId.has(p.id)) {
        p.userId = rawPlayerUserId.get(p.id);
      }
      if (Array.isArray(p.officers)) {
        for (const o of p.officers) {
          const rawOfficer = rawOfficersByPlayerAndId.get(`${p.id}:${o.id}`);
          if (rawOfficer) {
            if (rawOfficer.skills !== undefined) {
              o.skills = rawOfficer.skills;
            } else if (rawOfficer.skills_json !== undefined) {
              o.skills_json = rawOfficer.skills_json;
            }
          }
        }
      }
      createPlayer(p);
    }
    for (const ev of state.events || []) {
      saveEvent(ev);
    }
    for (const sh of state.stockHistory || []) {
      recordStockHistory(sh.playerId || sh.player_id, {
        coupons: sh.coupons,
        puzzles: sh.puzzles,
        chests: sh.chests
      }, sh.date);
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

// ─── BOOTSTRAP ───────────────────────────────────────────────
function seedDemoData(db) {
  // 1. Officer catalog
  const catalogToSeed = (COMMUNITY_OFFICERS && COMMUNITY_OFFICERS.length) ? COMMUNITY_OFFICERS : DEFAULT_OFFICERS;
  for (const item of catalogToSeed) {
    saveCatalogItem(item);
  }

  // 2. Event types
  const kwType = saveEventType({
    id: 1,
    name: 'Король Войны',
    color: '#8b5cf6',
    places: [
      { place: 1, label: '🥇 1 место', coupons: 12500 },
      { place: 2, label: '🥈 2 место', coupons: 6500 },
      { place: 3, label: '🥉 3 место', coupons: 3500 },
      { place: 4, label: '4–10 место', coupons: 2750 },
    ]
  });

  const msType = saveEventType({
    id: 2,
    name: 'Мощные Силы',
    color: '#06b6d4',
    places: [
      { place: 1, label: '🥇 1 место', coupons: 12500 },
      { place: 2, label: '🥈 2 место', coupons: 6500 },
      { place: 3, label: '🥉 3 место', coupons: 3500 },
      { place: 4, label: '4–10 место', coupons: 2750 },
    ]
  });

  // 3. Demo players
  const demoPlayers = [
    {
      id: 1,
      name: 'Командор',
      rank: 'r5',
      officers: [
        { id: 'o1', catalogId: 'admiral-nathon', name: 'Адмирал Нейтон', level: 8, coupons: 750, stars: 0 },
        { id: 'o2', catalogId: 'general-rex', name: 'Генерал Рекс', level: 2, coupons: 0, stars: 0 }
      ]
    },
    {
      id: 2,
      name: 'Морской Волк',
      rank: 'r3',
      officers: [
        { id: 'o3', catalogId: 'captain-black', name: 'Капитан Блэк', level: 3, coupons: 2200, stars: 0 }
      ]
    },
    {
      id: 3,
      name: 'Шторм',
      rank: 'r3',
      officers: [
        { id: 'o4', catalogId: 'admiral-nathon', name: 'Адмирал Нейтон', level: 22, coupons: 1500, stars: 0 }
      ]
    },
    {
      id: 4,
      name: 'Флотоводец',
      rank: 'r3',
      officers: [
        { id: 'o5', catalogId: 'general-rex', name: 'Генерал Рекс', level: 1, coupons: 500, stars: 0 },
        { id: 'o6', catalogId: 'captain-black', name: 'Капитан Блэк', level: 0, coupons: 0, stars: 0 }
      ]
    },
    {
      id: 5,
      name: 'Навигатор',
      rank: 'r3',
      officers: [
        { id: 'o7', catalogId: 'admiral-nathon', name: 'Адмирал Нейтон', level: 35, coupons: 0, stars: 0 }
      ]
    }
  ];

  for (const p of demoPlayers) {
    createPlayer(p);
  }

  // 4. Demo events
  const demoEvents = [
    {
      id: 1,
      typeId: kwType.id,
      dateFrom: '2025-06-02',
      dateTo: '2025-06-08',
      note: '',
      assignments: [
        { place: 1, playerId: 3, officerId: 'o4' },
        { place: 2, playerId: 1, officerId: 'o1' },
        { place: 3, playerId: 2, officerId: 'o3' },
        { place: 4, playerId: 5, officerId: 'o7' },
      ]
    },
    {
      id: 2,
      typeId: msType.id,
      dateFrom: '2025-06-09',
      dateTo: '2025-06-15',
      note: '',
      assignments: [
        { place: 1, playerId: 5, officerId: 'o7' },
        { place: 2, playerId: 3, officerId: 'o4' },
        { place: 3, playerId: 4, officerId: 'o5' },
      ]
    },
    {
      id: 3,
      typeId: kwType.id,
      dateFrom: '2025-06-23',
      dateTo: '2025-06-29',
      note: 'Предстоящий',
      assignments: [
        { place: 1, playerId: 5, officerId: 'o7' },
        { place: 2, playerId: 3, officerId: 'o4' },
        { place: 3, playerId: 2, officerId: 'o3' },
      ]
    }
  ];

  for (const ev of demoEvents) {
    saveEvent(ev);
  }

  // 5. Initial Admin user (R5, approved)
  const adminHash = hashPassword('admin123');
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO users (username, password_hash, rank, is_approved, player_id, created_at)
    VALUES (?, ?, 'r5', 1, 1, ?)
  `).run('admin', adminHash, now);
}

function migrateSchema(db) {
  function getColumns(table) {
    try {
      return db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
    } catch (e) {
      return [];
    }
  }

  const playerCols = getColumns('players');
  if (playerCols.length > 0) {
    if (!playerCols.includes('user_id')) {
      db.exec("ALTER TABLE players ADD COLUMN user_id INTEGER NULL REFERENCES users(id) ON DELETE SET NULL;");
    }
    if (!playerCols.includes('vip_points')) {
      db.exec("ALTER TABLE players ADD COLUMN vip_points INTEGER NOT NULL DEFAULT 0;");
    }
    if (!playerCols.includes('stock_star_coupons')) {
      db.exec("ALTER TABLE players ADD COLUMN stock_star_coupons INTEGER NOT NULL DEFAULT 0;");
    }
    if (!playerCols.includes('stock_legendary_stars_1')) {
      db.exec("ALTER TABLE players ADD COLUMN stock_legendary_stars_1 INTEGER NOT NULL DEFAULT 0;");
    }
    if (!playerCols.includes('stock_legendary_stars_2')) {
      db.exec("ALTER TABLE players ADD COLUMN stock_legendary_stars_2 INTEGER NOT NULL DEFAULT 0;");
    }
    if (!playerCols.includes('stock_legendary_stars_3')) {
      db.exec("ALTER TABLE players ADD COLUMN stock_legendary_stars_3 INTEGER NOT NULL DEFAULT 0;");
    }
  }

  const officerCols = getColumns('player_officers');
  if (officerCols.length > 0 && !officerCols.includes('skills_json')) {
    db.exec("ALTER TABLE player_officers ADD COLUMN skills_json TEXT NOT NULL DEFAULT '[1,1,1,1]';");
  }

  const catalogCols = getColumns('officer_catalog');
  if (catalogCols.length > 0 && !catalogCols.includes('upgrade_type')) {
    db.exec("ALTER TABLE officer_catalog ADD COLUMN upgrade_type TEXT NOT NULL DEFAULT 'standard';");
  }
}

// ─── INIT DB ─────────────────────────────────────────────────
function initDb(filePath) {
  const dbPath = filePath || process.env.DB_PATH || path.join(__dirname, 'data', 'kow.db');

  if (dbPath !== ':memory:') {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  const db = new DatabaseSync(dbPath);
  currentDb = db;

  if (dbPath !== ':memory:') {
    try {
      db.exec('PRAGMA journal_mode = WAL;');
    } catch (e) {}
  }
  db.exec('PRAGMA foreign_keys = ON;');

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      rank TEXT NOT NULL DEFAULT 'r3',
      is_approved INTEGER NOT NULL DEFAULT 0,
      player_id INTEGER NULL REFERENCES players(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS players (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      real_name TEXT DEFAULT '',
      rank TEXT NOT NULL DEFAULT 'r3',
      user_id INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
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

    CREATE TABLE IF NOT EXISTS player_officers (
      id TEXT PRIMARY KEY,
      player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
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
      type_id INTEGER NOT NULL REFERENCES event_types(id),
      date_from TEXT NOT NULL,
      date_to TEXT NOT NULL,
      note TEXT DEFAULT '',
      assignments_json TEXT NOT NULL DEFAULT '[]'
    );

    CREATE TABLE IF NOT EXISTS event_registrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      officer_id TEXT NOT NULL,
      desired_place INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(event_id, player_id)
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
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      expires_at TEXT
    );
  `);

  migrateSchema(db);

  // Check if empty to auto-bootstrap
  const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
  if (userCount === 0) {
    seedDemoData(db);
  }

  // Safe backfill for links from users.player_id -> players.user_id
  try {
    db.exec(`
      UPDATE players
      SET user_id = (SELECT id FROM users WHERE users.player_id = players.id)
      WHERE user_id IS NULL AND id IN (SELECT player_id FROM users WHERE player_id IS NOT NULL);
    `);
  } catch (e) {}

  // Ensure all community officers are present/upserted in officer_catalog on startup
  // (both for newly seeded databases and existing v3.0.0 databases with partial catalog)
  if (COMMUNITY_OFFICERS && COMMUNITY_OFFICERS.length) {
    for (const item of COMMUNITY_OFFICERS) {
      saveCatalogItem(db, item);
    }
  }

  return db;
}

module.exports = {
  initDb,
  getDb,
  hashPassword,
  verifyPassword,
  createSession,
  verifySession,
  deleteSession,
  clearUserSessions,
  findUserByUsername,
  findUserById,
  registerUser,
  loginUser,
  approveUser,
  rejectUser,
  getPendingUsers,
  getUsers,
  updateUser,
  changePassword,
  getCandidatePlayers,
  getPlayers,
  getPlayersByUserId,
  getPlayerById,
  setUserActiveSector,
  createPlayer,
  updatePlayer,
  deletePlayer,
  addPlayerOfficer,
  updatePlayerOfficer,
  deletePlayerOfficer,
  getCatalog,
  saveCatalogItem,
  deleteCatalogItem,
  getEventTypes,
  saveEventType,
  deleteEventType,
  getEvents,
  getEventById,
  saveEvent,
  deleteEvent,
  getRecentWinners,
  getRegistrationsByEventId,
  getUserRegistration,
  registerForEvent,
  unregisterFromEvent,
  getStockHistory,
  recordStockHistory,
  exportKowJson,
  importKowJson,
};
