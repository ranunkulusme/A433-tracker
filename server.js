const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');
const db = require('./db.js');
const logic = require('./logic.js');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8'
};

function sendJson(res, statusCode, data) {
  const json = JSON.stringify(data);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  });
  res.end(json);
}

function sendError(res, statusCode, code, message) {
  sendJson(res, statusCode, { error: code, message: message || code });
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => {
      data += chunk;
      if (data.length > 50 * 1024 * 1024) {
        req.destroy();
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      if (!data.trim()) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch (err) {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function authenticate(req) {
  let token = null;
  const authHeader = req.headers.authorization || req.headers.Authorization || '';
  if (authHeader.startsWith('Bearer ')) {
    token = authHeader.slice(7).trim();
  } else if (req.headers.cookie) {
    const match = req.headers.cookie.match(/(?:^|;\s*)token=([^;]+)/);
    if (match) {
      token = decodeURIComponent(match[1]);
    }
  }

  if (!token) {
    req.user = null;
    return null;
  }
  const user = db.verifySession(token);
  req.user = user || null;
  req.token = token;
  return req.user;
}

function sanitizeSkills(skills) {
  if (!Array.isArray(skills)) return [1, 1, 1, 1];
  const arr = skills.slice(0, 4);
  while (arr.length < 4) arr.push(1);
  return arr.map(n => Math.max(1, Math.min(5, Math.floor(Number(n) || 1))));
}

function sanitizeVipPoints(pts) {
  return Math.max(0, Math.floor(Number(pts) || 0));
}

function requireAuth(req, res) {
  if (!req.user) {
    sendError(res, 401, 'UNAUTHORIZED', 'Требуется авторизация');
    return false;
  }
  return true;
}

function requireRole(roles) {
  return (req, res) => {
    if (!req.user) {
      sendError(res, 401, 'UNAUTHORIZED', 'Требуется авторизация');
      return false;
    }
    if (!roles.includes(req.user.rank)) {
      sendError(res, 403, 'FORBIDDEN', `Доступ запрещен для ранга ${req.user.rank}`);
      return false;
    }
    return true;
  };
}

const FORBIDDEN_FILES = new Set([
  'package.json',
  'package-lock.json',
  'server.js',
  'db.js',
  'dockerfile',
  'docker-compose.yml',
  'readme.md'
]);

function isForbiddenFile(basename) {
  const lower = basename.toLowerCase();
  if (lower.startsWith('.')) return true;
  if (lower.endsWith('.db') || lower.endsWith('.test.js') || lower.endsWith('.md')) return true;
  return FORBIDDEN_FILES.has(lower);
}

function serveStaticFile(req, res, staticDir, pathname) {
  const rawUrl = req.url || '';
  if (rawUrl.includes('..') || rawUrl.includes('%2e%2e') || rawUrl.includes('%2E%2E')) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Forbidden');
  }

  const safeBase = path.resolve(staticDir);
  const relativePath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const targetPath = path.resolve(safeBase, relativePath);

  // Path traversal protection
  if (!targetPath.startsWith(safeBase)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Forbidden');
  }

  // Prevent serving sensitive backend files
  if (isForbiddenFile(path.basename(targetPath))) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Forbidden');
  }

  fs.stat(targetPath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Not Found');
    }

    const ext = path.extname(targetPath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': stats.size
    });

    const stream = fs.createReadStream(targetPath);
    stream.pipe(res);
  });
}

