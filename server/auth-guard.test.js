/**
 * KoW Tracker - Tests for Auth, Session & RBAC Guardian (Deep Module)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const logic = require('../shared/logic.js');
const { createAuthGuard } = require('./auth-guard.js');

test('AuthGuard: extractToken and authenticate session', async () => {
  const mockDb = {
    verifySession: (token) => {
      if (token === 'valid-token') {
        return { id: 10, username: 'testuser', rank: 'r3', permissions: [] };
      }
      return null;
    },
    touchUserActive: (userId) => {
      mockDb.touchedUserId = userId;
    }
  };

  const authGuard = createAuthGuard({ db: mockDb, logic });

  // 1. Bearer header
  const reqBearer = { headers: { authorization: 'Bearer valid-token' } };
  const user1 = authGuard.authenticate(reqBearer);
  assert.ok(user1);
  assert.equal(user1.username, 'testuser');
  assert.equal(reqBearer.token, 'valid-token');
  assert.equal(mockDb.touchedUserId, 10);

  // 2. Cookie header
  const reqCookie = { headers: { cookie: 'other=123; token=valid-token; foo=bar' } };
  const user2 = authGuard.authenticate(reqCookie);
  assert.ok(user2);
  assert.equal(user2.id, 10);

  // 3. Invalid token
  const reqInvalid = { headers: { authorization: 'Bearer bad-token' } };
  const user3 = authGuard.authenticate(reqInvalid);
  assert.equal(user3, null);
  assert.equal(reqInvalid.user, null);

  // 4. Missing token
  const reqEmpty = { headers: {} };
  const user4 = authGuard.authenticate(reqEmpty);
  assert.equal(user4, null);
});

test('AuthGuard: cookie formatting for login and logout', () => {
  const authGuard = createAuthGuard({ db: {}, logic });

  const loginCookie = authGuard.formatSessionCookie('abc-123-token');
  assert.match(loginCookie, /token=abc-123-token/);
  assert.match(loginCookie, /HttpOnly/i);
  assert.match(loginCookie, /Path=\//);

  const logoutCookie = authGuard.formatLogoutCookie();
  assert.match(logoutCookie, /token=/);
  assert.match(logoutCookie, /Max-Age=0/);
});

test('AuthGuard: RBAC role and permission checks', () => {
  const authGuard = createAuthGuard({ db: {}, logic });

  const r3User = { id: 1, rank: 'r3', permissions: ['view_sectors'] };
  const r4User = { id: 2, rank: 'r4', permissions: [] };
  const r5User = { id: 3, rank: 'r5', permissions: [] };

  // hasRole
  assert.equal(authGuard.hasRole(r3User, ['r4', 'r5']), false);
  assert.equal(authGuard.hasRole(r4User, ['r4', 'r5']), true);
  assert.equal(authGuard.hasRole(r5User, ['r5']), true);

  // hasPermission
  assert.equal(authGuard.hasPermission(r3User, 'view_sectors'), true);
  assert.equal(authGuard.hasPermission(r3User, 'manage_events'), false);
  assert.equal(authGuard.hasPermission(r4User, 'manage_events'), true); // Leaders have intrinsic permissions
  assert.equal(authGuard.hasPermission(r5User, 'admin'), true);
});

test('AuthGuard: Zero-Trust stock masking', () => {
  const authGuard = createAuthGuard({ db: {}, logic });

  const samplePlayer = {
    id: 100,
    name: 'Sector Alpha',
    userId: 42,
    stock: {
      coupons: 50,
      puzzles: 100,
      chests: 10,
      starCoupons: 5,
      legendaryStars1: 2,
      legendaryStars2: 1,
      legendaryStars3: 0
    }
  };

  // 1. Owner sees full stock
  const ownerUser = { id: 42, rank: 'r3', permissions: [] };
  const unmasked = authGuard.maskPlayerStockIfNeeded(samplePlayer, ownerUser);
  assert.equal(unmasked.stock.coupons, 50);
  assert.equal(unmasked.stock.masked, undefined);

  // 2. Leader (R4/R5) sees full stock
  const leaderUser = { id: 99, rank: 'r4', permissions: [] };
  const leaderView = authGuard.maskPlayerStockIfNeeded(samplePlayer, leaderUser);
  assert.equal(leaderView.stock.coupons, 50);

  // 3. User with view_stocks permission sees full stock
  const privilegedUser = { id: 88, rank: 'r3', permissions: ['view_stocks'] };
  const privView = authGuard.maskPlayerStockIfNeeded(samplePlayer, privilegedUser);
  assert.equal(privView.stock.coupons, 50);

  // 4. Regular R3 user gets ZERO-TRUST masked stock
  const strangerUser = { id: 77, rank: 'r3', permissions: ['view_sectors'] };
  const masked = authGuard.maskPlayerStockIfNeeded(samplePlayer, strangerUser);
  assert.equal(masked.stock.coupons, 0);
  assert.equal(masked.stock.puzzles, 0);
  assert.equal(masked.stock.chests, 0);
  assert.equal(masked.stock.starCoupons, 0);
  assert.equal(masked.stock.masked, true);
});

test('AuthGuard: checkSectorAccess enforces owner, leader and read-only delegated permissions', () => {
  const players = [
    { id: 1, name: 'Sector 1', userId: 10, stock: { coupons: 100 } },
    { id: 2, name: 'Sector 2', userId: 20, stock: { coupons: 200 } }
  ];

  const mockDb = {
    getPlayerById: (id) => players.find(p => p.id === id) || null
  };

  const authGuard = createAuthGuard({ db: mockDb, logic });

  const ownerUser = { id: 10, rank: 'r3', permissions: [] };
  const r3Viewer = { id: 30, rank: 'r3', permissions: ['view_sectors'] };
  const r3Stranger = { id: 40, rank: 'r3', permissions: [] };
  const r4Leader = { id: 50, rank: 'r4', permissions: [] };

  // Owner reading own sector
  const checkOwnerRead = authGuard.checkSectorAccess(ownerUser, 1, true);
  assert.equal(checkOwnerRead.ok, true);
  assert.equal(checkOwnerRead.player.stock.coupons, 100);

  // Owner modifying own sector
  const checkOwnerWrite = authGuard.checkSectorAccess(ownerUser, 1, false);
  assert.equal(checkOwnerWrite.ok, true);
  assert.equal(checkOwnerWrite.isOwner, true);
  assert.equal(checkOwnerWrite.isLeader, false);

  // Stranger reading sector 1 without view_sectors -> 403
  const checkStrangerRead = authGuard.checkSectorAccess(r3Stranger, 1, true);
  assert.equal(checkStrangerRead.ok, false);
  assert.equal(checkStrangerRead.status, 403);

  // Viewer reading sector 1 with view_sectors -> 200, masked stock
  const checkViewerRead = authGuard.checkSectorAccess(r3Viewer, 1, true);
  assert.equal(checkViewerRead.ok, true);
  assert.equal(checkViewerRead.player.stock.coupons, 0);
  assert.equal(checkViewerRead.player.stock.masked, true);

  // Viewer trying to modify sector 1 -> 403 (write requires owner or leader)
  const checkViewerWrite = authGuard.checkSectorAccess(r3Viewer, 1, false);
  assert.equal(checkViewerWrite.ok, false);
  assert.equal(checkViewerWrite.status, 403);

  // Leader modifying sector 1 -> 200
  const checkLeaderWrite = authGuard.checkSectorAccess(r4Leader, 1, false);
  assert.equal(checkLeaderWrite.ok, true);
  assert.equal(checkLeaderWrite.isLeader, true);

  // Non-existent player -> 404
  const checkNotFound = authGuard.checkSectorAccess(r4Leader, 999, true);
  assert.equal(checkNotFound.ok, false);
  assert.equal(checkNotFound.status, 404);
});

test('AuthGuard: User lifecycle guards (approve, block, delete)', () => {
  const authGuard = createAuthGuard({ db: {}, logic });

  const r5Leader = { id: 1, rank: 'r5', permissions: [] };
  const r4Officer = { id: 2, rank: 'r4', permissions: ['approve_users'] };
  const r3Member = { id: 3, rank: 'r3', permissions: ['approve_users'] };

  // Approval rules:
  // R5 can approve any rank (r3, r4)
  assert.equal(authGuard.canApproveUser(r5Leader, 'r4').allowed, true);
  assert.equal(authGuard.canApproveUser(r5Leader, 'r3').allowed, true);

  // Non-R5 with approve_users can only approve r3
  assert.equal(authGuard.canApproveUser(r4Officer, 'r3').allowed, true);
  assert.equal(authGuard.canApproveUser(r4Officer, 'r4').allowed, false);
  assert.equal(authGuard.canApproveUser(r3Member, 'r3').allowed, true);
  assert.equal(authGuard.canApproveUser(r3Member, 'r4').allowed, false);

  // Blocking rules:
  // Cannot self-block
  assert.equal(authGuard.canBlockUser(r5Leader, 1).allowed, false);
  assert.equal(authGuard.canBlockUser(r5Leader, 2).allowed, true);

  // Deletion rules:
  // Cannot self-delete
  assert.equal(authGuard.canDeleteUser(r5Leader, { id: 1, username: 'boss' }).allowed, false);
  // Cannot delete 'admin'
  assert.equal(authGuard.canDeleteUser(r5Leader, { id: 99, username: 'admin' }).allowed, false);
  // Can delete regular user
  assert.equal(authGuard.canDeleteUser(r5Leader, { id: 2, username: 'other' }).allowed, true);
});

test('AuthGuard: validateTelegramWebAppData HMAC validation and expiration', () => {
  const { validateTelegramWebAppData } = require('./auth-guard.js');
  const botToken = '123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ';
  const nowSec = Math.floor(Date.now() / 1000);
  const userStr = JSON.stringify({ id: 777888, username: 'hero_ivan', first_name: 'Иван' });

  function createValidInitData(overrides = {}) {
    const authDate = overrides.authDate !== undefined ? overrides.authDate : nowSec;
    const queryId = overrides.queryId !== undefined ? overrides.queryId : 'AAH888';
    const uStr = overrides.userStr !== undefined ? overrides.userStr : userStr;
    const pairs = [`auth_date=${authDate}`, `query_id=${queryId}`, `user=${uStr}`].sort();
    const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
    const hash = crypto.createHmac('sha256', secretKey).update(pairs.join('\n')).digest('hex');
    const params = new URLSearchParams();
    params.set('query_id', queryId);
    params.set('user', uStr);
    params.set('auth_date', String(authDate));
    params.set('hash', overrides.hash !== undefined ? overrides.hash : hash);
    return params.toString();
  }

  const res1 = validateTelegramWebAppData(createValidInitData(), botToken, { nowSec });
  assert.equal(res1.valid, true);
  assert.equal(res1.user.id, 777888);

  const res2 = validateTelegramWebAppData(createValidInitData({ hash: 'deadbeef'.repeat(8) }), botToken, { nowSec });
  assert.equal(res2.valid, false);
  assert.equal(res2.error, 'invalid_hash');

  const res3 = validateTelegramWebAppData(createValidInitData({ authDate: nowSec - 90000 }), botToken, { nowSec });
  assert.equal(res3.valid, false);
  assert.equal(res3.error, 'expired');

  const paramsWithSig = new URLSearchParams(createValidInitData());
  paramsWithSig.set('signature', 'ed25519_sig_123');
  const res4 = validateTelegramWebAppData(paramsWithSig.toString(), botToken, { nowSec });
  assert.equal(res4.valid, true);
});

test('AuthGuard: requireAuth writes 401 response and authenticates request in one step', () => {
  const authGuard = createAuthGuard({
    db: {
      verifySession: (tok) => (tok === 'good' ? { id: 7, username: 'hero', rank: 'r3' } : null),
      touchUserActive: () => {}
    },
    logic
  });

  let statusWritten = null;
  let bodyWritten = '';
  const fakeRes = {
    writeHead: (s) => { statusWritten = s; },
    end: (b) => { bodyWritten = b; }
  };

  assert.equal(typeof authGuard.requireAuth, 'function');
  const failReq = { headers: {} };
  assert.equal(authGuard.requireAuth(failReq, fakeRes), false);
  assert.equal(statusWritten, 401);
  assert.match(bodyWritten, /UNAUTHORIZED/);

  const okReq = { headers: { authorization: 'Bearer good' } };
  assert.equal(authGuard.requireAuth(okReq, fakeRes), true);
  assert.equal(okReq.user.id, 7);
});

test('AuthGuard: authenticateTelegramWebApp enforces is_blocked, is_approved, name matching, and cookie header', () => {
  const botToken = '123456:TEST_BOT_TOKEN';
  const nowSec = Math.floor(Date.now() / 1000);
  function signUser(tgUser) {
    const uStr = JSON.stringify(tgUser);
    const pairs = [`auth_date=${nowSec}`, `query_id=Q1`, `user=${uStr}`].sort();
    const secret = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
    const hash = crypto.createHmac('sha256', secret).update(pairs.join('\n')).digest('hex');
    const p = new URLSearchParams({ query_id: 'Q1', user: uStr, auth_date: String(nowSec), hash });
    return p.toString();
  }

  let touchedId = null;
  const dbUsers = {
    blocked: { id: 10, username: 'blocked_u', rank: 'r3', is_approved: 1, is_blocked: 1, player_id: 1 },
    pending: { id: 11, username: 'pending_u', rank: 'r3', is_approved: 0, is_blocked: 0, player_id: 2 },
    active: { id: 12, username: 'active_u', rank: 'r4', is_approved: 1, is_blocked: 0, player_id: 3, permissions: ['manage_events'] }
  };
  const authGuard = createAuthGuard({
    db: {
      findUserByTelegramChatId: (tgId) => (tgId === 100 ? dbUsers.blocked : (tgId === 101 ? dbUsers.pending : null)),
      findUserByTelegramUsername: (uname) => (uname === 'John Doe' ? dbUsers.active : null),
      bindUserTelegram: () => {},
      findUserById: (id) => Object.values(dbUsers).find(u => u.id === id) || null,
      createSession: (uid) => `sess_${uid}`,
      touchUserActive: (uid) => { touchedId = uid; },
      getPlayerById: (pid) => ({ id: pid, name: `Sector_${pid}` }),
      getPlayersByUserId: () => [],
      isDefaultAdminPassword: () => false
    },
    logic
  });

  const blockedRes = authGuard.authenticateTelegramWebApp(signUser({ id: 100 }), botToken);
  assert.equal(blockedRes.ok, false);
  assert.equal(blockedRes.status, 403);
  assert.equal(blockedRes.error, 'ACCOUNT_BLOCKED');

  const pendingRes = authGuard.authenticateTelegramWebApp(signUser({ id: 101 }), botToken);
  assert.equal(pendingRes.ok, false);
  assert.equal(pendingRes.status, 403);
  assert.equal(pendingRes.error, 'PENDING_APPROVAL');

  const okRes = authGuard.authenticateTelegramWebApp(signUser({ id: 102, first_name: 'John', last_name: 'Doe' }), botToken);
  assert.equal(okRes.ok, true);
  assert.equal(okRes.token, 'sess_12');
  assert.match(okRes.cookie, /token=sess_12/);
  assert.equal(touchedId, 12);
  assert.equal(okRes.player.id, 3);
});

test('AuthGuard: sanitizePlayerUpdatePayload strips rank, id, userId, user_id unless explicitly allowed', () => {
  const authGuard = createAuthGuard({ db: {}, logic });
  const selfPayload = { id: 999, rank: 'r5', userId: 1, user_id: 1, name: 'MyBase', stock: { coupons: 50 } };
  const cleanedSelf = authGuard.sanitizePlayerUpdatePayload(selfPayload, { allowPrivilegeFields: false });
  assert.equal(cleanedSelf.rank, undefined);
  assert.equal(cleanedSelf.id, undefined);
  assert.equal(cleanedSelf.userId, undefined);
  assert.equal(cleanedSelf.user_id, undefined);
  assert.equal(cleanedSelf.name, 'MyBase');

  const leaderPayload = { id: 999, rank: 'r4', userId: 22, name: 'OtherBase' };
  const cleanedLeader = authGuard.sanitizePlayerUpdatePayload(leaderPayload, { allowPrivilegeFields: true });
  assert.equal(cleanedLeader.rank, 'r4');
  assert.equal(cleanedLeader.userId, 22);
});
