/**
 * KoW Tracker - Deep Module: Auth, Session & RBAC Guardian
 *
 * Consolidates session lifecycle, token extraction, role/permission authorization,
 * sector access security, zero-trust warehouse stock masking, Telegram WebApp HMAC
 * verification, and user management lifecycle guards.
 * Zero external dependencies.
 */

const crypto = require('node:crypto');

function validateTelegramWebAppData(initData, botToken, options = {}) {
  if (!initData || !botToken) {
    return { valid: false, error: 'missing_arguments' };
  }

  try {
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    if (!hash) {
      return { valid: false, error: 'missing_hash' };
    }

    const authDate = Number(params.get('auth_date')) || 0;
    const nowSec = options.nowSec !== undefined ? options.nowSec : Math.floor(Date.now() / 1000);
    const maxAgeSec = options.maxAgeSec !== undefined ? options.maxAgeSec : 86400;

    if (maxAgeSec > 0) {
      if (!authDate || (nowSec - authDate) > maxAgeSec || (authDate - nowSec) > 86400) {
        return { valid: false, error: 'expired' };
      }
    }

    const pairs = [];
    for (const [key, val] of params.entries()) {
      if (key !== 'hash' && key !== 'signature') {
        pairs.push(`${key}=${val}`);
      }
    }
    pairs.sort();
    const dataCheckString = pairs.join('\n');

    const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
    const calculatedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

    let hashesMatch = false;
    if (typeof crypto.timingSafeEqual === 'function' && hash.length === 64 && calculatedHash.length === 64) {
      hashesMatch = crypto.timingSafeEqual(Buffer.from(calculatedHash, 'hex'), Buffer.from(hash, 'hex'));
    } else {
      hashesMatch = (calculatedHash === hash);
    }

    if (!hashesMatch) {
      return { valid: false, error: 'invalid_hash' };
    }

    let user = null;
    const userRaw = params.get('user');
    if (userRaw) {
      try {
        user = JSON.parse(userRaw);
      } catch (_) {}
    }

    return {
      valid: true,
      user,
      authDate,
      queryId: params.get('query_id') || null
    };
  } catch (err) {
    return { valid: false, error: err.message };
  }
}