function createRequestHandler(staticDir) {
  return async (req, res) => {
    try {
      // CORS Preflight
      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization'
        });
        return res.end();
      }

      const parsedUrl = new URL(req.url, 'http://localhost');
      const pathname = parsedUrl.pathname;

      // Attach user from token if present
      authenticate(req);

      // Non-API routes -> Static files
      if (!pathname.startsWith('/api/')) {
        if (req.method === 'GET' || req.method === 'HEAD') {
          return serveStaticFile(req, res, staticDir, pathname);
        }
        res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end('Method Not Allowed');
      }

      // Parse body for write operations
      let body = {};
      if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
        try {
          body = await readJsonBody(req);
        } catch (err) {
          return sendError(res, 400, 'INVALID_JSON', 'Некорректный JSON в теле запроса');
        }
      }

      // ─────────────────────────────────────────────────────────
      // AUTH ENDPOINTS
      // ─────────────────────────────────────────────────────────
      if (pathname === '/api/auth/candidate-players' && req.method === 'GET') {
        return sendJson(res, 200, db.getCandidatePlayers());
      }

      if (pathname === '/api/auth/register' && req.method === 'POST') {
        const { username, password, playerId, playerName } = body;
        if (!username || !password) {
          return sendError(res, 400, 'MISSING_FIELDS', 'Логин и пароль обязательны');
        }
        const regRes = db.registerUser({ username, password, playerId, playerName });
        if (regRes.error) {
          return sendError(res, 400, regRes.error, regRes.message || 'Ошибка при регистрации');
        }
        return sendJson(res, 200, {
          success: true,
          pendingApproval: regRes.pendingApproval,
          userId: regRes.userId,
          is_approved: regRes.is_approved
        });
      }

    if (pathname === '/api/auth/login' && req.method === 'POST') {
      const { username, password } = body;
      if (!username || !password) {
        return sendError(res, 400, 'MISSING_FIELDS', 'Логин и пароль обязательны');
      }
      const loginRes = db.loginUser(username, password);
      if (loginRes.error === 'PENDING_APPROVAL') {
        return sendError(res, 403, 'PENDING_APPROVAL', 'Аккаунт ожидает подтверждения Главой (Р5) или Чиновником (Р4)');
      }
      if (loginRes.error) {
        return sendError(res, 401, loginRes.error, 'Неверный логин или пароль');
      }
      return sendJson(res, 200, {
        token: loginRes.token,
        user: loginRes.user
      });
    }

    if (pathname === '/api/auth/logout' && req.method === 'POST') {
      if (!requireAuth(req, res)) return;
      if (req.token) {
        db.deleteSession(req.token);
      }
      return sendJson(res, 200, { success: true });
    }

    if (pathname === '/api/auth/me' && req.method === 'GET') {
      if (!requireAuth(req, res)) return;
      const player = req.user.playerId ? db.getPlayerById(req.user.playerId) : null;
      return sendJson(res, 200, {
        user: req.user,
        player
      });
    }

    if (pathname === '/api/auth/change-password' && req.method === 'POST') {
      if (!requireAuth(req, res)) return;
      const { newPassword, oldPassword } = body;
      if (!newPassword) {
        return sendError(res, 400, 'MISSING_PASSWORD', 'Новый пароль обязателен');
      }
      if (oldPassword) {
        const u = db.findUserById(req.user.id);
        if (!u || !db.verifyPassword(oldPassword, u.password_hash)) {
          return sendError(res, 400, 'INVALID_PASSWORD', 'Текущий пароль неверен');
        }
      }
      db.changePassword(req.user.id, newPassword);
      return sendJson(res, 200, { success: true });
    }

    // ─────────────────────────────────────────────────────────
    // USER APPROVALS & USERS (R4, R5)
    // ─────────────────────────────────────────────────────────
    if (pathname === '/api/users/pending' && req.method === 'GET') {
      if (!requireRole(['r4', 'r5'])(req, res)) return;
      return sendJson(res, 200, db.getPendingUsers());
    }

    const approveMatch = pathname.match(/^\/api\/users\/(\d+)\/approve$/);
    if (approveMatch && req.method === 'POST') {
      if (!requireRole(['r4', 'r5'])(req, res)) return;
      const targetUserId = Number(approveMatch[1]);
      let rank = body.rank === 'r4' ? 'r4' : 'r3';
      if (req.user.rank === 'r4' && body.rank && body.rank !== 'r3') {
        return sendJson(res, 403, { error: 'Чиновник (Р4) может одобрять только в ранге Р3' });
      }
      if (req.user.rank === 'r5' && ['r3', 'r4'].includes(body.rank)) {
        rank = body.rank;
      }
      const updatedUser = db.approveUser(targetUserId, rank);
      return sendJson(res, 200, { success: true, user: updatedUser });
    }

    const rejectMatch = pathname.match(/^\/api\/users\/(\d+)\/reject$/);
    if (rejectMatch && req.method === 'POST') {
      if (!requireRole(['r4', 'r5'])(req, res)) return;
      const targetUserId = Number(rejectMatch[1]);
      db.rejectUser(targetUserId);
      return sendJson(res, 200, { success: true });
    }

    if (pathname === '/api/users' && req.method === 'GET') {
      if (!requireRole(['r5'])(req, res)) return;
      return sendJson(res, 200, db.getUsers());
    }

    const userPatchMatch = pathname.match(/^\/api\/users\/(\d+)$/);
    if (userPatchMatch && req.method === 'PATCH') {
      if (!requireRole(['r5'])(req, res)) return;
      const targetUserId = Number(userPatchMatch[1]);
      if (body.password) {
        db.changePassword(targetUserId, body.password);
      }
      const updated = db.updateUser(targetUserId, body);
      if (body.rank && updated && updated.player_id) {
        db.updatePlayer(updated.player_id, { rank: body.rank });
      }
      return sendJson(res, 200, { success: true, user: updated });
    }

    // ─────────────────────────────────────────────────────────
    // PLAYER CABINET (/api/my-profile)
    // ─────────────────────────────────────────────────────────
    if (pathname === '/api/my-profile' && req.method === 'GET') {
      if (!requireAuth(req, res)) return;
      if (!req.user.playerId) {
        return sendError(res, 404, 'NO_LINKED_PLAYER', 'К вашему аккаунту не привязан профиль игрока');
      }
      const player = db.getPlayerById(req.user.playerId);
      if (!player) {
        return sendError(res, 404, 'PLAYER_NOT_FOUND', 'Профиль игрока не найден');
      }
      return sendJson(res, 200, player);
    }

    if (pathname === '/api/my-profile' && req.method === 'PUT') {
      if (!requireAuth(req, res)) return;
      if (!req.user.playerId) {
        return sendError(res, 404, 'NO_LINKED_PLAYER', 'К вашему аккаунту не привязан профиль игрока');
      }
      delete body.rank;
      delete body.id;

      if (body.sector && body.sector.vipPoints !== undefined) {
        body.sector.vipPoints = sanitizeVipPoints(body.sector.vipPoints);
      }
      if (body.vipPoints !== undefined) {
        body.vipPoints = sanitizeVipPoints(body.vipPoints);
      }

      if (Array.isArray(body.officers)) {
        for (const o of body.officers) {
          if (o.skills !== undefined) {
            o.skills = sanitizeSkills(o.skills);
          }
          if (o.id) {
            const updatedOff = db.updatePlayerOfficer(req.user.playerId, o.id, o);
            if (!updatedOff) {
              db.addPlayerOfficer(req.user.playerId, o);
            }
          } else {
            db.addPlayerOfficer(req.user.playerId, o);
          }
        }
      }

      const updated = db.updatePlayer(req.user.playerId, body);
      if (body.stock) {
        db.recordStockHistory(req.user.playerId, body.stock);
      }
      return sendJson(res, 200, updated);
    }

    if (pathname === '/api/my-profile/officers' && req.method === 'POST') {
      if (!requireAuth(req, res)) return;
      if (!req.user.playerId) {
        return sendError(res, 404, 'NO_LINKED_PLAYER', 'К вашему аккаунту не привязан профиль игрока');
      }
      if (body.skills !== undefined) {
        body.skills = sanitizeSkills(body.skills);
      }
      const off = db.addPlayerOfficer(req.user.playerId, body);
      return sendJson(res, 200, off);
    }

    const myOfficerMatch = pathname.match(/^\/api\/my-profile\/officers\/([^/]+)$/);
    if (myOfficerMatch && req.method === 'PUT') {
      if (!requireAuth(req, res)) return;
      if (!req.user.playerId) {
        return sendError(res, 404, 'NO_LINKED_PLAYER', 'К вашему аккаунту не привязан профиль игрока');
      }
      const officerId = myOfficerMatch[1];
      if (body.skills !== undefined) {
        body.skills = sanitizeSkills(body.skills);
      }
      const off = db.updatePlayerOfficer(req.user.playerId, officerId, body);
      if (!off) {
        return sendError(res, 404, 'OFFICER_NOT_FOUND', 'Офицер не найден');
      }
      return sendJson(res, 200, off);
    }

    if (myOfficerMatch && req.method === 'DELETE') {
      if (!requireAuth(req, res)) return;
      if (!req.user.playerId) {
        return sendError(res, 404, 'NO_LINKED_PLAYER', 'К вашему аккаунту не привязан профиль игрока');
      }
      const officerId = myOfficerMatch[1];
      db.deletePlayerOfficer(req.user.playerId, officerId);
      return sendJson(res, 200, { success: true });
    }

    // ─────────────────────────────────────────────────────────
    // PLAYERS MANAGEMENT (R4, R5)
    // ─────────────────────────────────────────────────────────
    if (pathname === '/api/players' && req.method === 'GET') {
      if (!requireRole(['r4', 'r5'])(req, res)) return;
      return sendJson(res, 200, db.getPlayers());
    }

    if (pathname === '/api/players' && req.method === 'POST') {
      if (!requireRole(['r4', 'r5'])(req, res)) return;
      if (body.sector && body.sector.vipPoints !== undefined) {
        body.sector.vipPoints = sanitizeVipPoints(body.sector.vipPoints);
      }
      if (body.vipPoints !== undefined) {
        body.vipPoints = sanitizeVipPoints(body.vipPoints);
      }
      if (Array.isArray(body.officers)) {
        for (const o of body.officers) {
          if (o.skills !== undefined) {
            o.skills = sanitizeSkills(o.skills);
          }
        }
      }
      const created = db.createPlayer(body);
      return sendJson(res, 200, created);
    }

    const playerMatch = pathname.match(/^\/api\/players\/(\d+)$/);
    if (playerMatch && req.method === 'GET') {
      if (!requireRole(['r4', 'r5'])(req, res)) return;
      const player = db.getPlayerById(Number(playerMatch[1]));
      if (!player) return sendError(res, 404, 'PLAYER_NOT_FOUND');
      return sendJson(res, 200, player);
    }

    if (playerMatch && req.method === 'PUT') {
      if (!requireRole(['r4', 'r5'])(req, res)) return;
      const targetPlayerId = Number(playerMatch[1]);
      if (body.sector && body.sector.vipPoints !== undefined) {
        body.sector.vipPoints = sanitizeVipPoints(body.sector.vipPoints);
      }
      if (body.vipPoints !== undefined) {
        body.vipPoints = sanitizeVipPoints(body.vipPoints);
      }
      if (Array.isArray(body.officers)) {
        const existingPlayer = db.getPlayerById(targetPlayerId);
        if (existingPlayer && Array.isArray(existingPlayer.officers)) {
          const keepIds = new Set(body.officers.map(o => o && o.id).filter(Boolean));
          for (const oldOff of existingPlayer.officers) {
            if (!keepIds.has(oldOff.id)) {
              db.deletePlayerOfficer(targetPlayerId, oldOff.id);
            }
          }
        }
        for (const o of body.officers) {
          if (o.skills !== undefined) {
            o.skills = sanitizeSkills(o.skills);
          }
          if (o.id) {
            const updatedOff = db.updatePlayerOfficer(targetPlayerId, o.id, o);
            if (!updatedOff) {
              db.addPlayerOfficer(targetPlayerId, o);
            }
          } else {
            db.addPlayerOfficer(targetPlayerId, o);
          }
        }
      }
      const updated = db.updatePlayer(targetPlayerId, body);
      return sendJson(res, 200, updated);
    }

    if (playerMatch && req.method === 'DELETE') {
      if (!requireRole(['r4', 'r5'])(req, res)) return;
      db.deletePlayer(Number(playerMatch[1]));
      return sendJson(res, 200, { success: true });
    }

    // ─────────────────────────────────────────────────────────
    // CATALOG
    // ─────────────────────────────────────────────────────────
    if (pathname === '/api/catalog' && req.method === 'GET') {
      return sendJson(res, 200, db.getCatalog());
    }

    if (pathname === '/api/catalog' && req.method === 'POST') {
      if (!requireRole(['r4', 'r5'])(req, res)) return;
      const upgradeType = body.upgradeType === 'special' ? 'special' : 'standard';
      const saved = db.saveCatalogItem({ ...body, upgradeType });
      return sendJson(res, 200, saved);
    }

    const catMatch = pathname.match(/^\/api\/catalog\/([^/]+)$/);
    if (catMatch && req.method === 'PUT') {
      if (!requireRole(['r4', 'r5'])(req, res)) return;
      const upgradeType = body.upgradeType === 'special' ? 'special' : (body.upgradeType || 'standard');
      const saved = db.saveCatalogItem({ ...body, id: catMatch[1], upgradeType });
      return sendJson(res, 200, saved);
    }

    if (catMatch && req.method === 'DELETE') {
      if (!requireRole(['r4', 'r5'])(req, res)) return;
      const id = catMatch[1];
      if (!logic.canDeleteOfficer(id, db.getPlayers()).ok) {
        return sendError(res, 400, 'OFFICER_IN_USE', 'Офицер используется игроками');
      }
      db.deleteCatalogItem(id);
      return sendJson(res, 200, { success: true });
    }

    // ─────────────────────────────────────────────────────────
    // EVENT TYPES
    // ─────────────────────────────────────────────────────────
    if (pathname === '/api/event-types' && req.method === 'GET') {
      return sendJson(res, 200, db.getEventTypes());
    }

    if (pathname === '/api/event-types' && req.method === 'POST') {
      if (!requireRole(['r4', 'r5'])(req, res)) return;
      const saved = db.saveEventType(body);
      return sendJson(res, 200, saved);
    }

    const etMatch = pathname.match(/^\/api\/event-types\/(\d+)$/);
    if (etMatch && req.method === 'PUT') {
      if (!requireRole(['r4', 'r5'])(req, res)) return;
      const saved = db.saveEventType({ ...body, id: Number(etMatch[1]) });
      return sendJson(res, 200, saved);
    }

    if (etMatch && req.method === 'DELETE') {
      if (!requireRole(['r4', 'r5'])(req, res)) return;
      db.deleteEventType(Number(etMatch[1]));
      return sendJson(res, 200, { success: true });
    }

    // ─────────────────────────────────────────────────────────
    // EVENTS & REGISTRATIONS & AUTOPICK
    // ─────────────────────────────────────────────────────────
    if (pathname === '/api/events' && req.method === 'GET') {
      const events = db.getEvents();
      const isLeader = req.user && (req.user.rank === 'r4' || req.user.rank === 'r5');
      const playerId = req.user?.playerId;

      const enriched = events.map(ev => {
        const item = { ...ev };
        if (isLeader) {
          item.registrations = db.getRegistrationsByEventId(ev.id);
        }
        if (playerId) {
          item.myRegistration = db.getUserRegistration(ev.id, playerId);
        }
        return item;
      });

      return sendJson(res, 200, enriched);
    }

    if (pathname === '/api/events' && req.method === 'POST') {
      if (!requireRole(['r4', 'r5'])(req, res)) return;
      const saved = db.saveEvent(body);
      return sendJson(res, 200, saved);
    }

    if (pathname === '/api/events/schedule-season' && req.method === 'POST') {
      if (!requireRole(['r4', 'r5'])(req, res)) return;

      const { presetId = 'king-of-war', startDate, cyclesCount = 1 } = body || {};
      const preset = (logic.EVENT_PRESETS || []).find(p => p.id === presetId) || (logic.EVENT_PRESETS && logic.EVENT_PRESETS[0]) || {
        id: 'king-of-war',
        name: 'Король Войны',
        cycleDays: 14,
        durationDays: 7
      };

      const eventTypes = db.getEventTypes();
      let eventType = eventTypes.find(t => t.name && t.name.trim().toLowerCase() === preset.name.trim().toLowerCase());
      if (!eventType) {
        eventType = db.saveEventType({
          name: preset.name,
          color: preset.id === 'king-of-war' ? '#8b5cf6' : '#f59e0b',
          places: [
            { place: 1, label: '🥇 1 место', coupons: 12500 },
            { place: 2, label: '🥈 2 место', coupons: 6500 },
            { place: 3, label: '🥉 3 место', coupons: 3500 },
            { place: 4, label: '4–10 место', coupons: 2750 },
          ]
        });
      }

      const count = Math.max(1, Number(cyclesCount) || 1);
      const scheduleItems = logic.generateSeasonSchedule({
        startDate: startDate || new Date().toISOString().slice(0, 10),
        cyclesCount: count,
        presetId: preset.id
      });

      const createdEvents = [];
      for (const item of scheduleItems) {
        const saved = db.saveEvent({
          typeId: eventType.id,
          dateFrom: item.dateFrom,
          dateTo: item.dateTo,
          note: item.note || '',
          assignments: []
        });
        createdEvents.push(saved);
      }

      return sendJson(res, 201, {
        success: true,
        createdCount: createdEvents.length,
        events: createdEvents
      });
    }

    const eventRegMatch = pathname.match(/^\/api\/events\/(\d+)\/register$/);
    if (eventRegMatch && req.method === 'POST') {
      if (!requireAuth(req, res)) return;
      if (!req.user.playerId) {
        return sendError(res, 400, 'NO_LINKED_PLAYER', 'К вашему аккаунту не привязан профиль игрока');
      }
      const eventId = Number(eventRegMatch[1]);
      const { officerId, desiredPlace } = body;
      const reg = db.registerForEvent({
        eventId,
        playerId: req.user.playerId,
        officerId: officerId || '',
        desiredPlace: desiredPlace !== undefined ? Number(desiredPlace) : 0
      });
      return sendJson(res, 200, { success: true, registration: reg });
    }

    if (eventRegMatch && req.method === 'DELETE') {
      if (!requireAuth(req, res)) return;
      if (!req.user.playerId) {
        return sendError(res, 400, 'NO_LINKED_PLAYER', 'К вашему аккаунту не привязан профиль игрока');
      }
      const eventId = Number(eventRegMatch[1]);
      db.unregisterFromEvent(eventId, req.user.playerId);
      return sendJson(res, 200, { success: true });
    }

    const autopickMatch = pathname.match(/^\/api\/events\/(\d+)\/autopick$/);
    if (autopickMatch && req.method === 'POST') {
      if (!requireRole(['r4', 'r5'])(req, res)) return;
      const eventId = Number(autopickMatch[1]);
      const ev = db.getEventById(eventId);
      if (!ev) {
        return sendError(res, 404, 'EVENT_NOT_FOUND', 'Ивент не найден');
      }
      const eventTypes = db.getEventTypes();
      const et = eventTypes.find(t => t.id === ev.typeId);
      const places = et ? (typeof logic.resolveEventPlaces === 'function' ? logic.resolveEventPlaces(et, ev.dateFrom) : et.places) : [];

      const players = db.getPlayers();
      const officerCatalog = db.getCatalog();
      const registrations = db.getRegistrationsByEventId(eventId);
      const recentWinners = typeof db.getRecentWinners === 'function'
        ? db.getRecentWinners(ev.typeId || ev.type_id, 2, ev.id)
        : [];

      const result = logic.smartAutoPickWithRegistrations({
        event: { ...ev, places },
        players,
        registrations,
        officerCatalog,
        eventDate: ev.dateFrom,
        recentWinners
      });

      ev.assignments = result.assignments;
      db.saveEvent(ev);

      return sendJson(res, 200, {
        success: true,
        assignments: result.assignments,
        unassignedCandidates: result.unassignedCandidates
      });
    }

    const eventMatch = pathname.match(/^\/api\/events\/(\d+)$/);
    if (eventMatch && req.method === 'GET') {
      const ev = db.getEventById(Number(eventMatch[1]));
      if (!ev) return sendError(res, 404, 'EVENT_NOT_FOUND');
      const isLeader = req.user && (req.user.rank === 'r4' || req.user.rank === 'r5');
      if (isLeader) {
        ev.registrations = db.getRegistrationsByEventId(ev.id);
      }
      if (req.user?.playerId) {
        ev.myRegistration = db.getUserRegistration(ev.id, req.user.playerId);
      }
      return sendJson(res, 200, ev);
    }

    if (eventMatch && req.method === 'PUT') {
      if (!requireRole(['r4', 'r5'])(req, res)) return;
      const saved = db.saveEvent({ ...body, id: Number(eventMatch[1]) });
      return sendJson(res, 200, saved);
    }

    if (eventMatch && req.method === 'DELETE') {
      if (!requireRole(['r4', 'r5'])(req, res)) return;
      db.deleteEvent(Number(eventMatch[1]));
      return sendJson(res, 200, { success: true });
    }

    // ─────────────────────────────────────────────────────────
    // ADMIN EXPORT & IMPORT
    // ─────────────────────────────────────────────────────────
    if (pathname === '/api/admin/export' && req.method === 'GET') {
      if (!requireRole(['r4', 'r5'])(req, res)) return;
      const backup = db.exportKowJson();
      return sendJson(res, 200, backup);
    }

    if (pathname === '/api/admin/import' && req.method === 'POST') {
      if (!requireRole(['r5'])(req, res)) return;
      try {
        db.importKowJson(body);
        return sendJson(res, 200, { success: true });
      } catch (err) {
        return sendError(res, 400, 'IMPORT_FAILED', err.message);
      }
    }

    // Unmatched API endpoint
    return sendError(res, 404, 'NOT_FOUND', `Endpoint ${pathname} not found`);
    } catch (err) {
      sendError(res, 500, 'INTERNAL_SERVER_ERROR', err.message);
    }
  };
}

function startServer({ port = 3000, dbPath = 'data/kow.db', staticDir = __dirname } = {}) {
  db.initDb(dbPath);

  const server = http.createServer(createRequestHandler(staticDir));

  // Promisify close for clean test teardowns
  const originalClose = server.close.bind(server);
  server.close = function (callback) {
    return new Promise((resolve, reject) => {
      originalClose(err => {
        if (callback) callback(err);
        if (err) reject(err);
        else resolve();
      });
    });
  };

  return new Promise((resolve, reject) => {
    server.listen(port, () => {
      resolve(server);
    });
    server.on('error', reject);
  });
}

if (require.main === module) {
  const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
  const dbPath = process.env.DB_PATH || path.join(__dirname, 'data', 'kow.db');
  startServer({ port, dbPath }).then(server => {
    console.log(`Server started on port ${server.address().port}`);
  }).catch(err => {
    console.error('Failed to start server:', err);
    process.exit(1);
  });
}

module.exports = {
  startServer,
  createRequestHandler
};
