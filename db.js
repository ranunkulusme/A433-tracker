const { DatabaseSync } = require('node:sqlite');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { DEFAULT_OFFICERS, COMMUNITY_OFFICERS, migrateState, INVESTED_ZERO, normalizeInvested, calculateStockDiff, DEFAULT_NOTIFICATION_TEMPLATES } = require('./logic.js');

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

function parsePermissions(raw) {
  if (Array.isArray(raw)) return raw.filter(p => typeof p === 'string');
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.filter(p => typeof p === 'string');
    } catch (e) {}
  }
  return [];
}

function verifySession(token) {
  if (!token) return null;
  const row = getDb().prepare(`
    SELECT s.token, s.user_id, s.created_at, s.expires_at,
           u.id, u.username, u.rank, u.is_approved, u.is_blocked, u.player_id, u.permissions,
           u.telegram_chat_id, u.telegram_username, u.telegram_notifications_enabled,
           p.name as player_name
    FROM sessions s
    JOIN users u ON s.user_id = u.id
    LEFT JOIN players p ON u.player_id = p.id
    WHERE s.token = ?
  `).get(token);
  if (!row || row.is_approved !== 1 || row.is_blocked === 1) return null;
  return {
    id: row.id,
    username: row.username,
    rank: row.rank,
    is_approved: row.is_approved,
    is_blocked: row.is_blocked || 0,
    isBlocked: Boolean(row.is_blocked),
    playerId: row.player_id,
    player_id: row.player_id,
    playerName: row.player_name || '',
    permissions: parsePermissions(row.permissions),
    telegramChatId: row.telegram_chat_id,
    telegram_chat_id: row.telegram_chat_id,
    telegramUsername: row.telegram_username,
    telegram_username: row.telegram_username,
    telegramNotificationsEnabled: row.telegram_notifications_enabled !== 0,
    telegram_notifications_enabled: row.telegram_notifications_enabled
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
  if (!user) return null;
  return {
    ...user,
    permissions: parsePermissions(user.permissions),
    telegramChatId: user.telegram_chat_id,
    telegramUsername: user.telegram_username,
    telegramNotificationsEnabled: user.telegram_notifications_enabled !== 0
  };
}

function findUserById(id) {
  const user = getDb().prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!user) return null;
  return {
    ...user,
    permissions: parsePermissions(user.permissions),
    telegramChatId: user.telegram_chat_id,
    telegramUsername: user.telegram_username,
    telegramNotificationsEnabled: user.telegram_notifications_enabled !== 0
  };
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
    INSERT INTO users (username, password_hash, rank, is_approved, is_blocked, player_id, created_at)
    VALUES (?, ?, ?, ?, 0, ?, ?)
  `).run(username, hash, rank, isApproved, assignedPlayerId, now);

  const userId = Number(res.lastInsertRowid);

  if (assignedPlayerId) {
    db.prepare('UPDATE players SET user_id = ? WHERE id = ?').run(userId, assignedPlayerId);
  } else if (playerName && String(playerName).trim()) {
    const trimmedName = String(playerName).trim();
    // 1. Проверяем, существует ли уже свободный сектор с таким именем (регистронезависимо)
    const existingPlayer = db.prepare(`
      SELECT id FROM players
      WHERE LOWER(TRIM(name)) = LOWER(?) AND (user_id IS NULL OR user_id = '')
      ORDER BY id ASC
    `).get(trimmedName);

    if (existingPlayer) {
      assignedPlayerId = existingPlayer.id;
      db.prepare('UPDATE players SET user_id = ? WHERE id = ?').run(userId, assignedPlayerId);
    } else {
      const createdPlayer = createPlayer({
        name: trimmedName,
        rank,
        userId
      });
      assignedPlayerId = createdPlayer.id;
    }
    db.prepare('UPDATE users SET player_id = ? WHERE id = ?').run(assignedPlayerId, userId);
  }

  return {
    userId,
    id: userId,
    username,
    rank,
    is_approved: isApproved,
    is_blocked: 0,
    playerId: assignedPlayerId,
    player_id: assignedPlayerId,
    pendingApproval: isApproved === 0,
    permissions: []
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
  if (user.is_blocked === 1) {
    return { error: 'ACCOUNT_BLOCKED' };
  }
  if (user.is_approved === 0) {
    return { error: 'PENDING_APPROVAL' };
  }
  const token = createSession(user.id);
  touchUserActive(user.id, true);
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
      is_blocked: user.is_blocked || 0,
      playerId: user.player_id,
      player_id: user.player_id,
      playerName,
      permissions: parsePermissions(user.permissions)
    }
  };
}

function approveUser(userId, rank = 'r3') {
  const db = getDb();
  db.prepare('UPDATE users SET is_approved = 1, rank = ? WHERE id = ?').run(rank, userId);
  const user = findUserById(userId);
  if (user && user.player_id) {
    db.prepare('UPDATE players SET rank = ?, user_id = ? WHERE id = ?').run(rank, userId, user.player_id);
  }
  return user;
}

function rejectUser(userId) {
  const db = getDb();
  const user = findUserById(userId);
  if (user && user.player_id) {
    const p = getPlayerById(user.player_id);
    if (p && p.userId === userId) {
      let hasHistory = 0;
      let hasRegs = 0;
      try {
        hasHistory = db.prepare('SELECT COUNT(*) as count FROM stock_history_records WHERE player_id = ?').get(p.id)?.count || 0;
      } catch (e) {}
      try {
        hasRegs = db.prepare('SELECT COUNT(*) as count FROM event_registrations WHERE player_id = ?').get(p.id)?.count || 0;
      } catch (e) {}
      // Если сектор создан только для этой заявки без истории и регистраций — удаляем его
      if (hasHistory === 0 && hasRegs === 0) {
        deletePlayer(p.id);
      } else {
        db.prepare('UPDATE players SET user_id = NULL WHERE id = ?').run(p.id);
      }
    }
  }
  clearUserSessions(userId);
  db.prepare('DELETE FROM users WHERE id = ?').run(userId);
  return true;
}

function blockUser(userId, isBlocked = true) {
  const db = getDb();
  const flag = isBlocked ? 1 : 0;
  db.prepare('UPDATE users SET is_blocked = ? WHERE id = ?').run(flag, userId);
  if (flag === 1) {
    clearUserSessions(userId);
  }
  return findUserById(userId);
}

function deleteUser(userId, { deleteSectors = false } = {}) {
  const db = getDb();
  const user = findUserById(userId);
  if (!user) return { success: false, error: 'USER_NOT_FOUND' };

  clearUserSessions(userId);

  if (deleteSectors) {
    const sectors = getPlayersByUserId(userId);
    for (const s of sectors) {
      deletePlayer(s.id);
    }
    if (user.player_id) {
      deletePlayer(user.player_id);
    }
  } else {
    db.prepare('UPDATE players SET user_id = NULL WHERE user_id = ?').run(userId);
    if (user.player_id) {
      db.prepare('UPDATE players SET user_id = NULL WHERE id = ?').run(user.player_id);
    }
  }

  db.prepare('DELETE FROM users WHERE id = ?').run(userId);
  return { success: true };
}

function getPendingUsers() {
  const db = getDb();
  const rows = db.prepare(`
    SELECT u.id, u.username, u.rank, u.is_approved, u.is_blocked,
           COALESCE(u.player_id, p_owner.id) as playerId,
           COALESCE(u.player_id, p_owner.id) as player_id,
           u.permissions,
           u.telegram_chat_id as telegramChatId, u.telegram_chat_id,
           u.telegram_username as telegramUsername, u.telegram_username,
           u.telegram_notifications_enabled as telegramNotificationsEnabled, u.telegram_notifications_enabled,
           u.last_active_at as lastActiveAt, u.last_active_at,
           u.created_at as createdAt, u.created_at,
           COALESCE(p_direct.name, p_owner.name) as playerName
    FROM users u
    LEFT JOIN players p_direct ON u.player_id = p_direct.id
    LEFT JOIN players p_owner ON p_owner.id = (
      SELECT id FROM players WHERE user_id = u.id ORDER BY id ASC LIMIT 1
    )
    WHERE u.is_approved = 0
    ORDER BY u.id ASC
  `).all();
  return rows.map(r => {
    const lastActiveAt = r.last_active_at || null;
    const isOnline = Boolean(
      lastActiveAt && (Date.now() - new Date(lastActiveAt).getTime() <= 5 * 60 * 1000)
    );
    return {
      ...r,
      is_blocked: r.is_blocked || 0,
      isBlocked: Boolean(r.is_blocked),
      permissions: parsePermissions(r.permissions),
      telegramNotificationsEnabled: r.telegram_notifications_enabled !== 0,
      lastActiveAt,
      isOnline
    };
  });
}

function touchUserActive(userId, force = false) {
  if (!userId) return;
  const numId = Number(userId);
  if (!numId) return;
  const now = new Date().toISOString();
  try {
    if (force) {
      getDb().prepare('UPDATE users SET last_active_at = ? WHERE id = ?').run(now, numId);
    } else {
      getDb().prepare(`
        UPDATE users 
        SET last_active_at = ? 
        WHERE id = ? 
          AND (last_active_at IS NULL OR (strftime('%s', 'now') - strftime('%s', last_active_at) >= 60))
      `).run(now, numId);
    }
  } catch (e) {
    try {
      getDb().prepare('UPDATE users SET last_active_at = ? WHERE id = ?').run(now, numId);
    } catch (err) {}
  }
}

function getUsers() {
  const db = getDb();
  const rows = db.prepare(`
    SELECT u.id, u.username, u.rank, u.is_approved, u.is_blocked,
           COALESCE(u.player_id, p_owner.id) as playerId,
           COALESCE(u.player_id, p_owner.id) as player_id,
           u.permissions,
           u.telegram_chat_id as telegramChatId, u.telegram_chat_id,
           u.telegram_username as telegramUsername, u.telegram_username,
           u.telegram_notifications_enabled as telegramNotificationsEnabled, u.telegram_notifications_enabled,
           u.last_active_at as lastActiveAt, u.last_active_at,
           u.created_at as createdAt, u.created_at,
           COALESCE(p_direct.name, p_owner.name) as playerName
    FROM users u
    LEFT JOIN players p_direct ON u.player_id = p_direct.id
    LEFT JOIN players p_owner ON p_owner.id = (
      SELECT id FROM players WHERE user_id = u.id ORDER BY id ASC LIMIT 1
    )
    ORDER BY u.id ASC
  `).all();
  return rows.map(r => {
    const lastActiveAt = r.last_active_at || null;
    const isOnline = Boolean(
      lastActiveAt && (Date.now() - new Date(lastActiveAt).getTime() <= 5 * 60 * 1000)
    );
    return {
      ...r,
      is_blocked: r.is_blocked || 0,
      isBlocked: Boolean(r.is_blocked),
      permissions: parsePermissions(r.permissions),
      telegramNotificationsEnabled: r.telegram_notifications_enabled !== 0,
      lastActiveAt,
      isOnline
    };
  });
}

function updateUser(userId, updates = {}) {
  const db = getDb();
  const existing = findUserById(userId);
  if (!existing) return null;
  const rank = updates.rank !== undefined ? updates.rank : existing.rank;
  const isApproved = updates.is_approved !== undefined ? updates.is_approved : existing.is_approved;
  const playerId = updates.player_id !== undefined ? updates.player_id : (updates.playerId !== undefined ? updates.playerId : existing.player_id);
  const permissionsStr = updates.permissions !== undefined
    ? JSON.stringify(parsePermissions(updates.permissions))
    : JSON.stringify(parsePermissions(existing.permissions));

  db.prepare(`
    UPDATE users SET rank = ?, is_approved = ?, player_id = ?, permissions = ? WHERE id = ?
  `).run(rank, isApproved, playerId, permissionsStr, userId);

  return findUserById(userId);
}

function changePassword(userId, newPassword) {
  const db = getDb();
  const hash = hashPassword(newPassword);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, userId);
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
  return true;
}

function isDefaultAdminPassword() {
  const admin = findUserByUsername('admin');
  if (!admin) return false;
  return verifyPassword('admin123', admin.password_hash);
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

function parseInvested(investedData) {
  if (!investedData) return { ...INVESTED_ZERO };
  if (typeof investedData === 'object') return normalizeInvested(investedData);
  if (typeof investedData === 'string') {
    try {
      return normalizeInvested(JSON.parse(investedData));
    } catch (e) {}
  }
  return { ...INVESTED_ZERO };
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
      personalPuzzles: Number(o.personal_puzzles) || 0,
      onlyPersonalPuzzles: Boolean(o.only_personal_puzzles),
      skills: parseSkills(o.skills_json),
      invested: parseInvested(o.invested_json)
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
      killPoints: p.kill_points || p.kills || 0,
      hqLevel: (p.hq_level !== null && p.hq_level !== undefined) ? Number(p.hq_level) : null
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
    stockUpdatedAt: p.stock_updated_at || null,
    stockUpdateSource: p.stock_update_source || null,
    lastStockReminderSentAt: p.last_stock_reminder_sent_at || null,
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
      killPoints: p.kill_points || p.kills || 0,
      hqLevel: (p.hq_level !== null && p.hq_level !== undefined) ? Number(p.hq_level) : null
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
    stockUpdatedAt: p.stock_updated_at || null,
    stockUpdateSource: p.stock_update_source || null,
    lastStockReminderSentAt: p.last_stock_reminder_sent_at || null,
    officers: officerRows.map(o => ({
      id: o.id,
      catalogId: o.catalog_id,
      name: o.name,
      level: o.level,
      coupons: o.coupons,
      stars: o.stars,
      personalPuzzles: Number(o.personal_puzzles) || 0,
      onlyPersonalPuzzles: Boolean(o.only_personal_puzzles),
      skills: parseSkills(o.skills_json),
      invested: parseInvested(o.invested_json)
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
      personalPuzzles: Number(o.personal_puzzles) || 0,
      onlyPersonalPuzzles: Boolean(o.only_personal_puzzles),
      skills: parseSkills(o.skills_json),
      invested: parseInvested(o.invested_json)
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
      killPoints: p.kill_points || p.kills || 0,
      hqLevel: (p.hq_level !== null && p.hq_level !== undefined) ? Number(p.hq_level) : null
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
    stockUpdatedAt: p.stock_updated_at || null,
    stockUpdateSource: p.stock_update_source || null,
    lastStockReminderSentAt: p.last_stock_reminder_sent_at || null,
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
  const vipLevel = Math.max(0, Math.min(17, Number(sector.vipLevel ?? data.vipLevel ?? data.vip_level ?? 0) || 0));
  const hqLevel = (sector.hqLevel !== undefined)
    ? (sector.hqLevel === null || sector.hqLevel === '' ? null : Math.max(1, parseInt(sector.hqLevel, 10)))
    : (data.hqLevel !== undefined ? (data.hqLevel === null || data.hqLevel === '' ? null : Math.max(1, parseInt(data.hqLevel, 10))) : null);
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
      INSERT INTO players (id, name, real_name, rank, user_id, vip_level, hq_level, vip_points, confidentiality_level, power, kills, kill_points, stock_coupons, stock_puzzles, stock_star_coupons, stock_legendary_stars_1, stock_legendary_stars_2, stock_legendary_stars_3, stock_chests, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        real_name = excluded.real_name,
        rank = excluded.rank,
        user_id = excluded.user_id,
        vip_level = excluded.vip_level,
        hq_level = excluded.hq_level,
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
    `).run(playerId, name, realName, rank, userId, vipLevel, hqLevel, vipPoints, confLevel, power, kills, killPoints, coupons, puzzles, starCoupons, legendaryStars1, legendaryStars2, legendaryStars3, chests, now);
  } else {
    const res = db.prepare(`
      INSERT INTO players (name, real_name, rank, user_id, vip_level, hq_level, vip_points, confidentiality_level, power, kills, kill_points, stock_coupons, stock_puzzles, stock_star_coupons, stock_legendary_stars_1, stock_legendary_stars_2, stock_legendary_stars_3, stock_chests, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(name, realName, rank, userId, vipLevel, hqLevel, vipPoints, confLevel, power, kills, killPoints, coupons, puzzles, starCoupons, legendaryStars1, legendaryStars2, legendaryStars3, chests, now);
    playerId = Number(res.lastInsertRowid);
  }

  if (Array.isArray(data.officers)) {
    for (const o of data.officers) {
      addPlayerOfficer(playerId, o);
    }
  }

  if (userId && playerId) {
    db.prepare('UPDATE users SET player_id = ? WHERE id = ? AND player_id IS NULL').run(playerId, userId);
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
  const vipLevel = Math.max(0, Math.min(17, Number(sec.vipLevel !== undefined ? sec.vipLevel : (updates.vipLevel !== undefined ? updates.vipLevel : (updates.vip_level !== undefined ? updates.vip_level : existing.sector.vipLevel))) || 0));
  const hqLevel = sec.hqLevel !== undefined
    ? (sec.hqLevel === null || sec.hqLevel === '' ? null : Math.max(1, parseInt(sec.hqLevel, 10)))
    : (updates.hqLevel !== undefined ? (updates.hqLevel === null || updates.hqLevel === '' ? null : Math.max(1, parseInt(updates.hqLevel, 10))) : (existing.sector.hqLevel ?? null));
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

  const stockChanged =
    coupons !== existing.stock.coupons ||
    puzzles !== existing.stock.puzzles ||
    starCoupons !== (existing.stock.starCoupons || 0) ||
    legendaryStars1 !== (existing.stock.legendaryStars1 || 0) ||
    legendaryStars2 !== (existing.stock.legendaryStars2 || 0) ||
    legendaryStars3 !== (existing.stock.legendaryStars3 || 0) ||
    chests !== existing.stock.chests;

  const newStock = { coupons, puzzles, starCoupons, legendaryStars1, legendaryStars2, legendaryStars3, chests };

  const stockUpdatedAt = stockChanged
    ? (updates.stockUpdatedAt || updates.stock_updated_at || now)
    : (updates.stockUpdatedAt !== undefined ? updates.stockUpdatedAt : (updates.stock_updated_at !== undefined ? updates.stock_updated_at : (existing.stockUpdatedAt || null)));

  const stockUpdateSource = stockChanged
    ? (updates.stockUpdateSource || updates.stock_update_source || 'manual_edit')
    : (updates.stockUpdateSource !== undefined ? updates.stockUpdateSource : (updates.stock_update_source !== undefined ? updates.stock_update_source : (existing.stockUpdateSource || null)));

  if (stockChanged && updates.recordHistory !== false) {
    const diff = calculateStockDiff(existing.stock, newStock);
    if (diff.summary !== 'Без изменений') {
      db.prepare(`
        INSERT INTO stock_history_records (
          player_id, user_id, source, snapshot_before, snapshot_after, diff_summary, screenshot_path, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        updates.editorUserId !== undefined ? updates.editorUserId : (userId || existing.userId || null),
        stockUpdateSource,
        JSON.stringify(existing.stock),
        JSON.stringify(newStock),
        diff.summary,
        updates.screenshotPath || updates.screenshot_path || null,
        stockUpdatedAt
      );
    }
  }

  db.prepare(`
    UPDATE players
    SET name = ?, real_name = ?, rank = ?, user_id = ?,
        vip_level = ?, hq_level = ?, vip_points = ?, confidentiality_level = ?, power = ?, kills = ?, kill_points = ?,
        stock_coupons = ?, stock_puzzles = ?, stock_star_coupons = ?, stock_legendary_stars_1 = ?, stock_legendary_stars_2 = ?, stock_legendary_stars_3 = ?, stock_chests = ?,
        stock_updated_at = ?, stock_update_source = ?, updated_at = ?
    WHERE id = ?
  `).run(name, realName, rank, userId, vipLevel, hqLevel, vipPoints, confLevel, power, kills, killPoints, coupons, puzzles, starCoupons, legendaryStars1, legendaryStars2, legendaryStars3, chests, stockUpdatedAt, stockUpdateSource, now, id);

  if (updates.userId !== undefined || updates.user_id !== undefined) {
    if (userId) {
      db.prepare('UPDATE users SET player_id = ? WHERE id = ? AND player_id IS NULL').run(id, userId);
    }
    if (existing.userId && existing.userId !== userId) {
      const otherSector = db.prepare('SELECT id FROM players WHERE user_id = ? AND id != ? ORDER BY id ASC LIMIT 1').get(existing.userId);
      db.prepare('UPDATE users SET player_id = ? WHERE id = ? AND player_id = ?').run(otherSector ? otherSector.id : null, existing.userId, id);
    }
  }

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
  const stars = Math.max(0, Math.min(5, Number(officerData.stars) || 0));
  const personalPuzzles = Number(officerData.personalPuzzles ?? officerData.personal_puzzles) || 0;
  const onlyPersonalPuzzles = Boolean(officerData.onlyPersonalPuzzles ?? officerData.only_personal_puzzles) ? 1 : 0;
  const skills = parseSkills(officerData.skills ?? officerData.skills_json);
  const skillsJson = JSON.stringify(skills);
  const invested = parseInvested(officerData.invested ?? officerData.invested_json);
  const investedJson = JSON.stringify(invested);

  db.prepare(`
    INSERT INTO player_officers (id, player_id, catalog_id, name, level, coupons, stars, personal_puzzles, only_personal_puzzles, skills_json, invested_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      catalog_id = excluded.catalog_id,
      name = excluded.name,
      level = excluded.level,
      coupons = excluded.coupons,
      stars = excluded.stars,
      personal_puzzles = excluded.personal_puzzles,
      only_personal_puzzles = excluded.only_personal_puzzles,
      skills_json = excluded.skills_json,
      invested_json = excluded.invested_json
  `).run(id, playerId, catalogId, name, level, coupons, stars, personalPuzzles, onlyPersonalPuzzles, skillsJson, investedJson);

  return { id, playerId, catalogId, name, level, coupons, stars, personalPuzzles, onlyPersonalPuzzles: Boolean(onlyPersonalPuzzles), skills, invested };
}

