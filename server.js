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
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm'
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

function sanitizeStock(stock) {
  if (!stock || typeof stock !== 'object') return stock;
  if (stock.starCoupons !== undefined) {
    stock.starCoupons = Math.max(0, parseInt(stock.starCoupons, 10) || 0);
  }
  if (stock.legendaryStars1 !== undefined) {
    stock.legendaryStars1 = Math.max(0, parseInt(stock.legendaryStars1, 10) || 0);
  }
  if (stock.legendaryStars2 !== undefined) {
    stock.legendaryStars2 = Math.max(0, parseInt(stock.legendaryStars2, 10) || 0);
  }
  if (stock.legendaryStars3 !== undefined) {
    stock.legendaryStars3 = Math.max(0, parseInt(stock.legendaryStars3, 10) || 0);
  }
  if (stock.coupons !== undefined) {
    stock.coupons = Math.max(0, parseInt(stock.coupons, 10) || 0);
  }
  if (stock.puzzles !== undefined) {
    stock.puzzles = Math.max(0, parseInt(stock.puzzles, 10) || 0);
  }
  if (stock.chests !== undefined) {
    stock.chests = Math.max(0, parseInt(stock.chests, 10) || 0);
  }
  return stock;
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
    const headers = {
      'Content-Type': contentType,
      'Content-Length': stats.size
    };

    if (pathname === '/sw.js') {
      headers['Content-Type'] = 'application/javascript; charset=UTF-8';
      headers['Service-Worker-Allowed'] = '/';
      headers['Cache-Control'] = 'no-cache, no-store, must-revalidate';
    } else if (pathname === '/manifest.json') {
      headers['Content-Type'] = 'application/manifest+json; charset=UTF-8';
    }

    res.writeHead(200, headers);

    if (req.method === 'HEAD') {
      return res.end();
    }

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
      if (pathname === '/api/auth/status' && req.method === 'GET') {
        const isDefault = db.isDefaultAdminPassword();
        return sendJson(res, 200, {
          hasDefaultAdminPassword: isDefault,
          demoAccessEnabled: isDefault
        });
      }

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
        user: {
          ...loginRes.user,
          hasDefaultAdminPassword: loginRes.user.username === 'admin' ? db.isDefaultAdminPassword() : false
        }
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
        user: {
          ...req.user,
          hasDefaultAdminPassword: req.user.username === 'admin' ? db.isDefaultAdminPassword() : false
        },
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
      if (!requireRole(['r4', 'r5'])(req, res)) return;
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
    // PLAYER CABINET & SECTORS (/api/my-profile, /api/my-sectors)
    // ─────────────────────────────────────────────────────────
    if (pathname === '/api/my-profile' && req.method === 'GET') {
      if (!requireAuth(req, res)) return;
      const sectors = db.getPlayersByUserId(req.user.id);
      let activeSector = null;
      const requestedSectorId = parsedUrl.searchParams.get('sectorId')
        ? Number(parsedUrl.searchParams.get('sectorId'))
        : null;

      if (requestedSectorId && sectors.some(s => s.id === requestedSectorId)) {
        activeSector = sectors.find(s => s.id === requestedSectorId);
      } else if (req.user.playerId && sectors.some(s => s.id === req.user.playerId)) {
        activeSector = sectors.find(s => s.id === req.user.playerId);
      } else if (sectors.length > 0) {
        activeSector = sectors[0];
      }

      return sendJson(res, 200, {
        ...(activeSector ? activeSector : {}),
        user: { id: req.user.id, username: req.user.username, rank: req.user.rank },
        sectors,
        activeSectorId: activeSector ? activeSector.id : null,
        sector: activeSector ? activeSector.sector : null,
        stock: activeSector ? activeSector.stock : null,
        officers: activeSector ? (activeSector.officers || []) : []
      });
    }

    if (pathname === '/api/my-profile/active-sector' && req.method === 'POST') {
      if (!requireAuth(req, res)) return;
      const sectorId = Number(body.sectorId);
      if (!sectorId) {
        return sendError(res, 400, 'VALIDATION_ERROR', 'Укажите ID сектора');
      }
      const result = db.setUserActiveSector(req.user.id, sectorId);
      if (!result.ok) {
        return sendError(res, 403, 'FORBIDDEN', 'Вы не являетесь владельцем этого сектора');
      }
      req.user.playerId = sectorId;
      return sendJson(res, 200, { success: true, activeSectorId: sectorId });
    }

    if (pathname === '/api/my-sectors' && req.method === 'POST') {
      if (!requireAuth(req, res)) return;
      if (!body.name || !body.name.trim()) {
        return sendError(res, 400, 'VALIDATION_ERROR', 'Укажите название сектора');
      }
      if (body.sector && body.sector.vipPoints !== undefined) {
        body.sector.vipPoints = sanitizeVipPoints(body.sector.vipPoints);
      }
      if (body.vipPoints !== undefined) {
        body.vipPoints = sanitizeVipPoints(body.vipPoints);
      }
      if (body.stock) {
        sanitizeStock(body.stock);
      }
      const created = db.createPlayer({
        ...body,
        name: body.name.trim(),
        userId: req.user.id,
        rank: req.user.rank === 'r4' || req.user.rank === 'r5' ? (body.rank || 'r3') : 'r3'
      });

      const currentUser = db.findUserById(req.user.id);
      if (!currentUser || !currentUser.player_id) {
        db.setUserActiveSector(req.user.id, created.id);
        req.user.playerId = created.id;
      }
      return sendJson(res, 201, created);
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
      if (body.stock) {
        sanitizeStock(body.stock);
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
      if (body.stock) {
        sanitizeStock(body.stock);
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

    function checkSectorAccess(targetPlayerId) {
      if (!req.user) {
        return { ok: false, status: 401, error: 'UNAUTHORIZED', message: 'Требуется авторизация' };
      }
      const player = db.getPlayerById(targetPlayerId);
      if (!player) {
        return { ok: false, status: 404, error: 'PLAYER_NOT_FOUND', message: 'Сектор не найден' };
      }
      const isLeader = req.user.rank === 'r4' || req.user.rank === 'r5';
      const isOwner = player.userId === req.user.id;
      if (!isLeader && !isOwner) {
        return { ok: false, status: 403, error: 'FORBIDDEN', message: 'Вы не являетесь владельцем этого сектора' };
      }
      return { ok: true, player, isLeader, isOwner };
    }

    const playerMatch = pathname.match(/^\/api\/players\/(\d+)$/);
    if (playerMatch && req.method === 'GET') {
      const targetPlayerId = Number(playerMatch[1]);
      const check = checkSectorAccess(targetPlayerId);
      if (!check.ok) return sendError(res, check.status, check.error, check.message);
      return sendJson(res, 200, check.player);
    }

    if (playerMatch && req.method === 'PUT') {
      const targetPlayerId = Number(playerMatch[1]);
      const check = checkSectorAccess(targetPlayerId);
      if (!check.ok) return sendError(res, check.status, check.error, check.message);

      if (!check.isLeader) {
        delete body.rank;
        delete body.id;
        delete body.userId;
        delete body.user_id;
      }
      if (body.sector && body.sector.vipPoints !== undefined) {
        body.sector.vipPoints = sanitizeVipPoints(body.sector.vipPoints);
      }
      if (body.vipPoints !== undefined) {
        body.vipPoints = sanitizeVipPoints(body.vipPoints);
      }
      if (body.stock) {
        sanitizeStock(body.stock);
      }
      if (Array.isArray(body.officers)) {
        const existingPlayer = check.player;
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
      if (body.stock) {
        db.recordStockHistory(targetPlayerId, body.stock);
      }
      return sendJson(res, 200, updated);
    }

    if (playerMatch && req.method === 'DELETE') {
      if (!requireRole(['r4', 'r5'])(req, res)) return;
      db.deletePlayer(Number(playerMatch[1]));
      return sendJson(res, 200, { success: true });
    }

    const playerOfficersMatch = pathname.match(/^\/api\/players\/(\d+)\/officers$/);
    if (playerOfficersMatch && req.method === 'POST') {
      const targetPlayerId = Number(playerOfficersMatch[1]);
      const check = checkSectorAccess(targetPlayerId);
      if (!check.ok) return sendError(res, check.status, check.error, check.message);

      if (body.skills !== undefined) {
        body.skills = sanitizeSkills(body.skills);
      }
      const off = db.addPlayerOfficer(targetPlayerId, body);
      return sendJson(res, 201, off);
    }

    const playerOfficerDetailMatch = pathname.match(/^\/api\/players\/(\d+)\/officers\/([^/]+)$/);
    if (playerOfficerDetailMatch && req.method === 'PUT') {
      const targetPlayerId = Number(playerOfficerDetailMatch[1]);
      const offId = playerOfficerDetailMatch[2];
      const check = checkSectorAccess(targetPlayerId);
      if (!check.ok) return sendError(res, check.status, check.error, check.message);

      if (body.skills !== undefined) {
        body.skills = sanitizeSkills(body.skills);
      }
      const off = db.updatePlayerOfficer(targetPlayerId, offId, body);
      if (!off) {
        return sendError(res, 404, 'OFFICER_NOT_FOUND', 'Офицер не найден');
      }
      return sendJson(res, 200, off);
    }

    if (playerOfficerDetailMatch && req.method === 'DELETE') {
      const targetPlayerId = Number(playerOfficerDetailMatch[1]);
      const offId = playerOfficerDetailMatch[2];
      const check = checkSectorAccess(targetPlayerId);
      if (!check.ok) return sendError(res, check.status, check.error, check.message);

      db.deletePlayerOfficer(targetPlayerId, offId);
      return sendJson(res, 200, { success: true });
    }

    // ─────────────────────────────────────────────────────────
    // VIP TIERS
    // ─────────────────────────────────────────────────────────
    if (pathname === '/api/vip-tiers' && req.method === 'GET') {
      if (!authenticate(req, res)) return;
      return sendJson(res, 200, db.getVipTiers());
    }

    if (pathname === '/api/vip-tiers' && req.method === 'PUT') {
      if (!requireRole(['r4', 'r5'])(req, res)) return;
      const tiersInput = Array.isArray(body) ? body : (Array.isArray(body?.tiers) ? body.tiers : null);
      if (!tiersInput) {
        return sendError(res, 400, 'INVALID_PAYLOAD', 'Ожидается массив уровней VIP');
      }
      const updated = db.setVipTiers(tiersInput);
      return sendJson(res, 200, updated);
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
      const medalsBeforeTraining = Math.max(0, parseInt(body.medalsBeforeTraining ?? body.medals_before_training) || 480);
      const medalsTraining = Math.max(0, parseInt(body.medalsTraining ?? body.medals_training) || 900);
      const medalsTotal = Math.max(0, parseInt(body.medalsTotal ?? body.medals_total) || (medalsBeforeTraining + medalsTraining));
      const starCouponCost = Math.max(0, parseInt(body.starCouponCost ?? body.star_coupon_cost) || 360);
      const couponPerPuzzle = Math.max(0, parseInt(body.couponPerPuzzle ?? body.coupon_per_puzzle) || 720);
      const generation = Math.max(1, parseInt(body.generation) || 8);
      const type = ['Танк', 'Пехота', 'ПТ-Сау', 'Горнизон', 'Осада'].includes(body.type) ? body.type : (body.type || 'Пехота');

      const saved = db.saveCatalogItem({
        ...body,
        id: body.id || ('off_' + Date.now()),
        name: String(body.name || '').trim(),
        type,
        generation,
        couponPerPuzzle,
        starCouponCost,
        medalsBeforeTraining,
        medalsTraining,
        medalsTotal,
        upgradeType
      });
      return sendJson(res, 200, saved);
    }

    if (pathname === '/api/catalog/batch' && req.method === 'POST') {
      if (!requireRole(['r4', 'r5'])(req, res)) return;
      const officers = Array.isArray(body) ? body : (Array.isArray(body?.officers) ? body.officers : null);
      if (!officers) {
        return sendError(res, 400, 'INVALID_PAYLOAD', 'Ожидается массив офицеров');
      }
      const savedList = [];
      for (const off of officers) {
        if (!off || !off.name) continue;
        const upgradeType = off.upgradeType === 'special' ? 'special' : 'standard';
        const medalsBeforeTraining = Math.max(0, parseInt(off.medalsBeforeTraining ?? off.medals_before_training) || 480);
        const medalsTraining = Math.max(0, parseInt(off.medalsTraining ?? off.medals_training) || 900);
        const medalsTotal = Math.max(0, parseInt(off.medalsTotal ?? off.medals_total) || (medalsBeforeTraining + medalsTraining));
        const starCouponCost = Math.max(0, parseInt(off.starCouponCost ?? off.star_coupon_cost) || 360);
        const couponPerPuzzle = Math.max(0, parseInt(off.couponPerPuzzle ?? off.coupon_per_puzzle) || 720);
        const generation = Math.max(1, parseInt(off.generation) || 8);
        const type = ['Танк', 'Пехота', 'ПТ-Сау', 'Горнизон', 'Осада'].includes(off.type) ? off.type : (off.type || 'Пехота');

        const saved = db.saveCatalogItem({
          ...off,
          id: off.id || ('off_' + Math.random().toString(36).slice(2, 9)),
          name: String(off.name).trim(),
          type,
          generation,
          couponPerPuzzle,
          starCouponCost,
          medalsBeforeTraining,
          medalsTraining,
          medalsTotal,
          upgradeType
        });
        savedList.push(saved);
      }
      return sendJson(res, 200, { success: true, count: savedList.length, officers: savedList });
    }

    const catMatch = pathname.match(/^\/api\/catalog\/([^/]+)$/);
    if (catMatch && req.method === 'PUT') {
      if (!requireRole(['r4', 'r5'])(req, res)) return;
      const upgradeType = body.upgradeType === 'special' ? 'special' : (body.upgradeType || 'standard');
      const medalsBeforeTraining = Math.max(0, parseInt(body.medalsBeforeTraining ?? body.medals_before_training) || 480);
      const medalsTraining = Math.max(0, parseInt(body.medalsTraining ?? body.medals_training) || 900);
      const medalsTotal = Math.max(0, parseInt(body.medalsTotal ?? body.medals_total) || (medalsBeforeTraining + medalsTraining));
      const starCouponCost = Math.max(0, parseInt(body.starCouponCost ?? body.star_coupon_cost) || 360);
      const couponPerPuzzle = Math.max(0, parseInt(body.couponPerPuzzle ?? body.coupon_per_puzzle) || 720);
      const generation = Math.max(1, parseInt(body.generation) || 8);
      const type = ['Танк', 'Пехота', 'ПТ-Сау', 'Горнизон', 'Осада'].includes(body.type) ? body.type : (body.type || 'Пехота');

      const saved = db.saveCatalogItem({
        ...body,
        id: catMatch[1],
        type,
        generation,
        couponPerPuzzle,
        starCouponCost,
        medalsBeforeTraining,
        medalsTraining,
        medalsTotal,
        upgradeType
      });
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
      const userSectors = req.user ? db.getPlayersByUserId(req.user.id) : [];
      const userSectorIds = new Set(userSectors.map(s => s.id));
      const activeSectorId = req.user?.playerId;

      const enriched = events.map(ev => {
        const item = { ...ev };
        const eventRegs = (isLeader || userSectors.length > 0) ? db.getRegistrationsByEventId(ev.id) : [];
        if (isLeader) {
          item.registrations = eventRegs;
        }
        if (req.user) {
          item.myRegistrations = eventRegs.filter(r => userSectorIds.has(r.playerId));
          item.myRegistration = item.myRegistrations.find(r => r.playerId === activeSectorId) || item.myRegistrations[0] || null;
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

      let cachedEventTypes = db.getEventTypes();
      function ensureEventType(identifier, defaultColor) {
        const search = String(identifier || '').trim().toLowerCase();
        let found = cachedEventTypes.find(t => t.name && t.name.trim().toLowerCase() === search);

        const preset = (logic.EVENT_PRESETS || []).find(p => p.id === search || p.name.trim().toLowerCase() === search);
        if (!found && preset) {
          found = cachedEventTypes.find(t => t.name && t.name.trim().toLowerCase() === preset.name.trim().toLowerCase());
        }

        if (!found) {
          const typeName = preset ? preset.name : (identifier || 'Событие');
          let color = defaultColor || (preset ? preset.color : '#8b5cf6');
          if (preset?.id === 'king-of-war') color = '#8b5cf6';
          else if (preset?.id === 'mighty-forces') color = '#10b981';
          else if (preset?.id === 'power-of-time') color = '#f59e0b';

          found = db.saveEventType({
            name: typeName,
            color: color || '#8b5cf6',
            places: [
              { place: 1, label: '🥇 1 место', coupons: 12500 },
              { place: 2, label: '🥈 2 место', coupons: 6500 },
              { place: 3, label: '🥉 3 место', coupons: 3500 },
              { place: 4, label: '4–10 место', coupons: 2750 },
            ]
          });
          cachedEventTypes.push(found);
        }
        return found;
      }

      const createdEvents = [];

      if (Array.isArray(body?.events)) {
        // 1. Ready-made events array from UI preview (with possible deletions/edits)
        for (const item of body.events) {
          if (!item || !item.dateFrom || !item.dateTo) continue;
          let et = null;
          if (item.typeId && typeof item.typeId === 'number') {
            const allTypes = db.getEventTypes();
            et = allTypes.find(t => t.id === item.typeId);
          }
          if (!et) {
            et = ensureEventType(item.typeName || item.name || item.typeId, item.color);
          }
          const saved = db.saveEvent({
            typeId: et.id,
            dateFrom: item.dateFrom,
            dateTo: item.dateTo,
            note: item.note || '',
            assignments: []
          });
          createdEvents.push(saved);
        }
      } else if (body?.rules || body?.totalWeeks) {
        // 2. Multi-rule season generation
        const scheduleItems = logic.generateSeasonSchedule({
          startDate: body.startDate || new Date().toISOString().slice(0, 10),
          totalWeeks: body.totalWeeks,
          rules: body.rules
        });

        for (const item of scheduleItems) {
          const et = ensureEventType(item.typeName || item.name || item.typeId, item.color);
          const saved = db.saveEvent({
            typeId: et.id,
            dateFrom: item.dateFrom,
            dateTo: item.dateTo,
            note: item.note || '',
            assignments: []
          });
          createdEvents.push(saved);
        }
      } else {
        // 3. Legacy fallback (presetId, startDate, cyclesCount)
        const { presetId = 'king-of-war', startDate, cyclesCount = 1 } = body || {};
        const preset = (logic.EVENT_PRESETS || []).find(p => p.id === presetId) || (logic.EVENT_PRESETS && logic.EVENT_PRESETS[0]) || {
          id: 'king-of-war',
          name: 'Король Войны',
          cycleDays: 14,
          durationDays: 2
        };

        const eventType = ensureEventType(preset.name, preset.color);
        const count = Math.max(1, Number(cyclesCount) || 1);
        const scheduleItems = logic.generateSeasonSchedule({
          startDate: startDate || new Date().toISOString().slice(0, 10),
          cyclesCount: count,
          presetId: preset.id
        });

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
      }

      return sendJson(res, 201, {
        success: true,
        count: createdEvents.length,
        createdCount: createdEvents.length,
        events: createdEvents
      });
    }

    const eventRegMatch = pathname.match(/^\/api\/events\/(\d+)\/register$/);
    if (eventRegMatch && req.method === 'POST') {
      if (!requireAuth(req, res)) return;
      const eventId = Number(eventRegMatch[1]);
      const targetSectorId = body.sectorId
        ? Number(body.sectorId)
        : (req.user.playerId ? Number(req.user.playerId) : null);

      if (!targetSectorId) {
        return sendError(res, 400, 'NO_LINKED_PLAYER', 'К вашему аккаунту не привязан профиль игрока');
      }
      const player = db.getPlayerById(targetSectorId);
      if (!player) {
        return sendError(res, 404, 'PLAYER_NOT_FOUND', 'Сектор не найден');
      }
      const isLeader = req.user.rank === 'r4' || req.user.rank === 'r5';
      if (!isLeader && player.userId !== req.user.id) {
        return sendError(res, 403, 'FORBIDDEN', 'Вы не являетесь владельцем этого сектора');
      }

      const { officerId, desiredPlace } = body;
      const reg = db.registerForEvent({
        eventId,
        playerId: targetSectorId,
        officerId: officerId || '',
        desiredPlace: desiredPlace !== undefined ? Number(desiredPlace) : 0
      });
      return sendJson(res, 200, { success: true, registration: reg });
    }

    if (eventRegMatch && req.method === 'DELETE') {
      if (!requireAuth(req, res)) return;
      const eventId = Number(eventRegMatch[1]);
      const sectorIdParam = parsedUrl.searchParams.get('sectorId');
      const targetSectorId = sectorIdParam
        ? Number(sectorIdParam)
        : (body && body.sectorId ? Number(body.sectorId) : (req.user.playerId ? Number(req.user.playerId) : null));

      if (!targetSectorId) {
        return sendError(res, 400, 'NO_LINKED_PLAYER', 'К вашему аккаунту не привязан профиль игрока');
      }
      const player = db.getPlayerById(targetSectorId);
      if (!player) {
        return sendError(res, 404, 'PLAYER_NOT_FOUND', 'Сектор не найден');
      }
      const isLeader = req.user.rank === 'r4' || req.user.rank === 'r5';
      if (!isLeader && player.userId !== req.user.id) {
        return sendError(res, 403, 'FORBIDDEN', 'Вы не являетесь владельцем этого сектора');
      }

      db.unregisterFromEvent(eventId, targetSectorId);
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
      const userSectors = req.user ? db.getPlayersByUserId(req.user.id) : [];
      const userSectorIds = new Set(userSectors.map(s => s.id));
      const eventRegs = (isLeader || userSectors.length > 0) ? db.getRegistrationsByEventId(ev.id) : [];
      if (isLeader) {
        ev.registrations = eventRegs;
      }
      if (req.user) {
        ev.myRegistrations = eventRegs.filter(r => userSectorIds.has(r.playerId));
        ev.myRegistration = ev.myRegistrations.find(r => r.playerId === req.user.playerId) || ev.myRegistrations[0] || null;
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
  createRequestHandler,
  MIME_TYPES
};
