/**
 * KoW Tracker - Deep Module: Auth, Session & RBAC Guardian
 *
 * Consolidates session lifecycle, token extraction, role/permission authorization,
 * sector access security, zero-trust warehouse stock masking, Telegram WebApp HMAC
 * verification, and user management lifecycle guards.
 * Zero external dependencies.
 */

function createAuthGuard({ db, logic } = {}) {
  if (!logic) {
    logic = require('./logic.js');
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
      if (!req.user) {
        authenticate(req);
      }
      if (!req.user) {
        if (res && typeof res.writeHead === 'function') {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'UNAUTHORIZED', message: 'Требуется авторизация' }));
        }
        return false;
      }
      if (!allowed.includes(req.user.rank)) {
        if (res && typeof res.writeHead === 'function') {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'FORBIDDEN', message: `Доступ запрещен для ранга ${req.user.rank}` }));
        }
        return false;
      }
      return true;
    };
  }

  function requirePermission(reqOrPerm, res, permission) {
    if (typeof reqOrPerm === 'string') {
      const perm = reqOrPerm;
      return (req, res) => requirePermission(req, res, perm);
    }
    const req = reqOrPerm;
    if (!req.user) {
      authenticate(req);
    }
    if (!req.user) {
      if (res && typeof res.writeHead === 'function') {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'UNAUTHORIZED', message: 'Требуется авторизация' }));
      }
      return false;
    }
    if (hasPermission(req.user, permission)) {
      return true;
    }
    if (res && typeof res.writeHead === 'function') {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'FORBIDDEN', message: `Недостаточно прав: требуется разрешение ${permission}` }));
    }
    return false;
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

  function verifyTelegramWebAppData(initData, botToken) {
    if (!logic || typeof logic.validateTelegramWebAppData !== 'function') {
      return { valid: false, error: 'logic.validateTelegramWebAppData is not available' };
    }
    return logic.validateTelegramWebAppData(initData, botToken);
  }

  function authenticateTelegramWebApp(initData, botToken) {
    if (!botToken) {
      return { ok: false, status: 503, error: 'BOT_NOT_CONFIGURED', message: 'Токен Telegram-бота не настроен на сервере' };
    }
    if (!initData || typeof initData !== 'string') {
      return { ok: false, status: 400, error: 'VALIDATION_ERROR', message: 'Параметр initData обязателен' };
    }

    const validation = verifyTelegramWebAppData(initData, botToken);
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

    let user = typeof db.findUserByTelegramChatId === 'function' ? db.findUserByTelegramChatId(tgUserId) : null;
    if (!user && validation.user?.username && typeof db.findUserByTelegramUsername === 'function') {
      const matched = db.findUserByTelegramUsername(validation.user.username);
      if (matched && typeof db.bindUserTelegram === 'function') {
        db.bindUserTelegram(matched.id, tgUserId, validation.user.username);
        user = typeof db.findUserById === 'function' ? db.findUserById(matched.id) : matched;
      }
    }

    if (!user) {
      return {
        ok: false,
        status: 404,
        error: 'USER_NOT_BOUND',
        message: 'Пользователь с данным Telegram ID не найден в KoW Tracker. Привяжите Telegram в личном кабинете.'
      };
    }

    if (user.is_blocked) {
      return { ok: false, status: 403, error: 'USER_BLOCKED', message: 'Ваш аккаунт заблокирован' };
    }

    const token = createSession(user.id);
    return {
      ok: true,
      token,
      user
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
    createSession,
    destroySession,
    formatSessionCookie,
    formatLogoutCookie,
    hasRole,
    hasPermission,
    requireRole,
    requirePermission,
    maskPlayerStockIfNeeded,
    checkSectorAccess,
    verifyTelegramWebAppData,
    authenticateTelegramWebApp,
    canApproveUser,
    canBlockUser,
    canDeleteUser
  };
}

module.exports = {
  createAuthGuard
};