function updatePlayerOfficer(playerId, officerId, updates) {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM player_officers WHERE id = ? AND player_id = ?').get(officerId, playerId);
  if (!existing) return null;

  const level = updates.level !== undefined ? Number(updates.level) : existing.level;
  const coupons = updates.coupons !== undefined ? Number(updates.coupons) : existing.coupons;
  const stars = updates.stars !== undefined ? Math.max(0, Math.min(5, Number(updates.stars) || 0)) : Math.min(5, existing.stars);
  const personalPuzzles = updates.personalPuzzles !== undefined
    ? Number(updates.personalPuzzles) || 0
    : (updates.personal_puzzles !== undefined ? Number(updates.personal_puzzles) || 0 : (existing.personal_puzzles || 0));
  const onlyPersonalPuzzles = updates.onlyPersonalPuzzles !== undefined
    ? (Boolean(updates.onlyPersonalPuzzles) ? 1 : 0)
    : (updates.only_personal_puzzles !== undefined ? (Boolean(updates.only_personal_puzzles) ? 1 : 0) : (existing.only_personal_puzzles ? 1 : 0));
  const name = updates.name !== undefined ? updates.name : existing.name;

  let skills;
  if (updates.skills !== undefined || updates.skills_json !== undefined) {
    skills = parseSkills(updates.skills ?? updates.skills_json);
  } else {
    skills = parseSkills(existing.skills_json);
  }
  const skillsJson = JSON.stringify(skills);

  let invested;
  if (updates.invested !== undefined || updates.invested_json !== undefined) {
    invested = parseInvested(updates.invested ?? updates.invested_json);
  } else {
    invested = parseInvested(existing.invested_json);
  }
  const investedJson = JSON.stringify(invested);

  db.prepare(`
    UPDATE player_officers
    SET level = ?, coupons = ?, stars = ?, personal_puzzles = ?, only_personal_puzzles = ?, name = ?, skills_json = ?, invested_json = ?
    WHERE id = ? AND player_id = ?
  `).run(level, coupons, stars, personalPuzzles, onlyPersonalPuzzles, name, skillsJson, investedJson, officerId, playerId);

  return {
    id: officerId,
    catalogId: existing.catalog_id,
    name,
    level,
    coupons,
    stars,
    personalPuzzles,
    onlyPersonalPuzzles: Boolean(onlyPersonalPuzzles),
    skills,
    invested
  };
}