function createAuthGuard({ db, logic } = {}) {
  if (!logic) {
    logic = require('../shared/logic.js');
  }

  function extractToken(req) {
    if (!req || !req.headers) return null;
    const authHeader = req.headers.authorization || req.headers.Authorization || '';
    if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
      return authHeader.slice(7).trim();
    }
    const cookieHeader = req.headers.cookie;
    if (typeof cookieHeader === 'string') {
      const match = cookieHeader.match(/(?:^|;\s*)token=([^;]+)/);
      if (match) {
        return decodeURIComponent(match[1]);
      }
    }
    return null;
  }

  function authenticate(req) {
    const token = extractToken(req);
    if (!token) {
      if (req) {
        req.user = null;
        req.token = null;
      }
      return null;
    }

    if (!db || typeof db.verifySession !== 'function') {
      return null;
    }

    const user = db.verifySession(token);
    if (req) {
      req.user = user || null;
      req.token = token;
      if (req.user && req.user.id && typeof db.touchUserActive === 'function') {
        db.touchUserActive(req.user.id);
      }
    }
    return user || null;
  }

  function createSession(userId) {
    if (!db || typeof db.createSession !== 'function') {
      throw new Error('db.createSession is required');
    }
    return db.createSession(userId);
  }

  function destroySession(token) {
    if (!db || typeof db.deleteSession !== 'function') return false;
    return db.deleteSession(token);
  }

  function formatSessionCookie(token, options = {}) {
    const maxAge = options.maxAge !== undefined ? options.maxAge : 30 * 24 * 60 * 60; // 30 days
    const path = options.path || '/';
    const sameSite = options.sameSite || 'Lax';
    const secure = options.secure ? '; Secure' : '';
    return `token=${encodeURIComponent(token)}; HttpOnly; Path=${path}; SameSite=${sameSite}; Max-Age=${maxAge}${secure}`;
  }

  function formatLogoutCookie(options = {}) {
    const path = options.path || '/';
    return `token=; HttpOnly; Path=${path}; Max-Age=0`;
  }

  function sendJsonAuthError(res, status, error, message) {
    if (res && typeof res.writeHead === 'function') {
      res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store, no-cache, must-revalidate'
      });
      res.end(JSON.stringify({ error, message }));
    }
    return false;
  }

  function requireAuth(req, res) {
    if (!req || !req.user) {
      authenticate(req);
    }
    if (!req || !req.user) {
      return sendJsonAuthError(res, 401, 'UNAUTHORIZED', 'Требуется авторизация');
    }
    return true;
  }

  function hasRole(user, roles) {
    if (!user || !user.rank) return false;
    const allowed = Array.isArray(roles) ? roles : [roles];
    return allowed.includes(user.rank);
  }

  function hasPermission(user, permission) {
    if (!user) return false;
    if (typeof logic.hasUserPermission === 'function') {
      return logic.hasUserPermission(user, permission);
    }
    const perms = Array.isArray(user.permissions) ? user.permissions : [];
    return perms.includes(permission) || user.rank === 'r5';
  }

  function requireRole(roles) {
    const allowed = Array.isArray(roles) ? roles : [roles];
    return (req, res) => {
      if (!requireAuth(req, res)) return false;
      if (!allowed.includes(req.user.rank)) {
        return sendJsonAuthError(res, 403, 'FORBIDDEN', `Доступ запрещен для ранга ${req.user.rank}`);
      }
      return true;
    };
  }

  function requirePermission(reqOrPerm, res, permission) {
    if (typeof reqOrPerm === 'string') {
      const perm = reqOrPerm;
      return (req, resArg) => requirePermission(req, resArg, perm);
    }
    const req = reqOrPerm;
    if (!requireAuth(req, res)) return false;
    if (hasPermission(req.user, permission)) return true;
    return sendJsonAuthError(res, 403, 'FORBIDDEN', `Недостаточно прав: требуется разрешение ${permission}`);
  }

  function sanitizePlayerUpdatePayload(body, { allowPrivilegeFields = false } = {}) {
    if (!body || typeof body !== 'object') return body;
    if (!allowPrivilegeFields) {
      delete body.rank;
      delete body.id;
      delete body.userId;
      delete body.user_id;
    }
    return body;
  }

  function maskPlayerStockIfNeeded(player, user) {
    if (!player) return player;
    const isOwner = user && player.userId === user.id;
    const canViewStocks = user && hasPermission(user, 'view_stocks');
    if (isOwner || canViewStocks) {
      return player;
    }
    return {
      ...player,
      stock: {
        coupons: 0,
        puzzles: 0,
        chests: 0,
        starCoupons: 0,
        legendaryStars1: 0,
        legendaryStars2: 0,
        legendaryStars3: 0,
        masked: true
      }
    };
  }

  function checkSectorAccess(user, targetPlayerId, isRead = false) {
    if (!user) {
      return { ok: false, status: 401, error: 'UNAUTHORIZED', message: 'Требуется авторизация' };
    }
    if (!db || typeof db.getPlayerById !== 'function') {
      return { ok: false, status: 500, error: 'INTERNAL_ERROR', message: 'База данных недоступна' };
    }
    const player = db.getPlayerById(targetPlayerId);
    if (!player) {
      return { ok: false, status: 404, error: 'PLAYER_NOT_FOUND', message: 'Сектор не найден' };
    }
    const isLeader = user.rank === 'r4' || user.rank === 'r5';
    const isOwner = player.userId === user.id;
    if (isRead) {
      const canRead = isLeader || isOwner || hasPermission(user, 'view_sectors');
      if (!canRead) {
        return { ok: false, status: 403, error: 'FORBIDDEN', message: 'Вы не являетесь владельцем этого сектора' };
      }
      const maskedPlayer = maskPlayerStockIfNeeded(player, user);
      return { ok: true, player: maskedPlayer, isLeader, isOwner };
    }
    if (!isLeader && !isOwner) {
      return { ok: false, status: 403, error: 'FORBIDDEN', message: 'Вы не являетесь владельцем этого сектора' };
    }
    return { ok: true, player, isLeader, isOwner };
  }

  function resolveUserByTelegramIdentity(tgUser) {
    const tgUserId = tgUser?.id;
    let user = typeof db.findUserByTelegramChatId === 'function' ? db.findUserByTelegramChatId(tgUserId) : null;
    const findUserByIdFn = db.findUserById || db.getUserById;
    const tryBindCandidate = (candidateQuery, fallbackName) => {
      if (!candidateQuery || typeof db.findUserByTelegramUsername !== 'function') return null;
      const matched = db.findUserByTelegramUsername(candidateQuery);
      if (matched && (!matched.telegram_chat_id || String(matched.telegram_chat_id) !== String(tgUserId))) {
        if (typeof db.bindUserTelegram === 'function') {
          db.bindUserTelegram(matched.id, tgUserId, fallbackName);
        }
        return typeof findUserByIdFn === 'function' ? findUserByIdFn(matched.id) : matched;
      }
      return null;
    };

    if (!user && tgUser?.username) {
      user = tryBindCandidate(tgUser.username, tgUser.username);
    }
    if (!user && tgUser?.first_name) {
      user = tryBindCandidate(tgUser.first_name, tgUser.username || tgUser.first_name);
    }
    if (!user && tgUser?.first_name && tgUser?.last_name) {
      const fullName = `${tgUser.first_name} ${tgUser.last_name}`.trim();
      user = tryBindCandidate(fullName, tgUser.username || fullName);
    }
    return user;
  }

  function authenticateTelegramWebApp(initData, botToken, options = {}) {
    if (!botToken) {
      return { ok: false, status: 503, error: 'BOT_NOT_CONFIGURED', message: 'Токен Telegram-бота не настроен на сервере' };
    }
    if (!initData || typeof initData !== 'string') {
      return { ok: false, status: 400, error: 'VALIDATION_ERROR', message: 'Параметр initData обязателен' };
    }

    const validation = validateTelegramWebAppData(initData, botToken, options);
    if (!validation.valid) {
      return { ok: false, status: 401, error: 'INVALID_TELEGRAM_DATA', message: `Ошибка валидации Telegram WebApp: ${validation.error}` };
    }

    const tgUserId = validation.user?.id;
    if (!tgUserId) {
      return { ok: false, status: 400, error: 'MISSING_TELEGRAM_USER', message: 'Не найден объект пользователя Telegram в initData' };
    }

    if (!db) {
      return { ok: false, status: 500, error: 'INTERNAL_ERROR', message: 'База данных недоступна' };
    }

    const user = resolveUserByTelegramIdentity(validation.user);
    if (!user) {
      return {
        ok: false,
        status: 404,
        error: 'USER_NOT_BOUND',
        message: 'Пользователь с данным Telegram ID не найден в KoW Tracker. Привяжите Telegram в личном кабинете.'
      };
    }

    if (user.is_approved === 0 || user.isApproved === false) {
      return { ok: false, status: 403, error: 'PENDING_APPROVAL', message: 'Ваш аккаунт ожидает подтверждения офицером' };
    }

    if (user.is_blocked || user.isBlocked) {
      return { ok: false, status: 403, error: 'ACCOUNT_BLOCKED', message: 'Ваш аккаунт заблокирован администрацией' };
    }

    const token = createSession(user.id);
    if (typeof db.touchUserActive === 'function') {
      db.touchUserActive(user.id);
    }
    const cookie = formatSessionCookie(token);
    if (typeof db.healUserSectorLinks === 'function') {
      db.healUserSectorLinks(user.id);
    }
    const linkedPlayerId = user.player_id || user.playerId || null;
    const player = linkedPlayerId && typeof db.getPlayerById === 'function'
      ? db.getPlayerById(linkedPlayerId)
      : (typeof db.getPlayersByUserId === 'function' ? (db.getPlayersByUserId(user.id)[0] || null) : null);

    return {
      ok: true,
      token,
      cookie,
      user: {
        id: user.id,
        username: user.username,
        rank: user.rank,
        playerId: linkedPlayerId || (player ? player.id : null),
        permissions: user.permissions || [],
        telegramChatId: user.telegram_chat_id || user.telegramChatId || null,
        telegramUsername: user.telegram_username || user.telegramUsername || null,
        hasDefaultAdminPassword: user.username === 'admin' && typeof db.isDefaultAdminPassword === 'function'
          ? db.isDefaultAdminPassword()
          : false
      },
      player,
      telegramUser: validation.user
    };
  }

  function canApproveUser(operatorUser, requestedRank) {
    if (!operatorUser) return { allowed: false, error: 'UNAUTHORIZED' };
    if (operatorUser.rank === 'r5') {
      return { allowed: true, rank: ['r3', 'r4'].includes(requestedRank) ? requestedRank : 'r3' };
    }
    if (hasPermission(operatorUser, 'approve_users')) {
      if (requestedRank && requestedRank !== 'r3') {
        return { allowed: false, error: 'FORBIDDEN', message: 'Только глава альянса (Р5) может назначать ранг выше Р3' };
      }
      return { allowed: true, rank: 'r3' };
    }
    return { allowed: false, error: 'FORBIDDEN', message: 'Недостаточно прав для одобрения пользователей' };
  }

  function canBlockUser(operatorUser, targetUserId) {
    if (!operatorUser) return { allowed: false, error: 'UNAUTHORIZED' };
    if (operatorUser.rank !== 'r5') {
      return { allowed: false, error: 'FORBIDDEN', message: 'Только Р5 может блокировать пользователей' };
    }
    if (operatorUser.id === Number(targetUserId)) {
      return { allowed: false, error: 'SELF_BLOCK_FORBIDDEN', message: 'Вы не можете заблокировать собственный аккаунт' };
    }
    return { allowed: true };
  }

  function canDeleteUser(operatorUser, targetUser) {
    if (!operatorUser) return { allowed: false, error: 'UNAUTHORIZED' };
    if (operatorUser.rank !== 'r5') {
      return { allowed: false, error: 'FORBIDDEN', message: 'Только Р5 может удалять пользователей' };
    }
    if (!targetUser) {
      return { allowed: false, error: 'USER_NOT_FOUND', message: 'Пользователь не найден' };
    }
    if (operatorUser.id === Number(targetUser.id)) {
      return { allowed: false, error: 'SELF_DELETE_FORBIDDEN', message: 'Вы не можете удалить собственный аккаунт' };
    }
    if (targetUser.username === 'admin') {
      return { allowed: false, error: 'ADMIN_DELETE_FORBIDDEN', message: 'Главного администратора (admin) нельзя удалить' };
    }
    return { allowed: true };
  }

  return {
    extractToken,
    authenticate,
    requireAuth,
    createSession,
    destroySession,
    formatSessionCookie,
    formatLogoutCookie,
    hasRole,
    hasPermission,
    requireRole,
    requirePermission,
    sanitizePlayerUpdatePayload,
    maskPlayerStockIfNeeded,
    checkSectorAccess,
    validateTelegramWebAppData,
    authenticateTelegramWebApp,
    canApproveUser,
    canBlockUser,
    canDeleteUser
  };
}

module.exports = {
  createAuthGuard,
  validateTelegramWebAppData
};