function deletePlayerOfficer(playerId, officerId) {
  const db = getDb();
  db.prepare('DELETE FROM player_officers WHERE id = ? AND player_id = ?').run(officerId, playerId);
  return true;
}

// ─── VIP TIERS ────────────────────────────────────────────────
const DEFAULT_VIP_TIERS = [
  { level: 1, points: 0, dailyPuzzles: 0, dailyChests: 1 },
  { level: 2, points: 200, dailyPuzzles: 0, dailyChests: 1 },
  { level: 3, points: 700, dailyPuzzles: 0, dailyChests: 1 },
  { level: 4, points: 2500, dailyPuzzles: 0, dailyChests: 1 },
  { level: 5, points: 6000, dailyPuzzles: 0, dailyChests: 1 },
  { level: 6, points: 15000, dailyPuzzles: 0, dailyChests: 1 },
  { level: 7, points: 35000, dailyPuzzles: 0, dailyChests: 1 },
  { level: 8, points: 75000, dailyPuzzles: 0, dailyChests: 1 },
  { level: 9, points: 130000, dailyPuzzles: 0, dailyChests: 1 },
  { level: 10, points: 220000, dailyPuzzles: 0, dailyChests: 1 },
  { level: 11, points: 340000, dailyPuzzles: 1, dailyChests: 1 },
  { level: 12, points: 480000, dailyPuzzles: 2, dailyChests: 1 },
  { level: 13, points: 600000, dailyPuzzles: 2, dailyChests: 1 },
  { level: 14, points: 750000, dailyPuzzles: 3, dailyChests: 1 },
  { level: 15, points: 1000000, dailyPuzzles: 3, dailyChests: 1 },
  { level: 16, points: 1300000, dailyPuzzles: 4, dailyChests: 1 },
  { level: 17, points: 1700000, dailyPuzzles: 4, dailyChests: 1 },
];

function getVipTiers() {
  const db = getDb();
  const rows = db.prepare('SELECT level, points, daily_puzzles as dailyPuzzles, daily_chests as dailyChests FROM vip_tiers WHERE level <= 17 ORDER BY level ASC').all();
  return rows;
}

function setVipTiers(tiers) {
  if (!Array.isArray(tiers) || tiers.length === 0) return getVipTiers();
  const db = getDb();
  const insertStmt = db.prepare(`
    INSERT INTO vip_tiers (level, points, daily_puzzles, daily_chests)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(level) DO UPDATE SET
      points = excluded.points,
      daily_puzzles = excluded.daily_puzzles,
      daily_chests = excluded.daily_chests
  `);
  db.exec('BEGIN TRANSACTION');
  try {
    db.prepare('DELETE FROM vip_tiers WHERE level > 17').run();
    for (const t of tiers) {
      const level = Math.max(1, Math.min(17, parseInt(t.level) || 1));
      const points = Math.max(0, parseInt(t.points) || 0);
      const dailyPuzzles = Math.max(0, parseFloat(t.dailyPuzzles ?? t.daily_puzzles) || 0);
      const dailyChests = Math.max(0, parseFloat(t.dailyChests ?? t.daily_chests) || 1);
      insertStmt.run(level, points, dailyPuzzles, dailyChests);
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return getVipTiers();
}

function clearCatalog() {
  const db = getDb();
  db.prepare('DELETE FROM officer_catalog').run();
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
    starCouponCost: r.star_coupon_cost ?? 360,
    upgradeType: r.upgrade_type || 'standard',
    medalsBeforeTraining: r.medals_before_training ?? 690,
    medalsTraining: r.medals_training ?? 900,
    medalsTotal: r.medals_total ?? ((r.medals_before_training ?? 690) + (r.medals_training ?? 900))
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
  const medalsBeforeTraining = item.medalsBeforeTraining ?? item.medals_before_training ?? 690;
  const medalsTraining = item.medalsTraining ?? item.medals_training ?? 900;
  const medalsTotal = item.medalsTotal ?? item.medals_total ?? (Number(medalsBeforeTraining) + Number(medalsTraining));
  const starCouponCost = item.starCouponCost ?? item.star_coupon_cost ?? 360;
  const couponPerPuzzle = item.couponPerPuzzle ?? item.coupon_per_puzzle ?? 720;
  const generation = item.generation ?? 8;

  db.prepare(`
    INSERT INTO officer_catalog (id, name, type, generation, coupon_per_puzzle, star_coupon_cost, upgrade_type, medals_before_training, medals_training, medals_total)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      type = excluded.type,
      generation = excluded.generation,
      coupon_per_puzzle = excluded.coupon_per_puzzle,
      star_coupon_cost = excluded.star_coupon_cost,
      upgrade_type = excluded.upgrade_type,
      medals_before_training = excluded.medals_before_training,
      medals_training = excluded.medals_training,
      medals_total = excluded.medals_total
  `).run(
    item.id,
    item.name,
    item.type || 'Пехота',
    generation,
    couponPerPuzzle,
    starCouponCost,
    upgradeType,
    medalsBeforeTraining,
    medalsTraining,
    medalsTotal
  );
  return {
    ...item,
    generation,
    couponPerPuzzle,
    starCouponCost,
    upgradeType,
    medalsBeforeTraining,
    medalsTraining,
    medalsTotal
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
    isPeriodic: r.is_periodic !== undefined && r.is_periodic !== null ? Number(r.is_periodic) : 1,
    startDayOfWeek: r.start_day_of_week !== undefined && r.start_day_of_week !== null ? Number(r.start_day_of_week) : 2,
    endDayOfWeek: r.end_day_of_week !== undefined && r.end_day_of_week !== null ? Number(r.end_day_of_week) : 3,
    activeWeeks: r.active_weeks !== undefined && r.active_weeks !== null ? Number(r.active_weeks) : 1,
    breakWeeks: r.break_weeks !== undefined && r.break_weeks !== null ? Number(r.break_weeks) : 1,
    weekOffset: r.week_offset !== undefined && r.week_offset !== null ? Number(r.week_offset) : 0,
    places: JSON.parse(r.places_json || '[]')
  }));
}

function saveEventType(data) {
  const db = getDb();
  const placesJson = JSON.stringify(data.places || []);
  const isPeriodic = data.isPeriodic !== undefined ? (data.isPeriodic ? 1 : 0) : (data.is_periodic !== undefined ? (data.is_periodic ? 1 : 0) : 1);
  const startDayOfWeek = data.startDayOfWeek !== undefined ? Number(data.startDayOfWeek) : (data.start_day_of_week !== undefined ? Number(data.start_day_of_week) : 2);
  const endDayOfWeek = data.endDayOfWeek !== undefined ? Number(data.endDayOfWeek) : (data.end_day_of_week !== undefined ? Number(data.end_day_of_week) : 3);
  const activeWeeks = data.activeWeeks !== undefined ? Number(data.activeWeeks) : (data.active_weeks !== undefined ? Number(data.active_weeks) : 1);
  const breakWeeks = data.breakWeeks !== undefined ? Number(data.breakWeeks) : (data.break_weeks !== undefined ? Number(data.break_weeks) : 1);
  const weekOffset = data.weekOffset !== undefined ? Number(data.weekOffset) : (data.week_offset !== undefined ? Number(data.week_offset) : 0);

  if (data.id) {
    db.prepare(`
      INSERT INTO event_types (id, name, color, places_json, is_periodic, start_day_of_week, end_day_of_week, active_weeks, break_weeks, week_offset)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        color = excluded.color,
        places_json = excluded.places_json,
        is_periodic = excluded.is_periodic,
        start_day_of_week = excluded.start_day_of_week,
        end_day_of_week = excluded.end_day_of_week,
        active_weeks = excluded.active_weeks,
        break_weeks = excluded.break_weeks,
        week_offset = excluded.week_offset
    `).run(data.id, data.name, data.color || '#8b5cf6', placesJson, isPeriodic, startDayOfWeek, endDayOfWeek, activeWeeks, breakWeeks, weekOffset);
    return {
      ...data,
      isPeriodic,
      startDayOfWeek,
      endDayOfWeek,
      activeWeeks,
      breakWeeks,
      weekOffset
    };
  } else {
    const res = db.prepare(`
      INSERT INTO event_types (name, color, places_json, is_periodic, start_day_of_week, end_day_of_week, active_weeks, break_weeks, week_offset)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(data.name, data.color || '#8b5cf6', placesJson, isPeriodic, startDayOfWeek, endDayOfWeek, activeWeeks, breakWeeks, weekOffset);
    return {
      ...data,
      id: Number(res.lastInsertRowid),
      isPeriodic,
      startDayOfWeek,
      endDayOfWeek,
      activeWeeks,
      breakWeeks,
      weekOffset
    };
  }
}

function updateBulkEventTypeRewards(typeIds, places) {
  if (!Array.isArray(typeIds) || typeIds.length === 0) return 0;
  if (!Array.isArray(places)) return 0;
  const db = getDb();
  const placesJson = JSON.stringify(places);
  let updatedCount = 0;

  db.exec('BEGIN TRANSACTION');
  try {
    const stmt = db.prepare('UPDATE event_types SET places_json = ? WHERE id = ?');
    for (const tid of typeIds) {
      const res = stmt.run(placesJson, Number(tid));
      if (res.changes > 0) {
        updatedCount += res.changes;
      }
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  return updatedCount;
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

// ─── STOCK HISTORY & AUDIT LOG ───────────────────────────────────────────
function getStockHistory(playerId, limit = 50) {
  const db = getDb();
  if (playerId === undefined || playerId === null) {
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

  const pId = Number(playerId);
  const lim = Math.max(1, Math.min(200, Number(limit) || 50));
  const rows = db.prepare(`
    SELECT shr.*, u.username as author_username, u.rank as author_rank
    FROM stock_history_records shr
    LEFT JOIN users u ON u.id = shr.user_id
    WHERE shr.player_id = ?
    ORDER BY shr.created_at DESC, shr.id DESC
    LIMIT ?
  `).all(pId, lim);

  return rows.map(r => {
    let before = {};
    let after = {};
    try {
      before = typeof r.snapshot_before === 'string' ? JSON.parse(r.snapshot_before) : (r.snapshot_before || {});
    } catch (e) {}
    try {
      after = typeof r.snapshot_after === 'string' ? JSON.parse(r.snapshot_after) : (r.snapshot_after || {});
    } catch (e) {}

    return {
      id: r.id,
      playerId: r.player_id,
      userId: r.user_id,
      authorUsername: r.author_username || null,
      authorRank: r.author_rank || null,
      source: r.source,
      snapshotBefore: before,
      snapshotAfter: after,
      diffSummary: r.diff_summary,
      screenshotPath: r.screenshot_path || null,
      createdAt: r.created_at
    };
  });
}

function getStockHistoryByPlayerId(playerId, limit = 50) {
  return getStockHistory(playerId, limit);
}

function recordStockHistory(arg1, arg2, arg3) {
  const db = getDb();
  if (arg1 && typeof arg1 === 'object') {
    const {
      playerId,
      userId = null,
      source = 'manual_edit',
      snapshotBefore = {},
      snapshotAfter = {},
      diffSummary = '',
      screenshotPath = null,
      createdAt = new Date().toISOString()
    } = arg1;

    const snapBeforeStr = typeof snapshotBefore === 'string' ? snapshotBefore : JSON.stringify(snapshotBefore || {});
    const snapAfterStr = typeof snapshotAfter === 'string' ? snapshotAfter : JSON.stringify(snapshotAfter || {});

    const res = db.prepare(`
      INSERT INTO stock_history_records (
        player_id, user_id, source, snapshot_before, snapshot_after, diff_summary, screenshot_path, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      playerId,
      userId ? Number(userId) : null,
      source,
      snapBeforeStr,
      snapAfterStr,
      diffSummary,
      screenshotPath || null,
      createdAt
    );

    db.prepare(`
      UPDATE players
      SET stock_updated_at = ?, stock_update_source = ?
      WHERE id = ?
    `).run(createdAt, source, playerId);

    return {
      id: Number(res.lastInsertRowid),
      playerId,
      userId: userId ? Number(userId) : null,
      source,
      snapshotBefore: typeof snapshotBefore === 'string' ? JSON.parse(snapshotBefore) : snapshotBefore,
      snapshotAfter: typeof snapshotAfter === 'string' ? JSON.parse(snapshotAfter) : snapshotAfter,
      diffSummary,
      screenshotPath: screenshotPath || null,
      createdAt
    };
  }

  const playerId = arg1;
  const stock = arg2 || {};
  const d = arg3 || new Date().toISOString().slice(0, 10);
  db.prepare(`
    INSERT INTO stock_history (player_id, date, coupons, puzzles, chests)
    VALUES (?, ?, ?, ?, ?)
  `).run(playerId, d, stock.coupons || 0, stock.puzzles || 0, stock.chests || 0);
}

function confirmPlayerStock(playerId, userId = null) {
  const player = getPlayerById(playerId);
  if (!player) return null;
  const nowIso = new Date().toISOString();
  recordStockHistory({
    playerId: player.id,
    userId: userId ? Number(userId) : null,
    source: 'manual_confirm',
    snapshotBefore: player.stock || {},
    snapshotAfter: player.stock || {},
    diffSummary: 'Подтверждена актуальность склада без изменений',
    screenshotPath: null,
    createdAt: nowIso
  });
  return getPlayerById(playerId);
}

async function cleanupExpiredScreenshots(dbInstance, screenshotsBaseDir) {
  const db = dbInstance || getDb();
  const baseDir = screenshotsBaseDir || path.join(__dirname, 'data', 'screenshots');
  const resolvedBaseDir = path.resolve(baseDir);

  const rows = db.prepare(`
    SELECT id, screenshot_path
    FROM stock_history_records
    WHERE screenshot_path IS NOT NULL AND screenshot_path != '' AND created_at < datetime('now', '-30 days')
  `).all();

  let cleanedCount = 0;
  for (const r of rows) {
    if (r.screenshot_path) {
      const targetPath = path.isAbsolute(r.screenshot_path)
        ? path.resolve(r.screenshot_path)
        : path.resolve(resolvedBaseDir, r.screenshot_path);

      if (targetPath.startsWith(resolvedBaseDir + path.sep) || targetPath === resolvedBaseDir) {
        try {
          await fs.promises.unlink(targetPath);
        } catch (e) {}
      }
      db.prepare('UPDATE stock_history_records SET screenshot_path = NULL WHERE id = ?').run(r.id);
      cleanedCount++;
    }
  }
  return cleanedCount;
}

// ─── IMPORT / EXPORT ─────────────────────────────────────────
function exportKowJson() {
  const players = getPlayers();
  const officerCatalog = getCatalog();
  const eventTypes = getEventTypes();
  const events = getEvents();
  const stockHistory = getStockHistory();
  const users = getUsers();
  const userPermissions = {};
  for (const u of users) {
    if (u && u.username) {
      userPermissions[u.username] = Array.isArray(u.permissions) ? u.permissions : [];
    }
  }

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
    userPermissions,
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
            if (rawOfficer.personalPuzzles !== undefined || rawOfficer.personal_puzzles !== undefined) {
              o.personalPuzzles = rawOfficer.personalPuzzles ?? rawOfficer.personal_puzzles;
            }
            if (rawOfficer.onlyPersonalPuzzles !== undefined || rawOfficer.only_personal_puzzles !== undefined) {
              o.onlyPersonalPuzzles = Boolean(rawOfficer.onlyPersonalPuzzles ?? rawOfficer.only_personal_puzzles);
            }
            if (rawOfficer.skills !== undefined) {
              o.skills = rawOfficer.skills;
            } else if (rawOfficer.skills_json !== undefined) {
              o.skills_json = rawOfficer.skills_json;
            }
            if (rawOfficer.invested !== undefined) {
              o.invested = rawOfficer.invested;
            } else if (rawOfficer.invested_json !== undefined) {
              o.invested_json = rawOfficer.invested_json;
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
    if (raw && raw.userPermissions && typeof raw.userPermissions === 'object' && !Array.isArray(raw.userPermissions)) {
      for (const [uname, perms] of Object.entries(raw.userPermissions)) {
        if (!uname || !Array.isArray(perms)) continue;
        const existingUser = findUserByUsername(uname);
        if (existingUser) {
          updateUser(existingUser.id, { permissions: perms });
        }
      }
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
    isPeriodic: 1,
    startDayOfWeek: 2,
    endDayOfWeek: 3,
    activeWeeks: 1,
    breakWeeks: 1,
    weekOffset: 0,
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
    color: '#10b981',
    isPeriodic: 1,
    startDayOfWeek: 6,
    endDayOfWeek: 1,
    activeWeeks: 1,
    breakWeeks: 1,
    weekOffset: 0,
    places: [
      { place: 1, label: '🥇 1 место', coupons: 12500 },
      { place: 2, label: '🥈 2 место', coupons: 6500 },
      { place: 3, label: '🥉 3 место', coupons: 3500 },
      { place: 4, label: '4–10 место', coupons: 2750 },
    ]
  });

  const potType = saveEventType({
    id: 3,
    name: 'Сила Времени',
    color: '#f59e0b',
    isPeriodic: 1,
    startDayOfWeek: 2,
    endDayOfWeek: 4,
    activeWeeks: 1,
    breakWeeks: 1,
    weekOffset: 1,
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

  const userCols = getColumns('users');
  if (userCols.length > 0) {
    if (!userCols.includes('is_blocked')) {
      db.exec("ALTER TABLE users ADD COLUMN is_blocked INTEGER NOT NULL DEFAULT 0;");
    }
    if (!userCols.includes('permissions')) {
      db.exec("ALTER TABLE users ADD COLUMN permissions TEXT NOT NULL DEFAULT '[]';");
    }
    if (!userCols.includes('telegram_chat_id')) {
      db.exec("ALTER TABLE users ADD COLUMN telegram_chat_id INTEGER NULL;");
    }
    if (!userCols.includes('telegram_username')) {
      db.exec("ALTER TABLE users ADD COLUMN telegram_username TEXT NULL;");
    }
    if (!userCols.includes('telegram_notifications_enabled')) {
      db.exec("ALTER TABLE users ADD COLUMN telegram_notifications_enabled INTEGER NOT NULL DEFAULT 1;");
    }
    if (!userCols.includes('telegram_bind_token')) {
      db.exec("ALTER TABLE users ADD COLUMN telegram_bind_token TEXT NULL;");
    }
    if (!userCols.includes('telegram_bind_expires_at')) {
      db.exec("ALTER TABLE users ADD COLUMN telegram_bind_expires_at TEXT NULL;");
    }
    if (!userCols.includes('last_active_at')) {
      db.exec("ALTER TABLE users ADD COLUMN last_active_at TEXT NULL;");
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
    if (!playerCols.includes('stock_updated_at')) {
      db.exec("ALTER TABLE players ADD COLUMN stock_updated_at TEXT NULL;");
    }
    if (!playerCols.includes('stock_update_source')) {
      db.exec("ALTER TABLE players ADD COLUMN stock_update_source TEXT NULL;");
    }
    if (!playerCols.includes('last_stock_reminder_sent_at')) {
      db.exec("ALTER TABLE players ADD COLUMN last_stock_reminder_sent_at TEXT NULL;");
    }
    if (!playerCols.includes('hq_level')) {
      db.exec("ALTER TABLE players ADD COLUMN hq_level INTEGER NULL DEFAULT NULL;");
    }

    // Soft migration for VIP > 17 (e.g. players who entered HQ level into VIP level)
    if (playerCols.includes('vip_level')) {
      try {
        db.exec(`
          UPDATE players
          SET hq_level = vip_level, vip_level = 0
          WHERE vip_level > 17 AND (hq_level IS NULL OR hq_level = 0);
        `);
        db.exec("UPDATE players SET vip_level = 17 WHERE vip_level > 17;");
      } catch (e) {
        console.error('[VIP migration error]:', e);
      }
    }
  }

  // Ensure vip_tiers only keeps levels <= 17
  try {
    db.exec("DELETE FROM vip_tiers WHERE level > 17;");
  } catch (e) {}

  const officerCols = getColumns('player_officers');
  if (officerCols.length > 0) {
    if (!officerCols.includes('skills_json')) {
      db.exec("ALTER TABLE player_officers ADD COLUMN skills_json TEXT NOT NULL DEFAULT '[1,1,1,1]';");
    }
    if (!officerCols.includes('invested_json')) {
      db.exec("ALTER TABLE player_officers ADD COLUMN invested_json TEXT NOT NULL DEFAULT '{}';");
    }
    if (!officerCols.includes('personal_puzzles')) {
      db.exec("ALTER TABLE player_officers ADD COLUMN personal_puzzles INTEGER NOT NULL DEFAULT 0;");
    }
    if (!officerCols.includes('only_personal_puzzles')) {
      db.exec("ALTER TABLE player_officers ADD COLUMN only_personal_puzzles INTEGER NOT NULL DEFAULT 0;");
    }
    try {
      db.exec("UPDATE player_officers SET stars = 5 WHERE stars > 5;");
    } catch (e) {}
  }

  const eventTypeCols = getColumns('event_types');
  if (eventTypeCols.length > 0) {
    if (!eventTypeCols.includes('is_periodic')) {
      db.exec("ALTER TABLE event_types ADD COLUMN is_periodic INTEGER NOT NULL DEFAULT 1;");
    }
    if (!eventTypeCols.includes('start_day_of_week')) {
      db.exec("ALTER TABLE event_types ADD COLUMN start_day_of_week INTEGER NOT NULL DEFAULT 2;");
    }
    if (!eventTypeCols.includes('end_day_of_week')) {
      db.exec("ALTER TABLE event_types ADD COLUMN end_day_of_week INTEGER NOT NULL DEFAULT 3;");
    }
    if (!eventTypeCols.includes('active_weeks')) {
      db.exec("ALTER TABLE event_types ADD COLUMN active_weeks INTEGER NOT NULL DEFAULT 1;");
    }
    if (!eventTypeCols.includes('break_weeks')) {
      db.exec("ALTER TABLE event_types ADD COLUMN break_weeks INTEGER NOT NULL DEFAULT 1;");
    }
    if (!eventTypeCols.includes('week_offset')) {
      db.exec("ALTER TABLE event_types ADD COLUMN week_offset INTEGER NOT NULL DEFAULT 0;");
    }
  }

  const catalogCols = getColumns('officer_catalog');
  if (catalogCols.length > 0) {
    if (!catalogCols.includes('upgrade_type')) {
      db.exec("ALTER TABLE officer_catalog ADD COLUMN upgrade_type TEXT NOT NULL DEFAULT 'standard';");
    }
    if (!catalogCols.includes('star_coupon_cost')) {
      db.exec("ALTER TABLE officer_catalog ADD COLUMN star_coupon_cost INTEGER NOT NULL DEFAULT 360;");
    }
  }

  // Ensure vip_tiers exists and is seeded
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS vip_tiers (
        level INTEGER PRIMARY KEY,
        points INTEGER NOT NULL DEFAULT 0,
        daily_puzzles REAL NOT NULL DEFAULT 0,
        daily_chests REAL NOT NULL DEFAULT 1
      );
    `);
    const countVip = db.prepare('SELECT count(*) as count FROM vip_tiers').get().count;
    if (countVip === 0) {
      const insertVip = db.prepare('INSERT INTO vip_tiers (level, points, daily_puzzles, daily_chests) VALUES (?, ?, ?, ?)');
      for (const t of DEFAULT_VIP_TIERS) {
        insertVip.run(t.level, t.points, t.dailyPuzzles, t.dailyChests);
      }
    }
  } catch (e) {}

  db.exec(`
    CREATE TABLE IF NOT EXISTS stock_history_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      user_id INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
      source TEXT NOT NULL CHECK(source IN ('ocr_scan', 'manual_edit', 'manual_confirm', 'event_reward')),
      snapshot_before TEXT NOT NULL,
      snapshot_after TEXT NOT NULL,
      diff_summary TEXT NOT NULL,
      screenshot_path TEXT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_stock_history_player ON stock_history_records(player_id);
    CREATE INDEX IF NOT EXISTS idx_stock_history_created ON stock_history_records(created_at);
  `);

  try {
    const tableInfo = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='stock_history_records'").get();
    if (tableInfo && tableInfo.sql && !tableInfo.sql.includes('manual_confirm')) {
      db.exec(`
        PRAGMA foreign_keys = OFF;
        CREATE TABLE stock_history_records_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
          user_id INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
          source TEXT NOT NULL CHECK(source IN ('ocr_scan', 'manual_edit', 'manual_confirm', 'event_reward')),
          snapshot_before TEXT NOT NULL,
          snapshot_after TEXT NOT NULL,
          diff_summary TEXT NOT NULL,
          screenshot_path TEXT NULL,
          created_at TEXT NOT NULL
        );
        INSERT INTO stock_history_records_new SELECT * FROM stock_history_records;
        DROP TABLE stock_history_records;
        ALTER TABLE stock_history_records_new RENAME TO stock_history_records;
        CREATE INDEX IF NOT EXISTS idx_stock_history_player ON stock_history_records(player_id);
        CREATE INDEX IF NOT EXISTS idx_stock_history_created ON stock_history_records(created_at);
        PRAGMA foreign_keys = ON;
      `);
    }
  } catch (e) {}

  db.exec(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS notification_templates (
      key TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      channel TEXT NOT NULL CHECK(channel IN ('personal', 'staff')),
      parse_mode TEXT NOT NULL DEFAULT 'HTML',
      template TEXT NOT NULL,
      default_template TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  try {
    if (DEFAULT_NOTIFICATION_TEMPLATES) {
      const insertT = db.prepare(`
        INSERT OR IGNORE INTO notification_templates (key, title, channel, parse_mode, template, default_template, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      const now = new Date().toISOString();
      for (const [key, item] of Object.entries(DEFAULT_NOTIFICATION_TEMPLATES)) {
        insertT.run(
          item.key || key,
          item.title || key,
          item.channel || 'personal',
          item.parseMode || 'HTML',
          item.template,
          item.template,
          now
        );
      }
    }
  } catch (e) {}
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
      db.exec('PRAGMA synchronous = NORMAL;');
      db.exec('PRAGMA wal_autocheckpoint = 100;');
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
      is_blocked INTEGER NOT NULL DEFAULT 0,
      player_id INTEGER NULL REFERENCES players(id) ON DELETE SET NULL,
      permissions TEXT NOT NULL DEFAULT '[]',
      telegram_chat_id INTEGER NULL,
      telegram_username TEXT NULL,
      telegram_notifications_enabled INTEGER NOT NULL DEFAULT 1,
      telegram_bind_token TEXT NULL,
      telegram_bind_expires_at TEXT NULL,
      last_active_at TEXT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS players (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      real_name TEXT DEFAULT '',
      rank TEXT NOT NULL DEFAULT 'r3',
      user_id INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
      vip_level INTEGER DEFAULT 0,
      hq_level INTEGER NULL DEFAULT NULL,
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
      stock_updated_at TEXT NULL,
      stock_update_source TEXT NULL,
      last_stock_reminder_sent_at TEXT NULL,
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
      personal_puzzles INTEGER NOT NULL DEFAULT 0,
      only_personal_puzzles INTEGER NOT NULL DEFAULT 0,
      skills_json TEXT NOT NULL DEFAULT '[1,1,1,1]',
      invested_json TEXT NOT NULL DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS officer_catalog (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      generation INTEGER NOT NULL DEFAULT 8,
      coupon_per_puzzle INTEGER NOT NULL DEFAULT 720,
      star_coupon_cost INTEGER NOT NULL DEFAULT 360,
      upgrade_type TEXT NOT NULL DEFAULT 'standard',
      medals_before_training INTEGER DEFAULT 690,
      medals_training INTEGER DEFAULT 900,
      medals_total INTEGER DEFAULT 1590
    );

    CREATE TABLE IF NOT EXISTS vip_tiers (
      level INTEGER PRIMARY KEY,
      points INTEGER NOT NULL DEFAULT 0,
      daily_puzzles REAL NOT NULL DEFAULT 0,
      daily_chests REAL NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS event_types (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT '#8b5cf6',
      places_json TEXT NOT NULL,
      is_periodic INTEGER NOT NULL DEFAULT 1,
      start_day_of_week INTEGER NOT NULL DEFAULT 2,
      end_day_of_week INTEGER NOT NULL DEFAULT 3,
      active_weeks INTEGER NOT NULL DEFAULT 1,
      break_weeks INTEGER NOT NULL DEFAULT 1,
      week_offset INTEGER NOT NULL DEFAULT 0
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

    CREATE TABLE IF NOT EXISTS stock_history_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      user_id INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
      source TEXT NOT NULL CHECK(source IN ('ocr_scan', 'manual_edit', 'manual_confirm', 'event_reward')),
      snapshot_before TEXT NOT NULL,
      snapshot_after TEXT NOT NULL,
      diff_summary TEXT NOT NULL,
      screenshot_path TEXT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_stock_history_player ON stock_history_records(player_id);
    CREATE INDEX IF NOT EXISTS idx_stock_history_created ON stock_history_records(created_at);

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      expires_at TEXT
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS notification_templates (
      key TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      channel TEXT NOT NULL CHECK(channel IN ('personal', 'staff')),
      parse_mode TEXT NOT NULL DEFAULT 'HTML',
      template TEXT NOT NULL,
      default_template TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  migrateSchema(db);

  // Check if empty to auto-bootstrap
  const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
  if (userCount === 0) {
    seedDemoData(db);
  }

  // Safe backfill for links between users and players
  try {
    db.exec(`
      UPDATE players
      SET user_id = (SELECT id FROM users WHERE users.player_id = players.id)
      WHERE user_id IS NULL AND id IN (SELECT player_id FROM users WHERE player_id IS NOT NULL);

      UPDATE users
      SET player_id = (SELECT id FROM players WHERE players.user_id = users.id ORDER BY id ASC LIMIT 1)
      WHERE player_id IS NULL AND id IN (SELECT user_id FROM players WHERE user_id IS NOT NULL);
    `);
  } catch (e) {}

  return db;
}

// ─── APP SETTINGS ───────────────────────────────────────────
function getAppSetting(key) {
  if (!key) return null;
  const row = getDb().prepare('SELECT value FROM app_settings WHERE key = ?').get(key);
  return row ? row.value : null;
}

function setAppSetting(key, value) {
  if (!key) return null;
  const strVal = value !== undefined && value !== null ? String(value) : '';
  const now = new Date().toISOString();
  getDb().prepare(`
    INSERT INTO app_settings (key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(key, strVal, now);
  return strVal;
}

function getMieruSettings() {
  return {
    enabled: getAppSetting('mieru_enabled') === 'true',
    server: getAppSetting('mieru_server') || '',
    portRange: getAppSetting('mieru_port_range') || '10000-10050',
    user: getAppSetting('mieru_user') || '',
    password: getAppSetting('mieru_password') || '',
    transport: getAppSetting('mieru_transport') || 'TCP',
    socks5Port: parseInt(getAppSetting('mieru_socks5_port'), 10) || 1080,
    configJson: getAppSetting('mieru_config_json') || ''
  };
}

function saveMieruSettings(settings = {}) {
  if (settings.enabled !== undefined) {
    setAppSetting('mieru_enabled', settings.enabled ? 'true' : 'false');
  }
  if (settings.server !== undefined) {
    setAppSetting('mieru_server', String(settings.server).trim());
  }
  if (settings.portRange !== undefined) {
    setAppSetting('mieru_port_range', String(settings.portRange).trim());
  }
  if (settings.user !== undefined) {
    setAppSetting('mieru_user', String(settings.user).trim());
  }
  if (settings.password !== undefined && !String(settings.password).includes('***')) {
    setAppSetting('mieru_password', String(settings.password).trim());
  }
  if (settings.transport !== undefined) {
    setAppSetting('mieru_transport', String(settings.transport).trim().toUpperCase());
  }
  if (settings.socks5Port !== undefined) {
    setAppSetting('mieru_socks5_port', String(parseInt(settings.socks5Port, 10) || 1080));
  }
  if (settings.configJson !== undefined) {
    setAppSetting('mieru_config_json', String(settings.configJson).trim());
  }
  return getMieruSettings();
}

// ─── STALE ALERT SCHEDULE ────────────────────────────────────
function getStaleAlertSchedule() {
  const frequency = getAppSetting('tg_stale_frequency') || 'weekly';
  const time = getAppSetting('tg_stale_time') || '10:00';
  const smartSilenceRaw = getAppSetting('tg_stale_smart_silence');
  const smartSilence = smartSilenceRaw === null ? true : (smartSilenceRaw === 'true' || smartSilenceRaw === '1');
  const cooldownDaysRaw = getAppSetting('tg_stale_personal_cooldown');
  const personalCooldownDays = cooldownDaysRaw !== null ? (parseInt(cooldownDaysRaw, 10) || 0) : 7;
  const lastRunAt = getAppSetting('tg_stale_last_run_at') || null;
  const lastRunStatusRaw = getAppSetting('tg_stale_last_run_status');
  let lastRunStatus = null;
  if (lastRunStatusRaw) {
    try {
      lastRunStatus = JSON.parse(lastRunStatusRaw);
    } catch (_) {}
  }

  return {
    frequency,
    time,
    smartSilence,
    personalCooldownDays,
    lastRunAt,
    lastRunStatus,
    timezoneOffset: 3
  };
}

function updateStaleAlertSchedule(updates = {}) {
  if (updates.frequency !== undefined) {
    const validFreqs = ['weekly', 'semiweekly', 'daily', 'disabled'];
    if (validFreqs.includes(updates.frequency)) {
      setAppSetting('tg_stale_frequency', updates.frequency);
    }
  }
  if (updates.time !== undefined) {
    const timeMatch = String(updates.time).trim().match(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/);
    if (timeMatch) {
      setAppSetting('tg_stale_time', updates.time.trim());
    }
  }
  if (updates.smartSilence !== undefined) {
    setAppSetting('tg_stale_smart_silence', updates.smartSilence ? '1' : '0');
  }
  if (updates.personalCooldownDays !== undefined) {
    const days = Math.max(0, parseInt(updates.personalCooldownDays, 10) || 0);
    setAppSetting('tg_stale_personal_cooldown', String(days));
  }
  return getStaleAlertSchedule();
}

function recordStaleAlertRun({ lastRunAt = null, status = null } = {}) {
  const runTime = lastRunAt ? (typeof lastRunAt === 'string' ? lastRunAt : new Date(lastRunAt).toISOString()) : new Date().toISOString();
  setAppSetting('tg_stale_last_run_at', runTime);
  if (status !== null) {
    setAppSetting('tg_stale_last_run_status', JSON.stringify(status));
  }
  return getStaleAlertSchedule();
}

function updatePlayerStockReminderTime(playerId, isoString = null) {
  if (!playerId) return false;
  const time = isoString || new Date().toISOString();
  getDb().prepare('UPDATE players SET last_stock_reminder_sent_at = ? WHERE id = ?').run(time, playerId);
  return true;
}

// ─── NOTIFICATION TEMPLATES ──────────────────────────────────
function getNotificationTemplates() {
  return getDb().prepare('SELECT * FROM notification_templates ORDER BY channel, key').all();
}

function getNotificationTemplate(key) {
  if (!key) return null;
  return getDb().prepare('SELECT * FROM notification_templates WHERE key = ?').get(key) || null;
}

function updateNotificationTemplate(key, updates = {}) {
  if (!key) return null;
  const existing = getNotificationTemplate(key);
  if (!existing) return null;

  const title = updates.title !== undefined ? updates.title : existing.title;
  const parseMode = updates.parse_mode !== undefined ? updates.parse_mode : (updates.parseMode !== undefined ? updates.parseMode : existing.parse_mode);
  const template = updates.template !== undefined ? updates.template : existing.template;
  const now = new Date().toISOString();

  getDb().prepare(`
    UPDATE notification_templates
    SET title = ?, parse_mode = ?, template = ?, updated_at = ?
    WHERE key = ?
  `).run(title, parseMode, template, now, key);

  return getNotificationTemplate(key);
}

function resetNotificationTemplate(key) {
  if (!key) return null;
  const existing = getNotificationTemplate(key);
  if (!existing) return null;

  const now = new Date().toISOString();
  getDb().prepare(`
    UPDATE notification_templates
    SET template = default_template, updated_at = ?
    WHERE key = ?
  `).run(now, key);

  return getNotificationTemplate(key);
}

// ─── USER TELEGRAM BINDING ───────────────────────────────────
function createTelegramBindToken(userId, token, expiresAt) {
  if (!userId || !token) return false;
  getDb().prepare(`
    UPDATE users
    SET telegram_bind_token = ?, telegram_bind_expires_at = ?
    WHERE id = ?
  `).run(token, expiresAt, userId);
  return true;
}

function findUserByTelegramBindToken(token) {
  if (!token) return null;
  const now = new Date().toISOString();
  const row = getDb().prepare(`
    SELECT * FROM users
    WHERE telegram_bind_token = ? AND telegram_bind_expires_at > ?
  `).get(token, now);
  if (!row) return null;
  return {
    ...row,
    permissions: parsePermissions(row.permissions)
  };
}

function bindUserTelegram(userId, chatId, username) {
  if (!userId) return null;
  getDb().prepare(`
    UPDATE users
    SET telegram_chat_id = ?, telegram_username = ?, telegram_bind_token = NULL, telegram_bind_expires_at = NULL
    WHERE id = ?
  `).run(chatId, username || null, userId);
  return findUserById(userId);
}

function unbindUserTelegram(userId) {
  if (!userId) return false;
  getDb().prepare(`
    UPDATE users
    SET telegram_chat_id = NULL, telegram_username = NULL, telegram_bind_token = NULL, telegram_bind_expires_at = NULL
    WHERE id = ?
  `).run(userId);
  return true;
}

function findUserByTelegramChatId(chatId) {
  if (chatId === undefined || chatId === null) return null;
  const row = getDb().prepare('SELECT * FROM users WHERE telegram_chat_id = ?').get(chatId);
  if (!row) return null;
  return {
    ...row,
    permissions: parsePermissions(row.permissions)
  };
}

function toggleTelegramNotifications(userId, enabled) {
  if (!userId) return false;
  const val = enabled ? 1 : 0;
  getDb().prepare('UPDATE users SET telegram_notifications_enabled = ? WHERE id = ?').run(val, userId);
  return true;
}

// ─── STAFF CHAT BINDING ──────────────────────────────────────
function createStaffBindToken(token, expiresAt) {
  if (!token) return false;
  setAppSetting('telegram_staff_bind_token', token);
  setAppSetting('telegram_staff_bind_expires_at', expiresAt);
  return true;
}

function verifyAndBindStaffChat(token, chatId) {
  if (!token || !chatId) {
    return { success: false, reason: 'invalid' };
  }
  const currentToken = getAppSetting('telegram_staff_bind_token');
  const expiresAt = getAppSetting('telegram_staff_bind_expires_at');

  if (!currentToken || currentToken.toUpperCase() !== token.toUpperCase()) {
    return { success: false, reason: 'invalid' };
  }

  if (expiresAt && new Date(expiresAt).getTime() < Date.now()) {
    return { success: false, reason: 'expired' };
  }

  // Valid: save staff chat ID and clear token
  setAppSetting('telegram_staff_chat_id', String(chatId));
  setAppSetting('telegram_staff_bind_token', '');
  setAppSetting('telegram_staff_bind_expires_at', '');

  return { success: true, chatId };
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
  blockUser,
  deleteUser,
  getPendingUsers,
  getUsers,
  updateUser,
  changePassword,
  isDefaultAdminPassword,
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
  clearCatalog,
  getVipTiers,
  setVipTiers,
  getEventTypes,
  saveEventType,
  deleteEventType,
  updateBulkEventTypeRewards,
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
  getStockHistoryByPlayerId,
  recordStockHistory,
  confirmPlayerStock,
  cleanupExpiredScreenshots,
  exportKowJson,
  importKowJson,
  parsePermissions,
  getAppSetting,
  setAppSetting,
  getNotificationTemplates,
  getNotificationTemplate,
  updateNotificationTemplate,
  resetNotificationTemplate,
  createTelegramBindToken,
  findUserByTelegramBindToken,
  bindUserTelegram,
  unbindUserTelegram,
  findUserByTelegramChatId,
  toggleTelegramNotifications,
  createStaffBindToken,
  verifyAndBindStaffChat,
  getMieruSettings,
  saveMieruSettings,
  touchUserActive,
  getStaleAlertSchedule,
  updateStaleAlertSchedule,
  recordStaleAlertRun,
  updatePlayerStockReminderTime,
};
