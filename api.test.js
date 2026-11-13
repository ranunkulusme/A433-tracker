const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

test('API serves static assets (index.html, logic.js) and 404s missing files / path traversal', async () => {
  const { startServer } = require('./server.js');
  const server = await startServer({ port: 0, dbPath: ':memory:' });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    // 1. GET / -> serves index.html
    const resRoot = await fetch(`${baseUrl}/`);
    assert.equal(resRoot.status, 200);
    assert(resRoot.headers.get('content-type').includes('text/html'));
    const htmlText = await resRoot.text();
    assert(htmlText.includes('<!DOCTYPE html>') || htmlText.includes('<html'));

    // 2. GET /logic.js -> serves js
    const resJs = await fetch(`${baseUrl}/logic.js`);
    assert.equal(resJs.status, 200);
    assert(resJs.headers.get('content-type').includes('javascript'));
    const jsText = await resJs.text();
    assert(jsText.includes('smartAutoPickWithRegistrations'));

    // 3. GET non-existent file -> 404
    const resNotFound = await fetch(`${baseUrl}/non-existent-file-xyz.txt`);
    assert.equal(resNotFound.status, 404);

    // 4. Path traversal attempt -> 403 or 404
    const resTraversal = await fetch(`${baseUrl}/../package.json`);
    assert(resTraversal.status === 403 || resTraversal.status === 404);

    // 5. Forbidden files case-insensitive check
    const resForbidden1 = await fetch(`${baseUrl}/SERVER.JS`);
    assert.equal(resForbidden1.status, 403);
    const resForbidden2 = await fetch(`${baseUrl}/server.js`);
    assert.equal(resForbidden2.status, 403);
    const resForbidden3 = await fetch(`${baseUrl}/db.js`);
    assert.equal(resForbidden3.status, 403);
  } finally {
    await server.close();
  }
});

test('PWA endpoints serve manifest.json, sw.js with Service-Worker-Allowed header, and app icons', async () => {
  const { startServer } = require('./server.js');
  const server = await startServer({ port: 0, dbPath: ':memory:' });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    // 1. GET /manifest.json -> 200, Content-Type application/manifest+json
    const resManifest = await fetch(`${baseUrl}/manifest.json`);
    assert.equal(resManifest.status, 200);
    const manifestContentType = resManifest.headers.get('content-type') || '';
    assert(
      manifestContentType.includes('manifest+json'),
      `Expected manifest content-type to include manifest+json, got: ${manifestContentType}`
    );
    const manifestJson = await resManifest.json();
    assert.equal(manifestJson.name, 'KoW Tracker - Kingdom of Winners');
    assert.equal(manifestJson.start_url, '/');

    // 2. GET /sw.js -> 200, Service-Worker-Allowed: /, Cache-Control no-cache, Content-Type javascript
    const resSw = await fetch(`${baseUrl}/sw.js`);
    assert.equal(resSw.status, 200);
    const swContentType = resSw.headers.get('content-type') || '';
    assert(swContentType.includes('javascript'), `Expected javascript content-type, got: ${swContentType}`);
    assert.equal(resSw.headers.get('service-worker-allowed'), '/');
    const swCacheControl = resSw.headers.get('cache-control') || '';
    assert(swCacheControl.includes('no-cache'), `Expected no-cache in Cache-Control, got: ${swCacheControl}`);
    const swText = await resSw.text();
    assert(swText.includes('CACHE_NAME'), 'Expected CACHE_NAME in sw.js');
    assert(swText.includes('STATIC_ASSETS'), 'Expected STATIC_ASSETS in sw.js');

    // 3. GET /icons/icon-192.png -> 200, image/png
    const resIcon192 = await fetch(`${baseUrl}/icons/icon-192.png`);
    assert.equal(resIcon192.status, 200);
    const icon192Type = resIcon192.headers.get('content-type') || '';
    assert(icon192Type.includes('image/png'), `Expected image/png, got: ${icon192Type}`);
    const icon192Buf = await resIcon192.arrayBuffer();
    assert(icon192Buf.byteLength > 0);

    // 4. GET /icons/icon-512.png -> 200, image/png
    const resIcon512 = await fetch(`${baseUrl}/icons/icon-512.png`);
    assert.equal(resIcon512.status, 200);
    const icon512Type = resIcon512.headers.get('content-type') || '';
    assert(icon512Type.includes('image/png'), `Expected image/png, got: ${icon512Type}`);

    // 5. Safe icons path traversal check -> 403 or 404
    const resBadIcon = await fetch(`${baseUrl}/icons/../server.js`);
    assert(resBadIcon.status === 403 || resBadIcon.status === 404);
  } finally {
    await server.close();
  }
});

test('API enforces registration flow, pending approval, and login RBAC', async () => {
  const { startServer } = require('./server.js');
  const server = await startServer({ port: 0, dbPath: ':memory:' });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    // 1. Login with invalid credentials -> 401
    const badLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'wrongpassword' })
    });
    assert.equal(badLoginRes.status, 401);

    // 2. Login under bootstrapped admin (R5) -> 200
    const adminLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin123' })
    });
    assert.equal(adminLoginRes.status, 200);
    const { token: adminToken, user: adminUser } = await adminLoginRes.json();
    assert(adminToken);
    assert.equal(adminUser.rank, 'r5');

    // 3. Register a new user -> pendingApproval: true
    const regRes = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'soldier', password: 'password123', playerName: 'Солдат' })
    });
    assert.equal(regRes.status, 200);
    const regData = await regRes.json();
    assert.equal(regData.pendingApproval, true);

    // Registration with non-existent playerId -> 400 PLAYER_NOT_FOUND
    const badPlayerReg = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'ghost', password: 'password123', playerId: 99999 })
    });
    assert.equal(badPlayerReg.status, 400);
    const badPlayerData = await badPlayerReg.json();
    assert.equal(badPlayerData.error, 'PLAYER_NOT_FOUND');

    // Link unlinked player id 2 to a new user
    const linkedReg = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'linked_user', password: 'password123', playerId: 2 })
    });
    assert.equal(linkedReg.status, 200);

    // Registration with already linked playerId -> 400 PLAYER_ALREADY_LINKED
    const dupPlayerReg = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'intruder', password: 'password123', playerId: 2 })
    });
    assert.equal(dupPlayerReg.status, 400);
    const dupPlayerData = await dupPlayerReg.json();
    assert.equal(dupPlayerData.error, 'PLAYER_ALREADY_LINKED');

    // 4. Try logging in before approval -> 403
    const blockedLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'soldier', password: 'password123' })
    });
    assert.equal(blockedLoginRes.status, 403);
    const blockedData = await blockedLoginRes.json();
    assert.equal(blockedData.error, 'PENDING_APPROVAL');

    // 5. Admin lists pending users -> soldier is in the list
    const pendingRes = await fetch(`${baseUrl}/api/users/pending`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert.equal(pendingRes.status, 200);
    const pendingList = await pendingRes.json();
    const pendingSoldier = pendingList.find(u => u.username === 'soldier');
    assert(pendingSoldier);

    // 6. Admin approves soldier with rank 'r3'
    const approveRes = await fetch(`${baseUrl}/api/users/${pendingSoldier.id}/approve`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ rank: 'r3' })
    });
    assert.equal(approveRes.status, 200);

    // 7. Soldier logs in successfully -> 200
    const soldierLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'soldier', password: 'password123' })
    });
    assert.equal(soldierLoginRes.status, 200);
    const { token: soldierToken, user: soldierUser } = await soldierLoginRes.json();
    assert(soldierToken);
    assert.equal(soldierUser.rank, 'r3');

    // 8. Soldier (R3) tries to access /api/users/pending -> 403
    const soldierPendingRes = await fetch(`${baseUrl}/api/users/pending`, {
      headers: { Authorization: `Bearer ${soldierToken}` }
    });
    assert.equal(soldierPendingRes.status, 403);
  } finally {
    await server.close();
  }
});

test('API handles /api/auth/me, logout, change-password, and rejection', async () => {
  const { startServer } = require('./server.js');
  const server = await startServer({ port: 0, dbPath: ':memory:' });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    // 1. Unauthenticated /api/auth/me -> 401
    const unauthMe = await fetch(`${baseUrl}/api/auth/me`);
    assert.equal(unauthMe.status, 401);

    // 2. Admin login
    const adminLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin123' })
    });
    const { token: adminToken } = await adminLogin.json();

    // 3. Authenticated /api/auth/me -> 200 with user & player
    const authMe = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert.equal(authMe.status, 200);
    const meData = await authMe.json();
    assert.equal(meData.user.username, 'admin');
    assert.equal(meData.user.rank, 'r5');
    assert(meData.player);

    // 4. Change password
    const changePassRes = await fetch(`${baseUrl}/api/auth/change-password`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ newPassword: 'newadminpass456' })
    });
    assert.equal(changePassRes.status, 200);

    // Old token should be invalidated because changePassword clears sessions
    const checkOldToken = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert.equal(checkOldToken.status, 401);

    // Log in with new password
    const newLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'newadminpass456' })
    });
    assert.equal(newLogin.status, 200);
    const { token: newToken } = await newLogin.json();

    // Logout
    const logoutRes = await fetch(`${baseUrl}/api/auth/logout`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${newToken}` }
    });
    assert.equal(logoutRes.status, 200);

    // Invalidation after logout
    const afterLogout = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${newToken}` }
    });
    assert.equal(afterLogout.status, 401);

    // Test reject user
    // First re-login admin
    const relogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'newadminpass456' })
    });
    const { token: reloginToken } = await relogin.json();

    // Register spam user
    await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'spammer', password: 'pass', playerName: 'Спам' })
    });

    const pendingListRes = await fetch(`${baseUrl}/api/users/pending`, {
      headers: { Authorization: `Bearer ${reloginToken}` }
    });
    const pendingList = await pendingListRes.json();
    const spammer = pendingList.find(u => u.username === 'spammer');
    assert(spammer);

    // Reject spammer
    const rejectRes = await fetch(`${baseUrl}/api/users/${spammer.id}/reject`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${reloginToken}` }
    });
    assert.equal(rejectRes.status, 200);

    // Confirm spammer is gone
    const pendingAfter = await (await fetch(`${baseUrl}/api/users/pending`, {
      headers: { Authorization: `Bearer ${reloginToken}` }
    })).json();
    assert(!pendingAfter.some(u => u.username === 'spammer'));
  } finally {
    await server.close();
  }
});

test('API User management and role patch by R5 only', async () => {
  const { startServer } = require('./server.js');
  const server = await startServer({ port: 0, dbPath: ':memory:' });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const adminLogin = await (await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin123' })
    })).json();

    // Register user player2
    const regRes = await (await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'officer1', password: 'pass', playerName: 'Офицер 1' })
    })).json();

    // Approve as r3
    await fetch(`${baseUrl}/api/users/${regRes.userId}/approve`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminLogin.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ rank: 'r3' })
    });

    const officer1Login = await (await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'officer1', password: 'pass' })
    })).json();

    // R3 tries to GET /api/users -> 403
    const r3UsersRes = await fetch(`${baseUrl}/api/users`, {
      headers: { Authorization: `Bearer ${officer1Login.token}` }
    });
    assert.equal(r3UsersRes.status, 403);

    // R5 gets /api/users -> 200
    const r5UsersRes = await fetch(`${baseUrl}/api/users`, {
      headers: { Authorization: `Bearer ${adminLogin.token}` }
    });
    assert.equal(r5UsersRes.status, 200);
    const users = await r5UsersRes.json();
    assert(users.length >= 2);

    // R5 promotes officer1 to R4
    const patchRes = await fetch(`${baseUrl}/api/users/${regRes.userId}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${adminLogin.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ rank: 'r4' })
    });
    assert.equal(patchRes.status, 200);

    // Re-check officer1 /api/auth/me: rank should now be r4
    const officer1Me = await (await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${officer1Login.token}` }
    })).json();
    assert.equal(officer1Me.user.rank, 'r4');

    // R4 CAN access /api/users (expanded in v3.4.0)
    const r4UsersRes = await fetch(`${baseUrl}/api/users`, {
      headers: { Authorization: `Bearer ${officer1Login.token}` }
    });
    assert.equal(r4UsersRes.status, 200);

    // But R4 CANNOT patch users (only R5)
    const r4PatchRes = await fetch(`${baseUrl}/api/users/${regRes.userId}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${officer1Login.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ rank: 'r5' })
    });
    assert.equal(r4PatchRes.status, 403);

    // But R4 CAN access /api/users/pending!
    const r4PendingRes = await fetch(`${baseUrl}/api/users/pending`, {
      headers: { Authorization: `Bearer ${officer1Login.token}` }
    });
    assert.equal(r4PendingRes.status, 200);
  } finally {
    await server.close();
  }
});

test('API Player Cabinet /api/my-profile: read, update sector/stock, and officer CRUD', async () => {
  const { startServer } = require('./server.js');
  const server = await startServer({ port: 0, dbPath: ':memory:' });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const adminLogin = await (await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin123' })
    })).json();

    // Register and approve soldier
    const regRes = await (await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'fighter', password: 'pass', playerName: 'Боец' })
    })).json();
    await fetch(`${baseUrl}/api/users/${regRes.userId}/approve`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminLogin.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ rank: 'r3' })
    });

    const soldierLogin = await (await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'fighter', password: 'pass' })
    })).json();

    // 1. GET /api/my-profile
    const profRes = await fetch(`${baseUrl}/api/my-profile`, {
      headers: { Authorization: `Bearer ${soldierLogin.token}` }
    });
    assert.equal(profRes.status, 200);
    const prof = await profRes.json();
    assert.equal(prof.name, 'Боец');
    assert.deepEqual(prof.officers, []);

    // 2. PUT /api/my-profile -> update sector and stock
    const putProfRes = await fetch(`${baseUrl}/api/my-profile`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${soldierLogin.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sector: { vipLevel: 12, hqLevel: 28, confidentialityLevel: 5, power: 15000000, kills: 250000, killPoints: 250000 },
        stock: { coupons: 15000, puzzles: 120, chests: 10 }
      })
    });
    assert.equal(putProfRes.status, 200);
    const updatedProf = await putProfRes.json();
    assert.equal(updatedProf.sector.vipLevel, 12);
    assert.equal(updatedProf.sector.hqLevel, 28);
    assert.equal(updatedProf.stock.coupons, 15000);

    // 2b. PUT /api/my-profile should ignore sensitive fields like rank and id
    const escalateRes = await fetch(`${baseUrl}/api/my-profile`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${soldierLogin.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rank: 'r5',
        id: 999
      })
    });
    assert.equal(escalateRes.status, 200);
    const escalatedProf = await escalateRes.json();
    assert.equal(escalatedProf.rank, 'r3');
    assert.notEqual(escalatedProf.id, 999);

    // 3. POST /api/my-profile/officers -> add officer
    const addOffRes = await fetch(`${baseUrl}/api/my-profile/officers`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${soldierLogin.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        catalogId: 'admiral-nathon',
        name: 'Адмирал Нейтон',
        level: 15,
        coupons: 350,
        stars: 1
      })
    });
    assert.equal(addOffRes.status, 200);
    const addedOfficer = await addOffRes.json();
    assert(addedOfficer.id);
    assert.equal(addedOfficer.level, 15);

    // 4. PUT /api/my-profile/officers/:id -> update officer level & coupons
    const putOffRes = await fetch(`${baseUrl}/api/my-profile/officers/${addedOfficer.id}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${soldierLogin.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        level: 20,
        coupons: 500,
        stars: 2
      })
    });
    assert.equal(putOffRes.status, 200);
    const updatedOfficer = await putOffRes.json();
    assert.equal(updatedOfficer.level, 20);
    assert.equal(updatedOfficer.stars, 2);

    // 5. GET /api/my-profile again -> verify officer is present
    const checkProf = await (await fetch(`${baseUrl}/api/my-profile`, {
      headers: { Authorization: `Bearer ${soldierLogin.token}` }
    })).json();
    assert.equal(checkProf.officers.length, 1);
    assert.equal(checkProf.officers[0].level, 20);

    // 6. DELETE /api/my-profile/officers/:id
    const delOffRes = await fetch(`${baseUrl}/api/my-profile/officers/${addedOfficer.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${soldierLogin.token}` }
    });
    assert.equal(delOffRes.status, 200);

    const checkProfAfter = await (await fetch(`${baseUrl}/api/my-profile`, {
      headers: { Authorization: `Bearer ${soldierLogin.token}` }
    })).json();
    assert.equal(checkProfAfter.officers.length, 0);

    // 7. POST /api/my-profile/confirm-stock
    const confirmRes = await fetch(`${baseUrl}/api/my-profile/confirm-stock`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${soldierLogin.token}` }
    });
    assert.equal(confirmRes.status, 200);
    const confirmData = await confirmRes.json();
    assert.equal(confirmData.success, true);
    assert.equal(confirmData.stockUpdateSource, 'manual_confirm');
    assert.ok(confirmData.stockUpdatedAt);

    // Unauthorized check
    const noAuthConfirm = await fetch(`${baseUrl}/api/my-profile/confirm-stock`, { method: 'POST' });
    assert.equal(noAuthConfirm.status, 401);
  } finally {
    await server.close();
  }
});

test('API RBAC for /api/players: R3 is forbidden (403), R4/R5 can manage players', async () => {
  const { startServer } = require('./server.js');
  const server = await startServer({ port: 0, dbPath: ':memory:' });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const adminLogin = await (await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin123' })
    })).json();

    // Register and approve soldier (R3)
    const regRes = await (await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'regular', password: 'pass', playerName: 'Рядовой' })
    })).json();
    await fetch(`${baseUrl}/api/users/${regRes.userId}/approve`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminLogin.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ rank: 'r3' })
    });

    const r3Login = await (await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'regular', password: 'pass' })
    })).json();

    // 1. R3 GET /api/players -> 403 Forbidden
    const r3GetPlayers = await fetch(`${baseUrl}/api/players`, {
      headers: { Authorization: `Bearer ${r3Login.token}` }
    });
    assert.equal(r3GetPlayers.status, 403);

    // 2. R5 GET /api/players -> 200
    const r5GetPlayers = await fetch(`${baseUrl}/api/players`, {
      headers: { Authorization: `Bearer ${adminLogin.token}` }
    });
    assert.equal(r5GetPlayers.status, 200);
    const players = await r5GetPlayers.json();
    assert(players.length > 0);

    // 3. R5 creates a new player
    const createPlayerRes = await fetch(`${baseUrl}/api/players`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminLogin.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Новый Воин',
        rank: 'r3',
        officers: [
          { catalogId: 'aurora', name: 'Аврора', level: 10 },
          { catalogId: 'rex', name: 'Рекс', level: 5 }
        ]
      })
    });
    assert.equal(createPlayerRes.status, 200);
    const createdPlayer = await createPlayerRes.json();
    assert.equal(createdPlayer.name, 'Новый Воин');
    assert.equal(createdPlayer.officers.length, 2);

    // 4. R5 updates the player and syncs officers (omitted officer is deleted)
    const keepOfficer = createdPlayer.officers[0];
    const updatePlayerRes = await fetch(`${baseUrl}/api/players/${createdPlayer.id}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${adminLogin.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Ветеран Войны',
        officers: [keepOfficer]
      })
    });
    assert.equal(updatePlayerRes.status, 200);
    const updated = await updatePlayerRes.json();
    assert.equal(updated.name, 'Ветеран Войны');
    assert.equal(updated.officers.length, 1);
    assert.equal(updated.officers[0].id, keepOfficer.id);

    // 5. R5 deletes player
    const delRes = await fetch(`${baseUrl}/api/players/${createdPlayer.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminLogin.token}` }
    });
    assert.equal(delRes.status, 200);
  } finally {
    await server.close();
  }
});

test('API Events, Registrations and Smart AutoPick with RBAC', async () => {
  const { startServer } = require('./server.js');
  const server = await startServer({ port: 0, dbPath: ':memory:' });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const adminLogin = await (await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin123' })
    })).json();

    // 1. Get events as Admin (R5) -> receives registrations array
    const eventsRes = await fetch(`${baseUrl}/api/events`, {
      headers: { Authorization: `Bearer ${adminLogin.token}` }
    });
    assert.equal(eventsRes.status, 200);
    const events = await eventsRes.json();
    assert(events.length > 0);
    const targetEvent = events[0]; // event id: 1
    assert(Array.isArray(targetEvent.registrations));

    // Register a player 'alex' with high deficit
    const regAlex = await (await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'alex', password: 'pass', playerName: 'Алекс' })
    })).json();
    await fetch(`${baseUrl}/api/users/${regAlex.userId}/approve`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminLogin.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ rank: 'r3' })
    });

    const alexLogin = await (await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'alex', password: 'pass' })
    })).json();

    // Alex adds an officer with level 1 (high deficit ~24000 coupons)
    const alexOfficer = await (await fetch(`${baseUrl}/api/my-profile/officers`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${alexLogin.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        catalogId: 'admiral-nathon',
        name: 'Адмирал Нейтон',
        level: 1,
        coupons: 0,
        stars: 0
      })
    })).json();

    // Alex registers for Event 1 desiring 1st place
    const regEventRes = await fetch(`${baseUrl}/api/events/${targetEvent.id}/register`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${alexLogin.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        officerId: alexOfficer.id,
        desiredPlace: 1
      })
    });
    assert.equal(regEventRes.status, 200);

    // Alex GET /api/events -> sees myRegistration for event 1
    const alexEvents = await (await fetch(`${baseUrl}/api/events`, {
      headers: { Authorization: `Bearer ${alexLogin.token}` }
    })).json();
    const alexTargetEvent = alexEvents.find(e => e.id === targetEvent.id);
    assert(alexTargetEvent.myRegistration);
    assert.equal(alexTargetEvent.myRegistration.desiredPlace, 1);
    // R3 should NOT see other players' registrations list
    assert.equal(alexTargetEvent.registrations, undefined);

    // Alex (R3) tries to run autopick -> 403 Forbidden
    const alexAutopick = await fetch(`${baseUrl}/api/events/${targetEvent.id}/autopick`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${alexLogin.token}` }
    });
    assert.equal(alexAutopick.status, 403);

    // Admin (R5) runs autopick -> 200 OK
    const adminAutopick = await fetch(`${baseUrl}/api/events/${targetEvent.id}/autopick`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminLogin.token}` }
    });
    assert.equal(adminAutopick.status, 200);
    const autopickResult = await adminAutopick.json();
    assert(autopickResult.success);
    assert(Array.isArray(autopickResult.assignments));
    // Alex requested place 1 and has enough deficit for 1st place (12500), so Alex should be at place 1
    const place1 = autopickResult.assignments.find(a => a.place === 1);
    assert.equal(place1.playerId, alexLogin.user.playerId);

    // Alex unregisters from event
    const unregRes = await fetch(`${baseUrl}/api/events/${targetEvent.id}/register`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${alexLogin.token}` }
    });
    assert.equal(unregRes.status, 200);

    // Alex GET /api/events -> myRegistration is null
    const alexEventsAfter = await (await fetch(`${baseUrl}/api/events`, {
      headers: { Authorization: `Bearer ${alexLogin.token}` }
    })).json();
    const eventAfter = alexEventsAfter.find(e => e.id === targetEvent.id);
    assert.equal(eventAfter.myRegistration, null);
  } finally {
    await server.close();
  }
});

test('API Admin export and import with RBAC', async () => {
  const { startServer } = require('./server.js');
  const server = await startServer({ port: 0, dbPath: ':memory:' });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const adminLogin = await (await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin123' })
    })).json();

    // Register and approve regular R3 user
    const regRes = await (await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'r3user', password: 'pass', playerName: 'Рядовой' })
    })).json();
    await fetch(`${baseUrl}/api/users/${regRes.userId}/approve`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminLogin.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ rank: 'r3' })
    });
    const r3Login = await (await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'r3user', password: 'pass' })
    })).json();

    // R3 tries /api/admin/export -> 403
    const r3Export = await fetch(`${baseUrl}/api/admin/export`, {
      headers: { Authorization: `Bearer ${r3Login.token}` }
    });
    assert.equal(r3Export.status, 403);

    // Register and approve R4 officer user
    const r4Reg = await (await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'r4officer', password: 'pass', playerName: 'Офицер' })
    })).json();
    await fetch(`${baseUrl}/api/users/${r4Reg.userId}/approve`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminLogin.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ rank: 'r4' })
    });
    const r4Login = await (await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'r4officer', password: 'pass' })
    })).json();

    // R4 tries /api/admin/export -> 403 (strictly R5 only)
    const r4Export = await fetch(`${baseUrl}/api/admin/export`, {
      headers: { Authorization: `Bearer ${r4Login.token}` }
    });
    assert.equal(r4Export.status, 403);

    // R5 calls /api/admin/export -> 200
    const exportRes = await fetch(`${baseUrl}/api/admin/export`, {
      headers: { Authorization: `Bearer ${adminLogin.token}` }
    });
    assert.equal(exportRes.status, 200);
    const backup = await exportRes.json();
    assert(backup.players);
    assert(backup.events);
    assert(backup.officerCatalog);

    // R3 tries /api/admin/import -> 403
    const r3Import = await fetch(`${baseUrl}/api/admin/import`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${r3Login.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(backup)
    });
    assert.equal(r3Import.status, 403);

    // R4 tries /api/admin/import -> 403 (strictly R5 only)
    const r4Import = await fetch(`${baseUrl}/api/admin/import`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${r4Login.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(backup)
    });
    assert.equal(r4Import.status, 403);

    // R5 calls /api/admin/import -> 200
    const r5Import = await fetch(`${baseUrl}/api/admin/import`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminLogin.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(backup)
    });
    assert.equal(r5Import.status, 200);
    const importResult = await r5Import.json();
    assert(importResult.success);
  } finally {
    await server.close();
  }
});

test('API Catalog and Event-Types CRUD with RBAC', async () => {
  const { startServer } = require('./server.js');
  const server = await startServer({ port: 0, dbPath: ':memory:' });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const adminLogin = await (await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin123' })
    })).json();

    // Register and approve regular R3 user
    const regRes = await (await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'cat_r3', password: 'pass', playerName: 'Каталог Р3' })
    })).json();
    await fetch(`${baseUrl}/api/users/${regRes.userId}/approve`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminLogin.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ rank: 'r3' })
    });
    const r3Login = await (await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'cat_r3', password: 'pass' })
    })).json();

    // 1. GET /api/catalog is public/available to all
    const catRes = await fetch(`${baseUrl}/api/catalog`);
    assert.equal(catRes.status, 200);
    const catalog = await catRes.json();
    assert(catalog.length > 0);

    // 2. R3 tries to POST /api/catalog -> 403
    const r3AddCat = await fetch(`${baseUrl}/api/catalog`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${r3Login.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'new-officer', name: 'Новый Офицер', type: 'Танк' })
    });
    assert.equal(r3AddCat.status, 403);

    // 3. R5 POST /api/catalog -> 200
    const r5AddCat = await fetch(`${baseUrl}/api/catalog`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminLogin.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'new-officer', name: 'Новый Офицер', type: 'Танк' })
    });
    assert.equal(r5AddCat.status, 200);

    // 3b. Deleting officer in use -> 400 OFFICER_IN_USE
    const deleteInUse = await fetch(`${baseUrl}/api/catalog/admiral-nathon`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminLogin.token}` }
    });
    assert.equal(deleteInUse.status, 400);
    const deleteInUseErr = await deleteInUse.json();
    assert.equal(deleteInUseErr.error, 'OFFICER_IN_USE');

    // 3c. Deleting unused officer -> 200
    const deleteUnused = await fetch(`${baseUrl}/api/catalog/new-officer`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminLogin.token}` }
    });
    assert.equal(deleteUnused.status, 200);

    // 4. GET /api/event-types is public/available to all
    const etRes = await fetch(`${baseUrl}/api/event-types`);
    assert.equal(etRes.status, 200);
    const eventTypes = await etRes.json();
    assert(eventTypes.length > 0);

    // 5. R3 tries to POST /api/event-types -> 403
    const r3AddEt = await fetch(`${baseUrl}/api/event-types`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${r3Login.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Новый Ивент' })
    });
    assert.equal(r3AddEt.status, 403);

    // 6. R5 POST /api/event-types -> 200
    const r5AddEt = await fetch(`${baseUrl}/api/event-types`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminLogin.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Новый Ивент', color: '#ff0000', places: [{ place: 1, label: '1', coupons: 1000 }] })
    });
    assert.equal(r5AddEt.status, 200);
    const createdEt = await r5AddEt.json();
    assert(createdEt.id);
  } finally {
    await server.close();
  }
});

test('API schedule-season, fair play autopick, profile skills and vip points', async () => {
  const { startServer } = require('./server.js');
  const server = await startServer({ port: 0, dbPath: ':memory:' });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    // 1. Login as Admin (R5)
    const adminLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin123' })
    });
    const adminLogin = await adminLoginRes.json();
    const adminToken = adminLogin.token;

    // 2. Register and approve R3 user
    const regRes = await (await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'r3_tester', password: 'password123', playerName: 'Тестер Р3' })
    })).json();
    await fetch(`${baseUrl}/api/users/${regRes.userId}/approve`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ rank: 'r3' })
    });
    const r3Login = await (await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'r3_tester', password: 'password123' })
    })).json();
    const r3Token = r3Login.token;

    // 3. Test POST /api/events/schedule-season RBAC: R3 gets 403
    const r3SeasonRes = await fetch(`${baseUrl}/api/events/schedule-season`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${r3Token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ presetId: 'king-of-war', startDate: '2026-12-01', cyclesCount: 2 })
    });
    assert.equal(r3SeasonRes.status, 403);

    // 4. Test POST /api/events/schedule-season as R5 (with cookie header)
    const seasonRes = await fetch(`${baseUrl}/api/events/schedule-season`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        cookie: `token=${adminToken}`
      },
      body: JSON.stringify({ presetId: 'king-of-war', startDate: '2026-12-01', cyclesCount: 2 })
    });
    assert.equal(seasonRes.status, 201);
    const seasonData = await seasonRes.json();
    assert.equal(seasonData.createdCount, 2);
    assert.equal(seasonData.events.length, 2);
    assert.equal(seasonData.events[0].dateFrom, '2026-12-01');

    // 5. Test R3 profile: PUT /api/my-profile with sector.vipPoints and officer skills
    // First, add an officer for R3 via POST /api/my-profile/officers with skills
    const addOffRes = await fetch(`${baseUrl}/api/my-profile/officers`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${r3Token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        catalogId: 'general-rex',
        name: 'Генерал Рекс',
        level: 20,
        skills: [5, 4, 3, 2]
      })
    });
    assert.equal(addOffRes.status, 200);
    const addedOff = await addOffRes.json();
    assert.deepEqual(addedOff.skills, [5, 4, 3, 2]);

    // Update via PUT /api/my-profile
    const updateProfRes = await fetch(`${baseUrl}/api/my-profile`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        cookie: `token=${r3Token}`
      },
      body: JSON.stringify({
        sector: { vipLevel: 11, vipPoints: 220000 },
        officers: [{ id: addedOff.id, catalogId: 'general-rex', level: 25, skills: [5, 3, 1, 1] }]
      })
    });
    assert.equal(updateProfRes.status, 200);
    const updatedProf = await updateProfRes.json();
    assert.equal(updatedProf.sector.vipPoints, 220000);
    assert.equal(updatedProf.officers.length, 1);
    assert.deepEqual(updatedProf.officers[0].skills, [5, 3, 1, 1]);

    // Update officer directly via PUT /api/my-profile/officers/:id
    const putOffRes = await fetch(`${baseUrl}/api/my-profile/officers/${addedOff.id}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${r3Token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        skills: [5, 5, 5, 5],
        invested: { starCoupons: 253000, legendaryStars3: 6 }
      })
    });
    assert.equal(putOffRes.status, 200);
    const putOffData = await putOffRes.json();
    assert.deepEqual(putOffData.skills, [5, 5, 5, 5]);
    assert.equal(putOffData.invested.starCoupons, 253000);
    assert.equal(putOffData.invested.legendaryStars3, 6);

    // 6. Test /api/players (POST and PUT) with vipPoints and skills
    const newPlayerRes = await fetch(`${baseUrl}/api/players`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'VIP Воин',
        sector: { vipLevel: 12, vipPoints: 350000 },
        officers: [{ catalogId: 'aurora', name: 'Аврора', level: 10, skills: [4, 4, 3, 2] }]
      })
    });
    assert.equal(newPlayerRes.status, 200);
    const newPlayer = await newPlayerRes.json();
    assert.equal(newPlayer.sector.vipPoints, 350000);
    assert.equal(newPlayer.officers[0].skills[0], 4);

    const updatePlayerRes = await fetch(`${baseUrl}/api/players/${newPlayer.id}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sector: { vipPoints: 400000 },
        officers: [{ id: newPlayer.officers[0].id, catalogId: 'aurora', level: 15, skills: [5, 5, 4, 3] }]
      })
    });
    assert.equal(updatePlayerRes.status, 200);
    const updatedPlayer = await updatePlayerRes.json();
    assert.equal(updatedPlayer.sector.vipPoints, 400000);
    assert.deepEqual(updatedPlayer.officers[0].skills, [5, 5, 4, 3]);

    // 7. Test /api/catalog (POST and PUT) with upgradeType
    const addCatRes = await fetch(`${baseUrl}/api/catalog`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'special-commander',
        name: 'Спец Командир',
        type: 'Танк',
        upgradeType: 'special'
      })
    });
    assert.equal(addCatRes.status, 200);
    const addedCat = await addCatRes.json();
    assert.equal(addedCat.upgradeType, 'special');

    const putCatRes = await fetch(`${baseUrl}/api/catalog/special-commander`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Спец Командир (Колесо)',
        upgradeType: 'special'
      })
    });
    assert.equal(putCatRes.status, 200);
    const putCat = await putCatRes.json();
    assert.equal(putCat.upgradeType, 'special');

    // 8. Test fair play cooldown in autopick
    const autopickRes = await fetch(`${baseUrl}/api/events/3/autopick`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert.equal(autopickRes.status, 200);
    const autopickData = await autopickRes.json();
    assert(autopickData.success);
    const p3Assignment = autopickData.assignments.find(a => a.playerId === 3);
    if (p3Assignment) {
      assert.equal(p3Assignment.isCooldown, true);
    }
  } finally {
    await server.close();
  }
});

test('API supports WASM static serving and star stock fields sanitization in profile and players API', async () => {
  const { startServer, MIME_TYPES } = require('./server.js');
  const server = await startServer({ port: 0, dbPath: ':memory:' });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const dummyWasmPath = path.join(__dirname, 'test_dummy_asset.wasm');
  fs.writeFileSync(dummyWasmPath, Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]));

  try {
    // 1. WASM MIME type check in dictionary and static file server response
    assert(MIME_TYPES && MIME_TYPES['.wasm'] === 'application/wasm', 'MIME_TYPES must map .wasm to application/wasm');
    const wasmRes = await fetch(`${baseUrl}/test_dummy_asset.wasm`);
    assert.equal(wasmRes.status, 200);
    assert.equal(wasmRes.headers.get('content-type'), 'application/wasm');

    // 2. Auth login as admin to create/approve player
    const adminLogin = await (await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin123' })
    })).json();

    const regRes = await (await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'star_commander', password: 'secretpassword', playerName: 'Звездный Маршал' })
    })).json();

    await fetch(`${baseUrl}/api/users/${regRes.userId}/approve`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminLogin.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ rank: 'r3' })
    });

    const userLogin = await (await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'star_commander', password: 'secretpassword' })
    })).json();

    // 3. PUT /api/my-profile with screenshot OCR values (testing sanitization of strings and negative numbers)
    const updateRes = await fetch(`${baseUrl}/api/my-profile`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${userLogin.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        stock: {
          coupons: '419202',
          puzzles: '2077',
          starCoupons: '244712',
          legendaryStars1: '1097',
          legendaryStars2: 95,
          legendaryStars3: 22,
          chests: 15
        }
      })
    });
    assert.equal(updateRes.status, 200);
    const updatedBody = await updateRes.json();
    assert.equal(updatedBody.stock.starCoupons, 244712);
    assert.equal(updatedBody.stock.legendaryStars1, 1097);
    assert.equal(updatedBody.stock.legendaryStars2, 95);
    assert.equal(updatedBody.stock.legendaryStars3, 22);
    assert.equal(updatedBody.stock.coupons, 419202);
    assert.equal(updatedBody.stock.puzzles, 2077);
    assert.equal(updatedBody.stock.chests, 15);

    // 4. GET /api/my-profile verifies persistent retrieval
    const getRes = await fetch(`${baseUrl}/api/my-profile`, {
      headers: { Authorization: `Bearer ${userLogin.token}` }
    });
    assert.equal(getRes.status, 200);
    const getBody = await getRes.json();
    assert.equal(getBody.stock.starCoupons, 244712);
    assert.equal(getBody.stock.legendaryStars1, 1097);
    assert.equal(getBody.stock.legendaryStars2, 95);
    assert.equal(getBody.stock.legendaryStars3, 22);

    // 5. Negative numbers sanitization in PUT /api/my-profile (must be clamped to >= 0)
    const clampRes = await fetch(`${baseUrl}/api/my-profile`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${userLogin.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        stock: {
          starCoupons: -500,
          legendaryStars1: -10,
          legendaryStars2: -5,
          legendaryStars3: -1
        }
      })
    });
    assert.equal(clampRes.status, 200);
    const clampedBody = await clampRes.json();
    assert.equal(clampedBody.stock.starCoupons, 0);
    assert.equal(clampedBody.stock.legendaryStars1, 0);
    assert.equal(clampedBody.stock.legendaryStars2, 0);
    assert.equal(clampedBody.stock.legendaryStars3, 0);

    // 6. R4/R5 endpoints POST /api/players and PUT /api/players/:id sanitize stock fields
    const createPlayerRes = await fetch(`${baseUrl}/api/players`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${adminLogin.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: 'Новый Рекрут Звезд',
        stock: {
          starCoupons: '3000',
          legendaryStars1: 50,
          legendaryStars2: 20,
          legendaryStars3: 5
        }
      })
    });
    assert.equal(createPlayerRes.status, 200);
    const createdPlayer = await createPlayerRes.json();
    assert.equal(createdPlayer.stock.starCoupons, 3000);
    assert.equal(createdPlayer.stock.legendaryStars1, 50);

    const updatePlayerRes = await fetch(`${baseUrl}/api/players/${createdPlayer.id}`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${adminLogin.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        stock: {
          starCoupons: -10,
          legendaryStars1: '120'
        }
      })
    });
    assert.equal(updatePlayerRes.status, 200);
    const updatedPlayer = await updatePlayerRes.json();
    assert.equal(updatedPlayer.stock.starCoupons, 0);
    assert.equal(updatedPlayer.stock.legendaryStars1, 120);
  } finally {
    if (fs.existsSync(dummyWasmPath)) {
      fs.unlinkSync(dummyWasmPath);
    }
    await server.close();
  }
});

test('API multi-sector profile, active sector switching and new sector creation', async () => {
  const { startServer } = require('./server.js');
  const server = await startServer({ port: 0, dbPath: ':memory:' });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const adminLogin = await (await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin123' })
    })).json();

    // 1. Register a user who skips sector creation ("Сделать позже" -> no playerName / playerId)
    const regNoSector = await (await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'novice', password: 'password123' })
    })).json();

    await fetch(`${baseUrl}/api/users/${regNoSector.userId}/approve`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminLogin.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ rank: 'r3' })
    });

    const noviceLogin = await (await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'novice', password: 'password123' })
    })).json();

    // 2. GET /api/my-profile for user with 0 sectors -> 200 with empty sectors array, activeSectorId: null
    const noSectorProfRes = await fetch(`${baseUrl}/api/my-profile`, {
      headers: { Authorization: `Bearer ${noviceLogin.token}` }
    });
    assert.equal(noSectorProfRes.status, 200);
    const noSectorProf = await noSectorProfRes.json();
    assert.equal(noSectorProf.user.username, 'novice');
    assert.deepEqual(noSectorProf.sectors, []);
    assert.equal(noSectorProf.activeSectorId, null);
    assert.equal(noSectorProf.sector, null);
    assert.equal(noSectorProf.stock, null);
    assert.deepEqual(noSectorProf.officers, []);

    // 3. POST /api/my-sectors -> create first sector
    const createSec1Res = await fetch(`${baseUrl}/api/my-sectors`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${noviceLogin.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'База Мейн',
        realName: 'Иван',
        sector: { power: 50000000, vipLevel: 10, confidentialityLevel: 4 },
        stock: { coupons: 5000, puzzles: 50 }
      })
    });
    assert.equal(createSec1Res.status, 201);
    const sec1 = await createSec1Res.json();
    assert.equal(sec1.name, 'База Мейн');
    assert.equal(sec1.userId, noviceLogin.user.id);
    assert.equal(sec1.sector.power, 50000000);

    // Profile now has 1 sector and it auto-became active
    const profAfter1Res = await fetch(`${baseUrl}/api/my-profile`, {
      headers: { Authorization: `Bearer ${noviceLogin.token}` }
    });
    assert.equal(profAfter1Res.status, 200);
    const profAfter1 = await profAfter1Res.json();
    assert.equal(profAfter1.activeSectorId, sec1.id);
    assert.equal(profAfter1.name, 'База Мейн');
    assert.equal(profAfter1.sectors.length, 1);

    // 4. POST /api/my-sectors -> validation error on empty name
    const badSecRes = await fetch(`${baseUrl}/api/my-sectors`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${noviceLogin.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '   ' })
    });
    assert.equal(badSecRes.status, 400);

    // 5. POST /api/my-sectors -> create second sector (Farm)
    const createSec2Res = await fetch(`${baseUrl}/api/my-sectors`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${noviceLogin.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'База Ферма',
        sector: { power: 12000000, vipLevel: 6 }
      })
    });
    assert.equal(createSec2Res.status, 201);
    const sec2 = await createSec2Res.json();
    assert.equal(sec2.name, 'База Ферма');
    assert.equal(sec2.userId, noviceLogin.user.id);

    // 6. Switch active sector via POST /api/my-profile/active-sector
    const switchRes = await fetch(`${baseUrl}/api/my-profile/active-sector`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${noviceLogin.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ sectorId: sec2.id })
    });
    assert.equal(switchRes.status, 200);
    const switchData = await switchRes.json();
    assert.equal(switchData.activeSectorId, sec2.id);

    // Profile now reflects active sector sec2
    const profAfterSwitch = await (await fetch(`${baseUrl}/api/my-profile`, {
      headers: { Authorization: `Bearer ${noviceLogin.token}` }
    })).json();
    assert.equal(profAfterSwitch.activeSectorId, sec2.id);
    assert.equal(profAfterSwitch.name, 'База Ферма');
    assert.equal(profAfterSwitch.sectors.length, 2);

    // Query param ?sectorId=... can view a specific sector without switching active pointer
    const profParamSec1 = await (await fetch(`${baseUrl}/api/my-profile?sectorId=${sec1.id}`, {
      headers: { Authorization: `Bearer ${noviceLogin.token}` }
    })).json();
    assert.equal(profParamSec1.activeSectorId, sec1.id);
    assert.equal(profParamSec1.name, 'База Мейн');

    // 7. Attempt to set foreign sector as active -> 403
    // Bootstrapped player id 1 belongs to demo or admin, not novice
    const foreignSwitchRes = await fetch(`${baseUrl}/api/my-profile/active-sector`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${noviceLogin.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ sectorId: 1 })
    });
    assert.equal(foreignSwitchRes.status, 403);
  } finally {
    await server.close();
  }
});

test('API unified PUT /api/players/:id and sector officer point CRUD with RBAC', async () => {
  const { startServer } = require('./server.js');
  const server = await startServer({ port: 0, dbPath: ':memory:' });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const adminLogin = await (await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin123' })
    })).json();

    // Register user playerA (R3)
    const regA = await (await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'player_a', password: 'pass', playerName: 'Сектор А' })
    })).json();
    await fetch(`${baseUrl}/api/users/${regA.userId}/approve`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminLogin.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ rank: 'r3' })
    });
    const loginA = await (await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'player_a', password: 'pass' })
    })).json();
    const sectorAId = loginA.user.playerId;

    // Register user playerB (R3)
    const regB = await (await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'player_b', password: 'pass', playerName: 'Сектор Б' })
    })).json();
    await fetch(`${baseUrl}/api/users/${regB.userId}/approve`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminLogin.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ rank: 'r3' })
    });
    const loginB = await (await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'player_b', password: 'pass' })
    })).json();
    const sectorBId = loginB.user.playerId;

    // 1. PlayerA updates sectorA via PUT /api/players/:id -> 200
    const updateSecARes = await fetch(`${baseUrl}/api/players/${sectorAId}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${loginA.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        realName: 'Алекс',
        sector: { power: 85000000, vipLevel: 11 },
        stock: { coupons: 12000 },
        // Attempt privilege escalation:
        rank: 'r5',
        userId: 999
      })
    });
    assert.equal(updateSecARes.status, 200);
    const updatedSecA = await updateSecARes.json();
    assert.equal(updatedSecA.realName, 'Алекс');
    assert.equal(updatedSecA.sector.power, 85000000);
    // Escalated fields ignored:
    assert.equal(updatedSecA.rank, 'r3');
    assert.equal(updatedSecA.userId, loginA.user.id);

    // 2. PlayerA tries to update sectorB -> 403 FORBIDDEN
    const forbiddenPutRes = await fetch(`${baseUrl}/api/players/${sectorBId}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${loginA.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Хакнуто' })
    });
    assert.equal(forbiddenPutRes.status, 403);

    // 3. Point officer CRUD: POST /api/players/:id/officers
    const addOffRes = await fetch(`${baseUrl}/api/players/${sectorAId}/officers`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${loginA.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        catalogId: 'aurora',
        name: 'Аврора',
        level: 12,
        coupons: 450,
        stars: 2,
        skills: [3, 2, 1, 0]
      })
    });
    assert.equal(addOffRes.status, 201);
    const createdOff = await addOffRes.json();
    assert(createdOff.id);
    assert.equal(createdOff.catalogId, 'aurora');
    assert.equal(createdOff.level, 12);

    // 3b. PlayerB cannot add officer to sectorA -> 403
    const foreignAddOff = await fetch(`${baseUrl}/api/players/${sectorAId}/officers`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${loginB.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ catalogId: 'rex', name: 'Рекс' })
    });
    assert.equal(foreignAddOff.status, 403);

    // 4. Point officer CRUD: PUT /api/players/:id/officers/:offId
    const putOffRes = await fetch(`${baseUrl}/api/players/${sectorAId}/officers/${createdOff.id}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${loginA.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        level: 18,
        stars: 3,
        skills: [5, 5, 2, 1]
      })
    });
    assert.equal(putOffRes.status, 200);
    const updatedOff = await putOffRes.json();
    assert.equal(updatedOff.level, 18);
    assert.equal(updatedOff.stars, 3);

    // 4b. PlayerB cannot edit officer of sectorA -> 403
    const foreignPutOff = await fetch(`${baseUrl}/api/players/${sectorAId}/officers/${createdOff.id}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${loginB.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ level: 99 })
    });
    assert.equal(foreignPutOff.status, 403);

    // 5. Point officer CRUD: DELETE /api/players/:id/officers/:offId
    // PlayerB cannot delete -> 403
    const foreignDelOff = await fetch(`${baseUrl}/api/players/${sectorAId}/officers/${createdOff.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${loginB.token}` }
    });
    assert.equal(foreignDelOff.status, 403);

    // Owner deletes -> 200
    const delOffRes = await fetch(`${baseUrl}/api/players/${sectorAId}/officers/${createdOff.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${loginA.token}` }
    });
    assert.equal(delOffRes.status, 200);

    // Verify officer is gone
    const secAfterDel = await (await fetch(`${baseUrl}/api/players/${sectorAId}`, {
      headers: { Authorization: `Bearer ${loginA.token}` }
    })).json();
    assert.equal(secAfterDel.officers.length, 0);

    // 6. R5 can also perform point officer CRUD on any sector
    const adminAddOff = await fetch(`${baseUrl}/api/players/${sectorAId}/officers`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminLogin.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ catalogId: 'rex', name: 'Рекс', level: 10 })
    });
    assert.equal(adminAddOff.status, 201);
  } finally {
    await server.close();
  }
});

test('API event multi-registration and multi-sector registrations listing', async () => {
  const { startServer } = require('./server.js');
  const server = await startServer({ port: 0, dbPath: ':memory:' });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const adminLogin = await (await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin123' })
    })).json();

    // Register user commander
    const regRes = await (await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'commander', password: 'pass', playerName: 'Мейн База' })
    })).json();
    await fetch(`${baseUrl}/api/users/${regRes.userId}/approve`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminLogin.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ rank: 'r3' })
    });
    const cmdLogin = await (await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'commander', password: 'pass' })
    })).json();
    const mainSecId = cmdLogin.user.playerId;

    // Commander creates a second sector (farm)
    const farmSec = await (await fetch(`${baseUrl}/api/my-sectors`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cmdLogin.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Ферма База' })
    })).json();
    const farmSecId = farmSec.id;

    // Get an event to register for
    const events = await (await fetch(`${baseUrl}/api/events`, {
      headers: { Authorization: `Bearer ${cmdLogin.token}` }
    })).json();
    assert(events.length > 0);
    const eventId = events[0].id;

    // 1. Register main base without explicit sectorId (uses active sector)
    const reg1Res = await fetch(`${baseUrl}/api/events/${eventId}/register`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cmdLogin.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ desiredPlace: 1 })
    });
    assert.equal(reg1Res.status, 200);
    const reg1Data = await reg1Res.json();
    assert.equal(reg1Data.registration.playerId, mainSecId);

    // 2. Register farm base with explicit sectorId
    const reg2Res = await fetch(`${baseUrl}/api/events/${eventId}/register`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cmdLogin.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ sectorId: farmSecId, desiredPlace: 3 })
    });
    assert.equal(reg2Res.status, 200);
    const reg2Data = await reg2Res.json();
    assert.equal(reg2Data.registration.playerId, farmSecId);

    // 3. GET /api/events returns both registrations in myRegistrations and preserves myRegistration
    const eventsAfter = await (await fetch(`${baseUrl}/api/events`, {
      headers: { Authorization: `Bearer ${cmdLogin.token}` }
    })).json();
    const targetEv = eventsAfter.find(e => e.id === eventId);
    assert(targetEv);
    assert.equal(targetEv.myRegistrations.length, 2);
    assert(targetEv.myRegistrations.some(r => r.playerId === mainSecId));
    assert(targetEv.myRegistrations.some(r => r.playerId === farmSecId));
    assert.equal(targetEv.myRegistration.playerId, mainSecId);

    // 4. Try registering foreign sector -> 404 or 403
    const foreignRegRes = await fetch(`${baseUrl}/api/events/${eventId}/register`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cmdLogin.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ sectorId: 9999 })
    });
    assert.equal(foreignRegRes.status, 404);

    // 5. Unregister farm sector with query ?sectorId=...
    const unregFarmRes = await fetch(`${baseUrl}/api/events/${eventId}/register?sectorId=${farmSecId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${cmdLogin.token}` }
    });
    assert.equal(unregFarmRes.status, 200);

    // Verify only main base remains registered
    const eventsAfterUnreg = await (await fetch(`${baseUrl}/api/events`, {
      headers: { Authorization: `Bearer ${cmdLogin.token}` }
    })).json();
    const targetEvAfter = eventsAfterUnreg.find(e => e.id === eventId);
    assert.equal(targetEvAfter.myRegistrations.length, 1);
    assert.equal(targetEvAfter.myRegistrations[0].playerId, mainSecId);
  } finally {
    await server.close();
  }
});

test('API VIP tiers GET /api/vip-tiers and PUT /api/vip-tiers with RBAC', async () => {
  const { startServer } = require('./server.js');
  const server = await startServer({ port: 0, dbPath: ':memory:' });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const adminLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin123' })
    });
    const { token: adminToken } = await adminLoginRes.json();

    // Register R3 user
    const r3RegRes = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'vip_r3_user', password: 'password123' })
    });
    const r3Reg = await r3RegRes.json();
    await fetch(`${baseUrl}/api/users/${r3Reg.userId}/approve`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ rank: 'r3' })
    });
    const r3LoginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'vip_r3_user', password: 'password123' })
    });
    const { token: r3Token } = await r3LoginRes.json();

    // 1. GET /api/vip-tiers is accessible to R3
    const getRes = await fetch(`${baseUrl}/api/vip-tiers`, {
      headers: { Authorization: `Bearer ${r3Token}` }
    });
    assert.equal(getRes.status, 200);
    const tiers = await getRes.json();
    assert.equal(Array.isArray(tiers), true);
    assert.equal(tiers.length, 17);
    const v14 = tiers.find(t => t.level === 14);
    assert.equal(v14.points, 750000);

    // 2. PUT /api/vip-tiers forbidden for R3 -> 403
    const putR3Res = await fetch(`${baseUrl}/api/vip-tiers`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${r3Token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tiers: [{ level: 14, points: 800000, dailyPuzzles: 4, dailyChests: 1 }]
      })
    });
    assert.equal(putR3Res.status, 403);

    // 3. PUT /api/vip-tiers allowed for R5 -> 200
    const putR5Res = await fetch(`${baseUrl}/api/vip-tiers`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tiers: [{ level: 14, points: 760000, dailyPuzzles: 4, dailyChests: 1 }]
      })
    });
    assert.equal(putR5Res.status, 200);
    const updatedTiers = await putR5Res.json();
    const updatedV14 = updatedTiers.find(t => t.level === 14);
    assert.equal(updatedV14.points, 760000);
    assert.equal(updatedV14.dailyPuzzles, 4);
  } finally {
    await server.close();
  }
});

test('API catalog CRUD and POST /api/catalog/batch for exchange shop import with RBAC', async () => {
  const { startServer } = require('./server.js');
  const server = await startServer({ port: 0, dbPath: ':memory:' });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const adminLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin123' })
    });
    const { token: adminToken } = await adminLoginRes.json();

    // Register R3 user
    const r3RegRes = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'cat_r3_user', password: 'password123' })
    });
    const r3Reg = await r3RegRes.json();
    await fetch(`${baseUrl}/api/users/${r3Reg.userId}/approve`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ rank: 'r3' })
    });
    const r3LoginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'cat_r3_user', password: 'password123' })
    });
    const { token: r3Token } = await r3LoginRes.json();

    // 1. R3 cannot create catalog item -> 403
    const r3PostRes = await fetch(`${baseUrl}/api/catalog`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${r3Token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'po', name: 'По' })
    });
    assert.equal(r3PostRes.status, 403);

    // 2. R5 creates catalog item with medals and starCouponCost
    const r5PostRes = await fetch(`${baseUrl}/api/catalog`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'officer-po',
        name: 'По',
        type: 'Танк',
        generation: 8,
        couponPerPuzzle: 720,
        starCouponCost: 360,
        medalsBeforeTraining: 480,
        medalsTraining: 900
      })
    });
    assert.equal(r5PostRes.status, 200);
    const createdOff = await r5PostRes.json();
    assert.equal(createdOff.name, 'По');
    assert.equal(createdOff.type, 'Танк');
    assert.equal(createdOff.couponPerPuzzle, 720);
    assert.equal(createdOff.starCouponCost, 360);
    assert.equal(createdOff.medalsBeforeTraining, 480);
    assert.equal(createdOff.medalsTraining, 900);
    assert.equal(createdOff.medalsTotal, 1380);

    // 3. Batch import via POST /api/catalog/batch
    const batchRes = await fetch(`${baseUrl}/api/catalog/batch`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        officers: [
          {
            id: 'officer-sara',
            name: 'Sara',
            type: 'Пехота',
            generation: 8,
            couponPerPuzzle: 720,
            starCouponCost: 360
          },
          {
            id: 'officer-royshin',
            name: 'Ройшин',
            type: 'ПТ-Сау',
            generation: 7,
            couponPerPuzzle: 600,
            starCouponCost: 300
          }
        ]
      })
    });
    assert.equal(batchRes.status, 200);
    const batchResult = await batchRes.json();
    assert.equal(batchResult.success, true);
    assert.equal(batchResult.count, 2);

    // Verify GET /api/catalog contains all officers
    const catList = await (await fetch(`${baseUrl}/api/catalog`, {
      headers: { Authorization: `Bearer ${r3Token}` }
    })).json();
    assert(catList.some(o => o.name === 'По'));
    assert(catList.some(o => o.name === 'Sara' && o.starCouponCost === 360));
    assert(catList.some(o => o.name === 'Ройшин' && o.starCouponCost === 300 && o.couponPerPuzzle === 600));
  } finally {
    await server.close();
  }
});

test('API schedule-season supports complex multi-event season and batch events array with RBAC', async () => {
  const { startServer } = require('./server.js');
  const server = await startServer({ port: 0, dbPath: ':memory:' });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const adminLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin123' })
    });
    const { token: adminToken } = await adminLoginRes.json();

    // 1. Пакетная отправка готового списка событий из UI предпросмотра
    const batchRes = await fetch(`${baseUrl}/api/events/schedule-season`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        events: [
          { typeName: 'Король Войны', dateFrom: '2026-11-03', dateTo: '2026-11-04', note: 'Неделя 1' },
          { typeName: 'Мощные Силы', dateFrom: '2026-11-07', dateTo: '2026-11-09', note: 'Неделя 1' },
          { typeName: 'Сила Времени', dateFrom: '2026-11-10', dateTo: '2026-11-12', note: 'Неделя 2' }
        ]
      })
    });
    assert.equal(batchRes.status, 201);
    const batchData = await batchRes.json();
    assert.equal(batchData.success, true);
    assert.equal(batchData.createdCount, 3);
    assert.equal(batchData.count, 3);
    assert.equal(batchData.events.length, 3);

    // 2. Проверка, что типы событий созданы с правильными цветами и наградами
    const etRes = await fetch(`${baseUrl}/api/event-types`);
    const eventTypes = await etRes.json();
    const mfType = eventTypes.find(t => t.name === 'Мощные Силы');
    const potType = eventTypes.find(t => t.name === 'Сила Времени');
    assert(mfType && potType);
    assert.equal(mfType.color, '#10b981');
    assert.equal(potType.color, '#f59e0b');
    assert.equal(mfType.places[0].coupons, 12500);

    // 3. Отправка правил расписания (startDate, totalWeeks, rules)
    const genRes = await fetch(`${baseUrl}/api/events/schedule-season`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        startDate: '2026-11-16',
        totalWeeks: 4,
        rules: [
          { id: 'king-of-war', name: 'Король Войны', startDayOfWeek: 2, durationDays: 2, activeWeeks: 1, breakWeeks: 1, weekOffset: 0 }
        ]
      })
    });
    assert.equal(genRes.status, 201);
    const genData = await genRes.json();
    assert.equal(genData.createdCount, 2);
  } finally {
    await server.close();
  }
});

test('API serves favicon assets and handles /api/auth/status for demo hint dismissal', async () => {
  const { startServer } = require('./server.js');
  const server = await startServer({ port: 0, dbPath: ':memory:' });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    // 1. Static serving of favicons
    const svgRes = await fetch(`${baseUrl}/favicon.svg`);
    assert.equal(svgRes.status, 200);
    assert.equal(svgRes.headers.get('content-type'), 'image/svg+xml');

    const icoRes = await fetch(`${baseUrl}/favicon.ico`);
    assert.equal(icoRes.status, 200);
    assert.equal(icoRes.headers.get('content-type'), 'image/x-icon');

    // 2. /api/auth/status initially has default admin password
    const statusRes1 = await fetch(`${baseUrl}/api/auth/status`);
    assert.equal(statusRes1.status, 200);
    const status1 = await statusRes1.json();
    assert.equal(status1.demoAccessEnabled, true);
    assert.equal(status1.hasDefaultAdminPassword, true);

    // 3. Admin logs in with default password
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin123' })
    });
    assert.equal(loginRes.status, 200);
    const loginData = await loginRes.json();

    // 4. Admin changes password
    const changePassRes = await fetch(`${baseUrl}/api/auth/change-password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${loginData.token}`
      },
      body: JSON.stringify({
        oldPassword: 'admin123',
        newPassword: 'SuperSecretAdminPassword2026!'
      })
    });
    assert.equal(changePassRes.status, 200);

    // 5. /api/auth/status now returns demoAccessEnabled = false
    const statusRes2 = await fetch(`${baseUrl}/api/auth/status`);
    assert.equal(statusRes2.status, 200);
    const status2 = await statusRes2.json();
    assert.equal(status2.demoAccessEnabled, false);
    assert.equal(status2.hasDefaultAdminPassword, false);
  } finally {
    await server.close();
  }
});

test('API handles S3 status and manual S3 sync endpoints with RBAC', async () => {
  const { startServer } = require('./server.js');

  // Start with mock S3 manager
  let pushCalled = false;
  const mockS3Manager = {
    getStatus: () => ({
      enabled: true,
      bucket: 'test-bucket',
      endpoint: 's3.timeweb.cloud',
      key: 'kow.db',
      lastSyncAt: '2026-10-27T12:00:00Z',
      isSyncing: false,
      lastError: null
    }),
    pull: async () => ({ found: true }),
    pushImmediate: async () => {
      pushCalled = true;
      return { success: true, bytes: 12345 };
    },
    pushDebounced: () => {}
  };

  const server = await startServer({ port: 0, dbPath: ':memory:', s3Manager: mockS3Manager });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    // 1. Unauthorized GET /api/admin/s3-status -> 401
    const unauthRes = await fetch(`${baseUrl}/api/admin/s3-status`);
    assert.equal(unauthRes.status, 401);

    // 2. Login as admin (r5)
    const adminLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin123' })
    });
    assert.equal(adminLoginRes.status, 200);
    const adminData = await adminLoginRes.json();
    const adminToken = adminData.token;

    // 3. Register and approve r3 user
    await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'r3user', password: 'password123' })
    });
    const usersRes = await fetch(`${baseUrl}/api/users`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert.equal(usersRes.status, 200);
    const users = await usersRes.json();
    assert(Array.isArray(users), 'Expected users to be an array');
    const r3Target = users.find(u => u.username === 'r3user');
    assert(r3Target, 'Target user r3user must be found');
    await fetch(`${baseUrl}/api/users/${r3Target.id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({ is_approved: 1, rank: 'r3' })
    });

    const r3LoginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'r3user', password: 'password123' })
    });
    const r3Token = (await r3LoginRes.json()).token;

    // 4. R3 forbidden for status and sync -> 403
    const r3StatusRes = await fetch(`${baseUrl}/api/admin/s3-status`, {
      headers: { Authorization: `Bearer ${r3Token}` }
    });
    assert.equal(r3StatusRes.status, 403);

    const r3SyncRes = await fetch(`${baseUrl}/api/admin/s3-sync`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${r3Token}` }
    });
    assert.equal(r3SyncRes.status, 403);

    // 5. Admin (r5) GET /api/admin/s3-status -> 200
    const adminStatusRes = await fetch(`${baseUrl}/api/admin/s3-status`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert.equal(adminStatusRes.status, 200);
    const statusData = await adminStatusRes.json();
    assert.equal(statusData.enabled, true);
    assert.equal(statusData.bucket, 'test-bucket');

    // 6. Admin (r5) POST /api/admin/s3-sync -> 200
    const syncRes = await fetch(`${baseUrl}/api/admin/s3-sync`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert.equal(syncRes.status, 200);
    const syncData = await syncRes.json();
    assert.equal(syncData.success, true);
    assert.equal(pushCalled, true);
  } finally {
    await server.close();
  }
});

test('API serves application version via GET /api/version', async () => {
  const { startServer } = require('./server.js');
  const server = await startServer({ port: 0, dbPath: ':memory:' });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const res = await fetch(`${baseUrl}/api/version`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(data.version);
    assert.match(data.version, /^\d+\.\d+\.\d+/);
  } finally {
    await server.close();
  }
});

test('API POST /api/event-types/bulk-rewards updates prizes across multiple event types and enforces R4/R5 RBAC', async () => {
  const { startServer } = require('./server.js');
  const server = await startServer({ port: 0, dbPath: ':memory:' });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    // 1. Unauthorized -> 401
    const unauth = await fetch(`${baseUrl}/api/event-types/bulk-rewards`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ typeIds: [1, 2], places: [] })
    });
    assert.equal(unauth.status, 401);

    // 2. Login as admin (r5)
    const adminLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin123' })
    });
    const adminToken = (await adminLoginRes.json()).token;

    // 3. Register and approve r3 user
    await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'bulkR3', password: 'password123' })
    });
    const usersRes = await fetch(`${baseUrl}/api/users`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    const users = await usersRes.json();
    const r3Target = users.find(u => u.username === 'bulkR3');
    await fetch(`${baseUrl}/api/users/${r3Target.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ is_approved: 1, rank: 'r3' })
    });
    const r3LoginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'bulkR3', password: 'password123' })
    });
    const r3Token = (await r3LoginRes.json()).token;

    // 4. R3 forbidden -> 403
    const r3Res = await fetch(`${baseUrl}/api/event-types/bulk-rewards`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${r3Token}` },
      body: JSON.stringify({ typeIds: [1, 2], places: [{ place: 1, label: '1 место', coupons: 15000 }] })
    });
    assert.equal(r3Res.status, 403);

    // 5. Validation error (empty typeIds) -> 400
    const badReq = await fetch(`${baseUrl}/api/event-types/bulk-rewards`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ typeIds: [], places: [{ place: 1, label: '1 место', coupons: 15000 }] })
    });
    assert.equal(badReq.status, 400);

    // 6. Admin updates event types 1 and 2
    const okRes = await fetch(`${baseUrl}/api/event-types/bulk-rewards`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({
        typeIds: [1, 2],
        places: [
          { place: 1, label: '🥇 1 место', coupons: 25000 },
          { place: 2, label: '🥈 2 место', coupons: 13000 }
        ]
      })
    });
    assert.equal(okRes.status, 200);
    const okData = await okRes.json();
    assert.equal(okData.ok, true);
    assert.equal(okData.updatedCount, 2);

    // 7. Verify via GET /api/event-types
    const getRes = await fetch(`${baseUrl}/api/event-types`);
    assert.equal(getRes.status, 200);
    const allTypes = await getRes.json();
    const t1 = allTypes.find(t => t.id === 1);
    const t2 = allTypes.find(t => t.id === 2);
    assert.ok(t1 && t2);
    assert.equal(t1.places.length, 2);
    assert.equal(t1.places[0].coupons, 25000);
    assert.equal(t2.places[1].coupons, 13000);
  } finally {
    await server.close();
  }
});

test('API event-types endpoints sanitize and store schedule cadence fields', async () => {
  const { startServer } = require('./server.js');
  const server = await startServer({ port: 0, dbPath: ':memory:' });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const adminLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin123' })
    });
    const adminToken = (await adminLoginRes.json()).token;

    // POST /api/event-types
    const postRes = await fetch(`${baseUrl}/api/event-types`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({
        name: 'Осада Базы',
        color: '#ef4444',
        isPeriodic: 1,
        startDayOfWeek: 6,
        endDayOfWeek: 1, // Сб-Пн
        activeWeeks: 2,
        breakWeeks: 1,
        weekOffset: 0,
        places: [{ place: 1, label: '1 место', coupons: 18000 }]
      })
    });
    assert.equal(postRes.status, 200);
    const created = await postRes.json();
    assert.ok(created.id);
    assert.equal(created.startDayOfWeek, 6);
    assert.equal(created.endDayOfWeek, 1);
    assert.equal(created.activeWeeks, 2);

    // PUT /api/event-types/:id
    const putRes = await fetch(`${baseUrl}/api/event-types/${created.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({
        name: 'Осада Базы (Обновлено)',
        color: '#dc2626',
        isPeriodic: 1,
        startDayOfWeek: 5,
        endDayOfWeek: 7,
        activeWeeks: 1,
        breakWeeks: 2,
        weekOffset: 1,
        places: [{ place: 1, label: '1 место', coupons: 19000 }]
      })
    });
    assert.equal(putRes.status, 200);
    const updated = await putRes.json();
    assert.equal(updated.name, 'Осада Базы (Обновлено)');
    assert.equal(updated.startDayOfWeek, 5);
    assert.equal(updated.endDayOfWeek, 7);
    assert.equal(updated.breakWeeks, 2);
  } finally {
    await server.close();
  }
});

test('API officer endpoints support and sanitize personalPuzzles for player officers', async () => {
  const { startServer } = require('./server.js');
  const server = await startServer({ port: 0, dbPath: ':memory:' });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const adminLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin123' })
    });
    const adminToken = (await adminLoginRes.json()).token;

    // 1. Add officer to player 1 with personalPuzzles
    const addOffRes = await fetch(`${baseUrl}/api/players/1/officers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({
        catalogId: 'admiral-nathon',
        name: 'Адмирал Нейтон',
        level: 50,
        coupons: 1000,
        stars: 3,
        personalPuzzles: 85
      })
    });
    assert.equal(addOffRes.status, 201);
    const addedOff = await addOffRes.json();
    assert.equal(addedOff.personalPuzzles, 85);

    // 2. Update officer with personalPuzzles
    const updateOffRes = await fetch(`${baseUrl}/api/players/1/officers/${addedOff.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({
        personalPuzzles: 120
      })
    });
    assert.equal(updateOffRes.status, 200);
    const updatedOff = await updateOffRes.json();
    assert.equal(updatedOff.personalPuzzles, 120);

    // 3. Test negative value sanitization to 0
    const negOffRes = await fetch(`${baseUrl}/api/players/1/officers/${addedOff.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({
        personalPuzzles: -25
      })
    });
    assert.equal(negOffRes.status, 200);
    const negOff = await negOffRes.json();
    assert.equal(negOff.personalPuzzles, 0);
  } finally {
    await server.close();
  }
});

test('API officer endpoints support onlyPersonalPuzzles setting', async () => {
  const { startServer } = require('./server.js');
  const server = await startServer({ port: 0, dbPath: ':memory:' });
  const baseUrl = `http://localhost:${server.address().port}`;

  try {
    const adminLogin = await (await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin123' })
    })).json();
    const adminToken = adminLogin.token;

    const createOffRes = await fetch(`${baseUrl}/api/players/1/officers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({
        catalogId: 'angel',
        name: 'Анхель',
        stars: 4,
        level: 102,
        personalPuzzles: 169,
        onlyPersonalPuzzles: true
      })
    });
    assert.equal(createOffRes.status, 201);
    const createdOff = await createOffRes.json();
    assert.equal(createdOff.onlyPersonalPuzzles, true);

    const updateOffRes = await fetch(`${baseUrl}/api/players/1/officers/${createdOff.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({
        onlyPersonalPuzzles: false
      })
    });
    assert.equal(updateOffRes.status, 200);
    const updatedOff = await updateOffRes.json();
    assert.equal(updatedOff.onlyPersonalPuzzles, false);
  } finally {
    await server.close();
  }
});

test('API delegated permissions: R3 view_sectors and zero-trust stock masking', async () => {
  const { startServer } = require('./server.js');
  const server = await startServer({ port: 0, dbPath: ':memory:' });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const adminLogin = await (await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin123' })
    })).json();

    // 1. Register soldier with sector and stock
    const soldierReg = await (await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'soldier_stock', password: 'pass', playerName: 'База Солдата' })
    })).json();
    await fetch(`${baseUrl}/api/users/${soldierReg.userId}/approve`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminLogin.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ rank: 'r3' })
    });
    const soldierLogin = await (await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'soldier_stock', password: 'pass' })
    })).json();
    // Update soldier stock
    await fetch(`${baseUrl}/api/my-profile`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${soldierLogin.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        stock: {
          coupons: 9500,
          puzzles: 85,
          chests: 12,
          starCoupons: 340,
          legendaryStars1: 2,
          legendaryStars2: 1,
          legendaryStars3: 0
        }
      })
    });

    // 2. Register analyst (R3)
    const analystReg = await (await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'analyst_r3', password: 'pass', playerName: 'Аналитик' })
    })).json();
    await fetch(`${baseUrl}/api/users/${analystReg.userId}/approve`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminLogin.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ rank: 'r3' })
    });
    const analystLogin = await (await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'analyst_r3', password: 'pass' })
    })).json();

    // Set analyst own stock
    await fetch(`${baseUrl}/api/my-profile`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${analystLogin.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        stock: { coupons: 1200, puzzles: 10, chests: 1 }
      })
    });

    // 3. Analyst without permissions gets 403 on GET /api/players
    const noPermRes = await fetch(`${baseUrl}/api/players`, {
      headers: { Authorization: `Bearer ${analystLogin.token}` }
    });
    assert.equal(noPermRes.status, 403);
    const noPermData = await noPermRes.json();
    assert.equal(noPermData.message, 'Требуется разрешение на просмотр секторов или матрицы');

    // 4. Admin delegates view_sectors to analyst
    const patchRes = await fetch(`${baseUrl}/api/users/${analystReg.userId}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${adminLogin.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ permissions: ['view_sectors'] })
    });
    assert.equal(patchRes.status, 200);

    // Verify /api/auth/me and /api/my-profile return permissions
    const meRes = await (await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${analystLogin.token}` }
    })).json();
    assert.deepEqual(meRes.user.permissions, ['view_sectors']);

    const myProfRes = await (await fetch(`${baseUrl}/api/my-profile`, {
      headers: { Authorization: `Bearer ${analystLogin.token}` }
    })).json();
    assert.deepEqual(myProfRes.user.permissions, ['view_sectors']);

    // 5. Analyst with view_sectors can access GET /api/players
    const playersRes = await fetch(`${baseUrl}/api/players`, {
      headers: { Authorization: `Bearer ${analystLogin.token}` }
    });
    assert.equal(playersRes.status, 200);
    const playersList = await playersRes.json();
    assert(playersList.length >= 2);

    // Soldier's stock MUST be masked (Zero Trust)
    const otherPlayer = playersList.find(p => p.userId === soldierReg.userId);
    assert(otherPlayer, 'Other player sector must be found in players list');
    assert.equal(otherPlayer.stock.masked, true);
    assert.equal(otherPlayer.stock.coupons, 0);
    assert.equal(otherPlayer.stock.puzzles, 0);
    assert.equal(otherPlayer.stock.chests, 0);
    assert.equal(otherPlayer.stock.starCoupons, 0);
    assert.equal(otherPlayer.stock.legendaryStars1, 0);
    assert.equal(otherPlayer.stock.legendaryStars2, 0);
    assert.equal(otherPlayer.stock.legendaryStars3, 0);

    // Analyst's own sector MUST NOT be masked
    const ownPlayer = playersList.find(p => p.userId === analystReg.userId);
    assert(ownPlayer, 'Analyst own sector must be found');
    assert.notEqual(ownPlayer.stock.masked, true);
    assert.equal(ownPlayer.stock.coupons, 1200);

    // 6. Admin now delegates view_stocks as well
    await fetch(`${baseUrl}/api/users/${analystReg.userId}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${adminLogin.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ permissions: ['view_sectors', 'view_stocks'] })
    });

    // Analyst now sees unmasked stock of other players
    const unmaskedPlayers = await (await fetch(`${baseUrl}/api/players`, {
      headers: { Authorization: `Bearer ${analystLogin.token}` }
    })).json();
    const otherUnmasked = unmaskedPlayers.find(p => p.userId === soldierReg.userId);
    assert.notEqual(otherUnmasked.stock.masked, true);
    assert.equal(otherUnmasked.stock.coupons, 9500);
    assert.equal(otherUnmasked.stock.starCoupons, 340);

    // 7. User with only view_matrix (without view_sectors or view_stocks) can call GET /api/players with masked stocks
    await fetch(`${baseUrl}/api/users/${analystReg.userId}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${adminLogin.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ permissions: ['view_matrix'] })
    });

    const matrixPlayersRes = await fetch(`${baseUrl}/api/players`, {
      headers: { Authorization: `Bearer ${analystLogin.token}` }
    });
    assert.equal(matrixPlayersRes.status, 200);
    const matrixPlayers = await matrixPlayersRes.json();
    assert(matrixPlayers.length >= 2);
    const matrixSoldier = matrixPlayers.find(p => p.userId === soldierReg.userId);
    assert(matrixSoldier, 'Soldier sector should be present');
    assert.equal(matrixSoldier.stock.masked, true);
    assert.equal(matrixSoldier.stock.coupons, 0);
    const matrixSelf = matrixPlayers.find(p => p.userId === analystReg.userId);
    assert.notEqual(matrixSelf.stock.masked, true);
    assert.equal(matrixSelf.stock.coupons, 1200);
  } finally {
    await server.close();
  }
});

test('API delegated permissions: checkSectorAccess and read-only GET /api/players/:id vs mutations', async () => {
  const { startServer } = require('./server.js');
  const server = await startServer({ port: 0, dbPath: ':memory:' });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const adminLogin = await (await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin123' })
    })).json();

    // Register target soldier with sector
    const soldierReg = await (await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'soldier_target', password: 'pass', playerName: 'База Цель' })
    })).json();
    await fetch(`${baseUrl}/api/users/${soldierReg.userId}/approve`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminLogin.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ rank: 'r3' })
    });
    const soldierLogin = await (await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'soldier_target', password: 'pass' })
    })).json();
    const soldierProfile = await (await fetch(`${baseUrl}/api/my-profile`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${soldierLogin.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ stock: { coupons: 7777 } })
    })).json();
    const targetPlayerId = soldierProfile.id;

    // Register viewer (R3) with view_sectors
    const viewerReg = await (await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'viewer_r3', password: 'pass', playerName: 'Зритель' })
    })).json();
    await fetch(`${baseUrl}/api/users/${viewerReg.userId}/approve`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminLogin.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ rank: 'r3' })
    });
    await fetch(`${baseUrl}/api/users/${viewerReg.userId}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${adminLogin.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ permissions: ['view_sectors'] })
    });
    const viewerLogin = await (await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'viewer_r3', password: 'pass' })
    })).json();

    // 1. GET /api/players/:id succeeds with masked stock for view_sectors without view_stocks
    const readRes = await fetch(`${baseUrl}/api/players/${targetPlayerId}`, {
      headers: { Authorization: `Bearer ${viewerLogin.token}` }
    });
    assert.equal(readRes.status, 200);
    const readPlayer = await readRes.json();
    assert.equal(readPlayer.name, 'База Цель');
    assert.equal(readPlayer.stock.masked, true);
    assert.equal(readPlayer.stock.coupons, 0);

    // 2. PUT /api/players/:id is strictly FORBIDDEN for non-owner without leader rank
    const putRes = await fetch(`${baseUrl}/api/players/${targetPlayerId}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${viewerLogin.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Хакерская База' })
    });
    assert.equal(putRes.status, 403);

    // 3. Sector officer mutation is strictly FORBIDDEN
    const postOffRes = await fetch(`${baseUrl}/api/players/${targetPlayerId}/officers`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${viewerLogin.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Хакерский офицер', level: 1 })
    });
    assert.equal(postOffRes.status, 403);

    // 4. Sector DELETE is strictly FORBIDDEN
    const delRes = await fetch(`${baseUrl}/api/players/${targetPlayerId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${viewerLogin.token}` }
    });
    assert.equal(delRes.status, 403);
  } finally {
    await server.close();
  }
});

test('API delegated permissions: manage_events allows event CRUD, schedule-season, autopick and registration inspection', async () => {
  const { startServer } = require('./server.js');
  const server = await startServer({ port: 0, dbPath: ':memory:' });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const adminLogin = await (await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin123' })
    })).json();

    // Register tactician (R3) with manage_events
    const tacticianReg = await (await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'tactician_r3', password: 'pass', playerName: 'Тактик' })
    })).json();
    await fetch(`${baseUrl}/api/users/${tacticianReg.userId}/approve`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminLogin.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ rank: 'r3' })
    });
    await fetch(`${baseUrl}/api/users/${tacticianReg.userId}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${adminLogin.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ permissions: ['manage_events'] })
    });
    const tacticianLogin = await (await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'tactician_r3', password: 'pass' })
    })).json();

    // Register regular soldier (R3, no permissions)
    const soldierReg = await (await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'regular_soldier', password: 'pass', playerName: 'Рядовой Боец' })
    })).json();
    await fetch(`${baseUrl}/api/users/${soldierReg.userId}/approve`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminLogin.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ rank: 'r3' })
    });
    const soldierLogin = await (await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'regular_soldier', password: 'pass' })
    })).json();

    // 1. Regular soldier cannot create event
    const badCreate = await fetch(`${baseUrl}/api/events`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${soldierLogin.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ dateFrom: '2026-11-01', dateTo: '2026-11-02', typeId: 1 })
    });
    assert.equal(badCreate.status, 403);

    // 2. Tactician CAN create event
    const createRes = await fetch(`${baseUrl}/api/events`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tacticianLogin.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ dateFrom: '2026-11-01', dateTo: '2026-11-02', typeId: 1, note: 'Тест тактика' })
    });
    assert.equal(createRes.status, 200);
    const createdEvent = await createRes.json();
    assert(createdEvent.id);

    // 3. Soldier registers for event
    await fetch(`${baseUrl}/api/events/${createdEvent.id}/register`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${soldierLogin.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ desiredPlace: 1 })
    });

    // 4. Soldier GET /api/events does NOT see all registrations
    const soldierEvents = await (await fetch(`${baseUrl}/api/events`, {
      headers: { Authorization: `Bearer ${soldierLogin.token}` }
    })).json();
    const evForSoldier = soldierEvents.find(e => e.id === createdEvent.id);
    assert.equal(evForSoldier.registrations, undefined);
    assert(evForSoldier.myRegistration);

    // 5. Tactician GET /api/events DOES see registrations
    const tacticianEvents = await (await fetch(`${baseUrl}/api/events`, {
      headers: { Authorization: `Bearer ${tacticianLogin.token}` }
    })).json();
    const evForTactician = tacticianEvents.find(e => e.id === createdEvent.id);
    assert(Array.isArray(evForTactician.registrations));
    assert(evForTactician.registrations.length >= 1);

    // 6. Tactician GET /api/events/:id also sees registrations
    const singleEvent = await (await fetch(`${baseUrl}/api/events/${createdEvent.id}`, {
      headers: { Authorization: `Bearer ${tacticianLogin.token}` }
    })).json();
    assert(Array.isArray(singleEvent.registrations));

    // 7. Tactician can PUT event
    const putRes = await fetch(`${baseUrl}/api/events/${createdEvent.id}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${tacticianLogin.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...createdEvent, note: 'Обновленная заметка тактика' })
    });
    assert.equal(putRes.status, 200);

    // 8. Tactician can schedule-season
    const schedRes = await fetch(`${baseUrl}/api/events/schedule-season`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tacticianLogin.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        startDate: '2026-11-09',
        cyclesCount: 1,
        presetId: 'king-of-war'
      })
    });
    assert.equal(schedRes.status, 201);

    // 9. Tactician can run autopick
    const autopickRes = await fetch(`${baseUrl}/api/events/${createdEvent.id}/autopick`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tacticianLogin.token}` }
    });
    assert.equal(autopickRes.status, 200);

    // 10. Tactician can DELETE event
    const delRes = await fetch(`${baseUrl}/api/events/${createdEvent.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${tacticianLogin.token}` }
    });
    assert.equal(delRes.status, 200);
  } finally {
    await server.close();
  }
});

test('API delegated permissions: approve_users allows pending approvals restricted to R3 only', async () => {
  const { startServer } = require('./server.js');
  const server = await startServer({ port: 0, dbPath: ':memory:' });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const adminLogin = await (await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin123' })
    })).json();

    // Register HR user (R3) with approve_users
    const hrReg = await (await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'hr_r3', password: 'pass', playerName: 'Кадровик' })
    })).json();
    await fetch(`${baseUrl}/api/users/${hrReg.userId}/approve`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminLogin.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ rank: 'r3' })
    });
    await fetch(`${baseUrl}/api/users/${hrReg.userId}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${adminLogin.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ permissions: ['approve_users'] })
    });
    const hrLogin = await (await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'hr_r3', password: 'pass' })
    })).json();

    // Register recruit 1
    const recruit1 = await (await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'recruit_one', password: 'pass', playerName: 'Новичок 1' })
    })).json();

    // 1. HR gets pending list
    const pendingRes = await fetch(`${baseUrl}/api/users/pending`, {
      headers: { Authorization: `Bearer ${hrLogin.token}` }
    });
    assert.equal(pendingRes.status, 200);
    const pendingList = await pendingRes.json();
    assert(pendingList.some(u => u.id === recruit1.userId));

    // 2. HR attempts to approve recruit into R4 -> 403 Forbidden!
    const badRankApprove = await fetch(`${baseUrl}/api/users/${recruit1.userId}/approve`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${hrLogin.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ rank: 'r4' })
    });
    assert.equal(badRankApprove.status, 403);
    const badRankData = await badRankApprove.json();
    assert.equal(badRankData.error, 'Только глава альянса (Р5) может назначать ранг выше Р3');

    // 3. HR approves recruit into R3 -> 200 OK
    const okApprove = await fetch(`${baseUrl}/api/users/${recruit1.userId}/approve`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${hrLogin.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ rank: 'r3' })
    });
    assert.equal(okApprove.status, 200);

    // Register recruit 2
    const recruit2 = await (await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'spammer_recruit', password: 'pass', playerName: 'Спамер' })
    })).json();

    // 4. HR rejects recruit 2 -> 200 OK
    const rejectRes = await fetch(`${baseUrl}/api/users/${recruit2.userId}/reject`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${hrLogin.token}` }
    });
    assert.equal(rejectRes.status, 200);
  } finally {
    await server.close();
  }
});

test('API delegated permissions: manage_catalog and R5-only permissions management', async () => {
  const { startServer } = require('./server.js');
  const server = await startServer({ port: 0, dbPath: ':memory:' });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const adminLogin = await (await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin123' })
    })).json();

    // Register quartermaster (R3) with manage_catalog
    const qmReg = await (await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'qm_r3', password: 'pass', playerName: 'Завгар' })
    })).json();
    await fetch(`${baseUrl}/api/users/${qmReg.userId}/approve`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminLogin.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ rank: 'r3' })
    });
    await fetch(`${baseUrl}/api/users/${qmReg.userId}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${adminLogin.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ permissions: ['manage_catalog'] })
    });
    const qmLogin = await (await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'qm_r3', password: 'pass' })
    })).json();

    // 1. Quartermaster creates catalog item
    const addCatRes = await fetch(`${baseUrl}/api/catalog`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${qmLogin.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'new_test_off',
        name: 'Новый Офицер',
        type: 'Танк',
        generation: 8
      })
    });
    assert.equal(addCatRes.status, 200);

    // Batch catalog
    const batchRes = await fetch(`${baseUrl}/api/catalog/batch`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${qmLogin.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify([{ name: 'Батч Офицер 1', type: 'Пехота' }])
    });
    assert.equal(batchRes.status, 200);

    // Update catalog item
    const putCatRes = await fetch(`${baseUrl}/api/catalog/new_test_off`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${qmLogin.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Новый Офицер Обновлен' })
    });
    assert.equal(putCatRes.status, 200);

    // Delete catalog item
    const delCatRes = await fetch(`${baseUrl}/api/catalog/new_test_off`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${qmLogin.token}` }
    });
    assert.equal(delCatRes.status, 200);

    // Event Types CRUD
    const addEtRes = await fetch(`${baseUrl}/api/event-types`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${qmLogin.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Турнир Гильдии', color: '#123456' })
    });
    assert.equal(addEtRes.status, 200);
    const createdEt = await addEtRes.json();

    const putEtRes = await fetch(`${baseUrl}/api/event-types/${createdEt.id}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${qmLogin.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Турнир Гильдии 2' })
    });
    assert.equal(putEtRes.status, 200);

    const bulkEtRes = await fetch(`${baseUrl}/api/event-types/bulk-rewards`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${qmLogin.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        typeIds: [createdEt.id],
        places: [{ place: 1, coupons: 15000 }]
      })
    });
    assert.equal(bulkEtRes.status, 200);

    const delEtRes = await fetch(`${baseUrl}/api/event-types/${createdEt.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${qmLogin.token}` }
    });
    assert.equal(delEtRes.status, 200);

    // VIP Tiers
    const vipRes = await fetch(`${baseUrl}/api/vip-tiers`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${qmLogin.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify([{ level: 1, points: 0, dailyCoupons: 10 }])
    });
    assert.equal(vipRes.status, 200);

    // 2. Quartermaster (R3) CANNOT PATCH users
    const badPatch = await fetch(`${baseUrl}/api/users/${qmReg.userId}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${qmLogin.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ permissions: [] })
    });
    assert.equal(badPatch.status, 403);
  } finally {
    await server.close();
  }
});

test('API GET /api/players/:id/stock-history enforces RBAC (R3 without permission is 403, owner or R4/R5 is 200)', async () => {
  const { startServer } = require('./server.js');
  const db = require('./db.js');
  const server = await startServer({ port: 0, dbPath: ':memory:' });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const adminLogin = await (await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin123' })
    })).json();

    // Register user 1: Sector Owner
    const regOwner = await (await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'owner_user', password: 'password123', playerName: 'Владелец Сектора' })
    })).json();
    assert(regOwner.userId, 'Must return userId');
    db.approveUser(regOwner.userId, 'r3');
    const ownerUser = db.findUserById(regOwner.userId);
    const targetPlayerId = ownerUser.player_id;

    const ownerLogin = await (await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'owner_user', password: 'password123' })
    })).json();

    // Register user 2: Stranger R3 (no permissions, no ownership of player 1)
    const regStranger = await (await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'stranger_user', password: 'password123', playerName: 'Чужой Игрок' })
    })).json();
    assert(regStranger.userId, 'Must return userId');
    db.approveUser(regStranger.userId, 'r3');
    const strangerLogin = await (await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'stranger_user', password: 'password123' })
    })).json();

    // 1. Unauthenticated -> 401
    const unauthRes = await fetch(`${baseUrl}/api/players/${targetPlayerId}/stock-history`);
    assert.equal(unauthRes.status, 401);

    // 2. Stranger R3 -> 403 Forbidden
    const strangerRes = await fetch(`${baseUrl}/api/players/${targetPlayerId}/stock-history`, {
      headers: { Authorization: `Bearer ${strangerLogin.token}` }
    });
    assert.equal(strangerRes.status, 403);

    // 3. Sector Owner R3 -> 200 OK
    const ownerRes = await fetch(`${baseUrl}/api/players/${targetPlayerId}/stock-history`, {
      headers: { Authorization: `Bearer ${ownerLogin.token}` }
    });
    assert.equal(ownerRes.status, 200);
    const ownerData = await ownerRes.json();
    assert(Array.isArray(ownerData.records));

    // 4. Admin R5 -> 200 OK
    const adminRes = await fetch(`${baseUrl}/api/players/${targetPlayerId}/stock-history`, {
      headers: { Authorization: `Bearer ${adminLogin.token}` }
    });
    assert.equal(adminRes.status, 200);
    const adminData = await adminRes.json();
    assert(Array.isArray(adminData.records));

    // 5. Grant stranger view_sectors permission -> 200 OK
    db.updateUser(regStranger.userId, { permissions: ['view_sectors'] });
    const delegatedRes = await fetch(`${baseUrl}/api/players/${targetPlayerId}/stock-history`, {
      headers: { Authorization: `Bearer ${strangerLogin.token}` }
    });
    assert.equal(delegatedRes.status, 200);
  } finally {
    await server.close();
  }
});

test('API POST /api/players/:id/stock-history uploads screenshot and creates audit history record', async () => {
  const { startServer } = require('./server.js');
  const db = require('./db.js');
  const server = await startServer({ port: 0, dbPath: ':memory:' });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const adminLogin = await (await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin123' })
    })).json();

    const player = db.getPlayers()[0];
    const initialCoupons = player.stock.coupons;

    const fakeImageBase64 = 'data:image/jpeg;base64,' + Buffer.from('fake-jpeg-screenshot-data').toString('base64');

    const postRes = await fetch(`${baseUrl}/api/players/${player.id}/stock-history`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${adminLogin.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        source: 'ocr_scan',
        snapshotBefore: player.stock,
        snapshotAfter: { ...player.stock, coupons: initialCoupons + 500 },
        screenshotBase64: fakeImageBase64
      })
    });

    assert.equal(postRes.status, 201);
    const record = await postRes.json();
    assert(record.id > 0);
    assert.equal(record.playerId, player.id);
    assert.equal(record.source, 'ocr_scan');
    assert.equal(record.diffSummary, '+500 куп.');
    assert(record.screenshotPath, 'Must have screenshotPath');

    // Verify screenshot file created on disk
    const diskPath = path.join(__dirname, 'data', 'screenshots', record.screenshotPath);
    assert.equal(fs.existsSync(diskPath), true, 'Screenshot file must exist on disk');

    // Clean up created file
    try {
      fs.unlinkSync(diskPath);
    } catch (_) {}
  } finally {
    await server.close();
  }
});

test('API GET /api/screenshots/:filename validates traversal, authenticates user, and checks sector permission', async () => {
  const { startServer } = require('./server.js');
  const db = require('./db.js');
  const server = await startServer({ port: 0, dbPath: ':memory:' });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const tempScreenshotsDir = path.join(__dirname, 'data', 'screenshots', '2026-11');
  fs.mkdirSync(tempScreenshotsDir, { recursive: true });
  const testFilename = `test_${Date.now()}_img.jpg`;
  const testFilePath = path.join(tempScreenshotsDir, testFilename);
  fs.writeFileSync(testFilePath, 'dummy-jpeg-content');

  try {
    const adminLogin = await (await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin123' })
    })).json();

    const player = db.getPlayers()[0];

    // Create history record linked to this screenshot
    db.recordStockHistory({
      playerId: player.id,
      userId: 1,
      source: 'ocr_scan',
      snapshotBefore: { coupons: 100 },
      snapshotAfter: { coupons: 200 },
      diffSummary: '+100 куп.',
      screenshotPath: `2026-11/${testFilename}`
    });

    // Register a stranger user without access to player 1
    const regStranger = await (await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'another_user', password: 'password123' })
    })).json();
    db.approveUser(regStranger.userId, 'r3');
    const strangerLogin = await (await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'another_user', password: 'password123' })
    })).json();

    // 1. Path traversal attempt with .. -> 400
    const traversalRes = await fetch(`${baseUrl}/api/screenshots/..%2fsecret.txt`, {
      headers: { Authorization: `Bearer ${adminLogin.token}` }
    });
    assert.equal(traversalRes.status, 400);

    // 2. Traversal attempt with slash -> 400
    const slashRes = await fetch(`${baseUrl}/api/screenshots/sub%2ffile.jpg`, {
      headers: { Authorization: `Bearer ${adminLogin.token}` }
    });
    assert.equal(slashRes.status, 400);

    // 3. Unauthenticated -> 401
    const unauthRes = await fetch(`${baseUrl}/api/screenshots/${testFilename}`);
    assert.equal(unauthRes.status, 401);

    // 4. Stranger R3 without sector access -> 403 Forbidden
    const strangerRes = await fetch(`${baseUrl}/api/screenshots/${testFilename}`, {
      headers: { Authorization: `Bearer ${strangerLogin.token}` }
    });
    assert.equal(strangerRes.status, 403);

    // 5. Admin R5 -> 200 OK with correct image content
    const adminRes = await fetch(`${baseUrl}/api/screenshots/${testFilename}`, {
      headers: { Authorization: `Bearer ${adminLogin.token}` }
    });
    assert.equal(adminRes.status, 200);
    assert(adminRes.headers.get('content-type').includes('image/jpeg'));
    const bodyText = await adminRes.text();
    assert.equal(bodyText, 'dummy-jpeg-content');
  } finally {
    try {
      fs.unlinkSync(testFilePath);
    } catch (_) {}
    await server.close();
  }
});

test('API Telegram Bot Settings & Bind Token Lifecycle (RBAC)', async () => {
  const { startServer } = require('./server.js');
  const server = await startServer({ port: 0, dbPath: ':memory:' });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const adminLogin = await (await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin123' })
    })).json();

    // Register a regular R3 user
    const r3Reg = await (await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'r3_tester', password: 'password123' })
    })).json();
    const db = require('./db.js');
    db.approveUser(r3Reg.userId, 'r3');
    const r3Login = await (await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'r3_tester', password: 'password123' })
    })).json();

    // 1. Initial settings for R5
    const initSettingsRes = await fetch(`${baseUrl}/api/telegram/settings`, {
      headers: { Authorization: `Bearer ${adminLogin.token}` }
    });
    assert.equal(initSettingsRes.status, 200);
    const initSettings = await initSettingsRes.json();
    assert.equal(initSettings.hasToken, false);
    assert.equal(initSettings.tokenMasked, null);

    // 2. R3 cannot read or update settings
    const r3ReadRes = await fetch(`${baseUrl}/api/telegram/settings`, {
      headers: { Authorization: `Bearer ${r3Login.token}` }
    });
    assert.equal(r3ReadRes.status, 403);

    const r3UpdateRes = await fetch(`${baseUrl}/api/telegram/settings`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${r3Login.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'fake:token' })
    });
    assert.equal(r3UpdateRes.status, 403);

    // 3. R5 updates settings (with @ prefix to ensure stripping)
    const updateRes = await fetch(`${baseUrl}/api/telegram/settings`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${adminLogin.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: '123456789:ABC_TEST_BOT_TOKEN_XYZ',
        staffChatId: '-1001987654321',
        botUsername: '@KoWTestBot'
      })
    });
    assert.equal(updateRes.status, 200);
    const updateData = await updateRes.json();
    assert.equal(updateData.success, true);
    assert.equal(updateData.hasToken, true);
    assert.equal(updateData.staffChatId, '-1001987654321');
    assert.equal(updateData.botUsername, 'KoWTestBot');

    // 4. Verify settings read back masked token
    const readBack = await (await fetch(`${baseUrl}/api/telegram/settings`, {
      headers: { Authorization: `Bearer ${adminLogin.token}` }
    })).json();
    assert.equal(readBack.hasToken, true);
    assert.ok(readBack.tokenMasked.includes('***'));
    assert.equal(readBack.staffChatId, '-1001987654321');
    assert.equal(readBack.botUsername, 'KoWTestBot');
    assert.ok(readBack.polling && typeof readBack.polling.running === 'boolean');

    // 5. User generates personal bind token
    const bindTokenRes = await fetch(`${baseUrl}/api/telegram/bind-token`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${r3Login.token}` }
    });
    assert.equal(bindTokenRes.status, 200);
    const bindTokenData = await bindTokenRes.json();
    assert.ok(bindTokenData.token);
    assert.ok(bindTokenData.expiresAt);
    assert.ok(bindTokenData.deepLink.startsWith('https://t.me/KoWTestBot?start=bind_'));

    // 6. Staff bind token generation (R5 only)
    const staffPinR3Res = await fetch(`${baseUrl}/api/telegram/staff-bind-token`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${r3Login.token}` }
    });
    assert.equal(staffPinR3Res.status, 403);

    const staffPinRes = await fetch(`${baseUrl}/api/telegram/staff-bind-token`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminLogin.token}` }
    });
    assert.equal(staffPinRes.status, 200);
    const staffPinData = await staffPinRes.json();
    assert.ok(staffPinData.pin.startsWith('KOW-STAFF-'));
    assert.ok(staffPinData.expiresAt);

    // 7. Unbind user telegram
    const unbindRes = await fetch(`${baseUrl}/api/telegram/bind`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${r3Login.token}` }
    });
    assert.equal(unbindRes.status, 200);
    const unbindData = await unbindRes.json();
    assert.equal(unbindData.success, true);
  } finally {
    await server.close();
  }
});

test('API Telegram Webhook: /start bind, /connect_staff, and inline callbacks', async () => {
  const { startServer } = require('./server.js');
  const telegram = require('./telegram.js');
  const db = require('./db.js');
  const server = await startServer({ port: 0, dbPath: ':memory:' });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const sentMessages = [];
  const editedMessages = [];
  const answeredCallbacks = [];

  telegram.setTelegramFetch(async (url, options) => {
    const payload = options.body ? JSON.parse(options.body) : {};
    if (url.includes('/sendMessage')) {
      sentMessages.push(payload);
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, result: { message_id: 100 + sentMessages.length, chat: { id: payload.chat_id } } })
      };
    }
    if (url.includes('/editMessageText')) {
      editedMessages.push(payload);
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, result: { message_id: payload.message_id, text: payload.text } })
      };
    }
    if (url.includes('/answerCallbackQuery')) {
      answeredCallbacks.push(payload);
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, result: true })
      };
    }
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  });

  try {
    db.setAppSetting('telegram_bot_token', 'mock_token');

    // 1. Test /start bind_<token>
    const regSoldier = db.registerUser({ username: 'soldier_hook', password: 'pass', playerName: 'Солдат' });
    db.approveUser(regSoldier.userId, 'r3');
    const validToken = 'bind_token_valid_123';
    db.createTelegramBindToken(regSoldier.userId, validToken, new Date(Date.now() + 600000).toISOString());

    const bindWebhookRes = await fetch(`${baseUrl}/api/telegram/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        update_id: 1,
        message: {
          chat: { id: 777888 },
          from: { id: 777888, username: 'soldier_tg_handle' },
          text: `/start bind_${validToken}`
        }
      })
    });
    assert.equal(bindWebhookRes.status, 200);

    // Verify confirmation message sent
    assert.ok(sentMessages.some(m => m.chat_id === 777888 && m.text.includes('успешно подключен')));
    // Verify user in DB bound
    const boundSoldier = db.findUserById(regSoldier.userId);
    assert.equal(boundSoldier.telegram_chat_id, 777888);
    assert.equal(boundSoldier.telegram_username, 'soldier_tg_handle');

    // 2. Test /start with expired or invalid token
    const invalidWebhookRes = await fetch(`${baseUrl}/api/telegram/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        update_id: 2,
        message: {
          chat: { id: 999111 },
          from: { id: 999111 },
          text: '/start bind_invalid_token'
        }
      })
    });
    assert.equal(invalidWebhookRes.status, 200);
    assert.ok(sentMessages.some(m => m.chat_id === 999111 && m.text.includes('истек')));

    // 3. Test /connect_staff <PIN>
    const staffPin = 'KOW-STAFF-7777';
    db.createStaffBindToken(staffPin, new Date(Date.now() + 600000).toISOString());

    const staffWebhookRes = await fetch(`${baseUrl}/api/telegram/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        update_id: 3,
        message: {
          chat: { id: -100888999 },
          from: { id: 555 },
          text: `/connect_staff ${staffPin}`
        }
      })
    });
    assert.equal(staffWebhookRes.status, 200);
    assert.ok(sentMessages.some(m => m.chat_id === -100888999 && m.text.includes('Чат штаба успешно подключен')));
    assert.equal(db.getAppSetting('telegram_staff_chat_id'), '-100888999');

    // 3b. Test /connect_staff@BotHandle <PIN> in group
    const staffPin2 = 'KOW-STAFF-8888';
    db.createStaffBindToken(staffPin2, new Date(Date.now() + 600000).toISOString());
    const staffWebhookRes2 = await fetch(`${baseUrl}/api/telegram/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        update_id: 11,
        message: {
          chat: { id: -100555666 },
          from: { id: 555 },
          text: `/connect_staff@KoWTestBot ${staffPin2}`
        }
      })
    });
    assert.equal(staffWebhookRes2.status, 200);
    assert.equal(db.getAppSetting('telegram_staff_chat_id'), '-100555666');

    // 3c. Test /ping command
    const pingWebhookRes = await fetch(`${baseUrl}/api/telegram/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        update_id: 12,
        message: {
          chat: { id: 777888, type: 'private' },
          from: { id: 777888 },
          text: '/ping'
        }
      })
    });
    assert.equal(pingWebhookRes.status, 200);
    assert.ok(sentMessages.some(m => m.chat_id === 777888 && m.text.includes('KoW Tracker Bot онлайн')));

    // 3d. Test /start without token (help/welcome)
    const helpWebhookRes = await fetch(`${baseUrl}/api/telegram/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        update_id: 13,
        message: {
          chat: { id: 777888, type: 'private' },
          from: { id: 777888 },
          text: '/start'
        }
      })
    });
    assert.equal(helpWebhookRes.status, 200);
    assert.ok(sentMessages.some(m => m.chat_id === 777888 && m.text.includes('официальный Telegram-бот')));

    // 4. Test callback queries: approve_user and reject_user
    // Register pending rookie
    const recruit = db.registerUser({ username: 'rookie_soldier', password: 'pass', playerName: 'Новобранец' });
    assert.equal(recruit.is_approved, 0);

    // A) Unauthorized attempt to approve (stranger telegram ID 444333)
    const unauthCbRes = await fetch(`${baseUrl}/api/telegram/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        update_id: 4,
        callback_query: {
          id: 'cb_query_unauth',
          from: { id: 444333, username: 'random_user' },
          message: { chat: { id: -100888999 }, message_id: 42 },
          data: `approve_user:${recruit.userId}`
        }
      })
    });
    assert.equal(unauthCbRes.status, 200);
    assert.ok(answeredCallbacks.some(c => c.callback_query_id === 'cb_query_unauth' && c.show_alert === true && c.text.includes('Доступ запрещен')));
    assert.equal(db.findUserById(recruit.userId).is_approved, 0);

    // B) Authorized officer approval
    // Bind admin user (R5) to Telegram ID 10001
    const adminUser = db.findUserByUsername('admin');
    db.bindUserTelegram(adminUser.id, 10001, 'general_admin');

    const authCbRes = await fetch(`${baseUrl}/api/telegram/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        update_id: 5,
        callback_query: {
          id: 'cb_query_auth',
          from: { id: 10001, username: 'general_admin' },
          message: { chat: { id: -100888999 }, message_id: 42 },
          data: `approve_user:${recruit.userId}`
        }
      })
    });
    assert.equal(authCbRes.status, 200);
    assert.ok(answeredCallbacks.some(c => c.callback_query_id === 'cb_query_auth' && c.text.includes('одобрен')));
    assert.ok(editedMessages.some(m => m.chat_id === -100888999 && m.message_id === 42 && m.text.includes('одобрен офицером')));
    assert.equal(db.findUserById(recruit.userId).is_approved, 1);
  } finally {
    telegram.setTelegramFetch(null);
    await server.close();
  }
});

test('Telegram Webhook handles /stock text commands and photo screenshots with audit history', async () => {
  const { startServer } = require('./server.js');
  const telegram = require('./telegram.js');
  const db = require('./db.js');
  const server = await startServer({ port: 0, dbPath: ':memory:' });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  db.setAppSetting('telegram_bot_token', 'test_bot_token_123');

  const soldier = db.registerUser({ username: 'vault_soldier', password: 'password', playerName: 'База Сталкер' });
  db.approveUser(soldier.userId, 'r3');
  db.bindUserTelegram(soldier.userId, 888777, 'vault_soldier_tg');
  const boundUser = db.findUserById(soldier.userId);
  const player = db.getPlayerById(boundUser.player_id);

  const sentMessages = [];
  telegram.setTelegramFetch(async (url, options) => {
    if (url.includes('/sendMessage')) {
      const payload = JSON.parse(options.body);
      sentMessages.push(payload);
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, result: { message_id: 101, chat: { id: payload.chat_id } } })
      };
    }
    if (url.includes('/getFile')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, result: { file_id: 'photo_high_res', file_path: 'photos/warehouse_shot.jpg', file_size: 50000 } })
      };
    }
    if (url.includes('/file/bottest_bot_token_123/photos/warehouse_shot.jpg')) {
      return {
        ok: true,
        status: 200,
        arrayBuffer: async () => Buffer.from('fake_image_bytes_for_screenshot')
      };
    }
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  });

  try {
    // 1. /stock 12500 300 text command from bound soldier
    const stockRes = await fetch(`${baseUrl}/api/telegram/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        update_id: 100,
        message: {
          chat: { id: 888777, type: 'private' },
          from: { id: 888777, username: 'vault_soldier_tg' },
          text: '/stock 12500 300'
        }
      })
    });
    assert.equal(stockRes.status, 200);
    const updatedPlayer = db.getPlayerById(player.id);
    assert.equal(updatedPlayer.stock.coupons, 12500);
    assert.equal(updatedPlayer.stock.puzzles, 300);
    assert.equal(updatedPlayer.stockUpdateSource, 'telegram_command');

    const history = db.getStockHistory(player.id, 5);
    assert.ok(history.length >= 1);
    assert.equal(history[0].source, 'telegram_command');
    assert.ok(sentMessages.some(m => m.chat_id === 888777 && m.text.includes('Склад успешно обновлен') && m.text.includes('12 500')));

    // 2. Photo upload with caption /stock 18000 450
    sentMessages.length = 0;
    const photoRes = await fetch(`${baseUrl}/api/telegram/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        update_id: 101,
        message: {
          chat: { id: 888777, type: 'private' },
          from: { id: 888777, username: 'vault_soldier_tg' },
          caption: '/stock 18000 450',
          photo: [
            { file_id: 'thumb_id', file_size: 500 },
            { file_id: 'photo_high_res', file_size: 50000 }
          ]
        }
      })
    });
    assert.equal(photoRes.status, 200);
    const updatedPlayer2 = db.getPlayerById(player.id);
    assert.equal(updatedPlayer2.stock.coupons, 18000);
    assert.equal(updatedPlayer2.stock.puzzles, 450);
    assert.equal(updatedPlayer2.stockUpdateSource, 'telegram_photo');

    const history2 = db.getStockHistory(player.id, 5);
    assert.equal(history2[0].source, 'telegram_photo');
    assert.ok(history2[0].screenshotPath);
    assert.ok(sentMessages.some(m => m.chat_id === 888777 && m.text.includes('Склад успешно обновлен') && m.text.includes('18 000')));

    // 3. Photo upload without caption
    sentMessages.length = 0;
    const photoNoCaptionRes = await fetch(`${baseUrl}/api/telegram/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        update_id: 102,
        message: {
          chat: { id: 888777, type: 'private' },
          from: { id: 888777, username: 'vault_soldier_tg' },
          photo: [
            { file_id: 'photo_high_res', file_size: 50000 }
          ]
        }
      })
    });
    assert.equal(photoNoCaptionRes.status, 200);
    assert.ok(sentMessages.some(m => m.chat_id === 888777 && m.text.includes('Скриншот склада получен')));

    // 4. Unbound user sends /stock 5000
    sentMessages.length = 0;
    const unboundRes = await fetch(`${baseUrl}/api/telegram/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        update_id: 103,
        message: {
          chat: { id: 111222, type: 'private' },
          from: { id: 111222 },
          text: '/stock 5000'
        }
      })
    });
    assert.equal(unboundRes.status, 200);
    assert.ok(sentMessages.some(m => m.chat_id === 111222 && m.text.includes('не привязан к аккаунту')));
  } finally {
    telegram.setTelegramFetch(null);
    await server.close();
  }
});

test('API Notification Templates CRUD, reset, and test send', async () => {
  const { startServer } = require('./server.js');
  const telegram = require('./telegram.js');
  const db = require('./db.js');
  const server = await startServer({ port: 0, dbPath: ':memory:' });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const sentMessages = [];
  telegram.setTelegramFetch(async (url, options) => {
    const payload = options.body ? JSON.parse(options.body) : {};
    if (url.includes('/sendMessage')) {
      sentMessages.push(payload);
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, result: { message_id: 501, chat: { id: payload.chat_id } } })
      };
    }
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  });

  try {
    const adminLogin = await (await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin123' })
    })).json();

    // 1. GET /api/notification-templates (10 default templates)
    const listRes = await fetch(`${baseUrl}/api/notification-templates`, {
      headers: { Authorization: `Bearer ${adminLogin.token}` }
    });
    assert.equal(listRes.status, 200);
    const templates = await listRes.json();
    assert.equal(templates.length, 10);

    // 2. PUT /api/notification-templates/:key
    const putRes = await fetch(`${baseUrl}/api/notification-templates/event_place_assigned`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${adminLogin.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        template: '🎯 Место #{place} для {sectorName}',
        parseMode: 'HTML'
      })
    });
    assert.equal(putRes.status, 200);
    const putData = await putRes.json();
    assert.equal(putData.template.template, '🎯 Место #{place} для {sectorName}');

    // 3. Test send for personal template
    // Admin has no telegram linked yet -> 400
    db.setAppSetting('telegram_bot_token', 'mock_token');
    const testNoTgRes = await fetch(`${baseUrl}/api/notification-templates/event_place_assigned/test`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminLogin.token}` }
    });
    assert.equal(testNoTgRes.status, 400);

    // Bind admin's telegram
    const adminUser = db.findUserByUsername('admin');
    db.bindUserTelegram(adminUser.id, 999888, 'admin_tg');

    // Now test send succeeds
    const testSendRes = await fetch(`${baseUrl}/api/notification-templates/event_place_assigned/test`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminLogin.token}` }
    });
    assert.equal(testSendRes.status, 200);
    const testSendData = await testSendRes.json();
    assert.equal(testSendData.success, true);
    assert.ok(sentMessages.some(m => m.chat_id === 999888 && m.text.includes('🎯 Место #1')));

    // 4. Test send for staff template
    db.setAppSetting('telegram_staff_chat_id', '-100333222');
    const testStaffRes = await fetch(`${baseUrl}/api/notification-templates/staff_new_user_pending/test`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminLogin.token}` }
    });
    assert.equal(testStaffRes.status, 200);
    assert.ok(sentMessages.some(m => String(m.chat_id) === '-100333222' && m.text.includes('Новый боец')));

    // 5. POST /api/notification-templates/:key/reset
    const resetRes = await fetch(`${baseUrl}/api/notification-templates/event_place_assigned/reset`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminLogin.token}` }
    });
    assert.equal(resetRes.status, 200);
    const resetData = await resetRes.json();
    assert.equal(resetData.template.template, resetData.template.default_template);
  } finally {
    telegram.setTelegramFetch(null);
    await server.close();
  }
});

test('API Notification Triggers: new user registration alerts staff chat with inline buttons', async () => {
  const { startServer } = require('./server.js');
  const telegram = require('./telegram.js');
  const db = require('./db.js');
  const server = await startServer({ port: 0, dbPath: ':memory:' });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const sentMessages = [];
  telegram.setTelegramFetch(async (url, options) => {
    const payload = options.body ? JSON.parse(options.body) : {};
    if (url.includes('/sendMessage')) {
      sentMessages.push(payload);
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, result: { message_id: 101 } })
      };
    }
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  });

  try {
    db.setAppSetting('telegram_bot_token', 'mock_token_123');
    db.setAppSetting('telegram_staff_chat_id', '-100999888777');

    // Register a new pending user with sector info
    const regRes = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'new_recruit_42',
        password: 'secure_password_123',
        playerName: 'Sector 42 (Alpha)'
      })
    });
    assert.equal(regRes.status, 200);
    const regData = await regRes.json();
    assert.equal(regData.success, true);
    assert.equal(regData.pendingApproval, true);

    // Verify telegram message sent to staff chat
    assert.equal(sentMessages.length, 1);
    const msg = sentMessages[0];
    assert.equal(msg.chat_id, -100999888777);
    assert.ok(msg.text.includes('new_recruit_42'));
    assert.ok(msg.text.includes('Sector 42 (Alpha)'));
    assert.ok(msg.reply_markup);
    assert.ok(Array.isArray(msg.reply_markup.inline_keyboard));
    const buttons = msg.reply_markup.inline_keyboard[0];
    assert.equal(buttons.length, 2);
    assert.ok(buttons[0].text.includes('Одобрить (Р3)'));
    assert.equal(buttons[0].callback_data, `approve_user:${regData.userId}`);
    assert.ok(buttons[1].text.includes('Отклонить'));
    assert.equal(buttons[1].callback_data, `reject_user:${regData.userId}`);
  } finally {
    telegram.setTelegramFetch(null);
    await server.close();
  }
});

test('API Notification Triggers: event creation broadcasts registration opened', async () => {
  const { startServer } = require('./server.js');
  const telegram = require('./telegram.js');
  const db = require('./db.js');
  const server = await startServer({ port: 0, dbPath: ':memory:' });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const sentMessages = [];
  telegram.setTelegramFetch(async (url, options) => {
    const payload = options.body ? JSON.parse(options.body) : {};
    if (url.includes('/sendMessage')) {
      sentMessages.push(payload);
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, result: { message_id: 102 } })
      };
    }
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  });

  try {
    db.setAppSetting('telegram_bot_token', 'mock_token_123');

    // 1. Setup 2 users with telegram: one with notifications enabled, one disabled
    const u1 = db.registerUser({ username: 'player_one', password: 'password', playerName: 'Sector 1' });
    db.approveUser(u1.userId, 'r3');
    db.bindUserTelegram(u1.userId, 111001, 'player_one_tg');

    const u2 = db.registerUser({ username: 'player_two', password: 'password', playerName: 'Sector 2' });
    db.approveUser(u2.userId, 'r3');
    db.bindUserTelegram(u2.userId, 222002, 'player_two_tg');
    db.toggleTelegramNotifications(u2.userId, false);

    // Also admin user with telegram enabled
    const admin = db.findUserByUsername('admin');
    db.bindUserTelegram(admin.id, 999009, 'admin_tg');

    // Login as admin
    const adminLogin = await (await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin123' })
    })).json();

    const eventTypes = db.getEventTypes();
    const et = eventTypes[0];

    // Create an event
    const createRes = await fetch(`${baseUrl}/api/events`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${adminLogin.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        typeId: et.id,
        dateFrom: '2026-11-20',
        dateTo: '2026-11-22',
        note: 'Season Championship'
      })
    });
    assert.equal(createRes.status, 200);

    // Assert broadcast was sent to player_one and admin, but NOT player_two (disabled)
    assert.equal(sentMessages.length, 2);
    const chatIds = sentMessages.map(m => m.chat_id);
    assert.ok(chatIds.includes(111001));
    assert.ok(chatIds.includes(999009));
    assert.ok(!chatIds.includes(222002));

    const broadcastMsg = sentMessages.find(m => m.chat_id === 111001);
    assert.ok(broadcastMsg.text.includes(et.name));
    assert.ok(broadcastMsg.text.includes('2026-11-20'));
    assert.ok(broadcastMsg.text.includes('Подайте заявку'));

    // Send immediate duplicate creation request with identical params (simulating rapid double click)
    const duplicateRes = await fetch(`${baseUrl}/api/events`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${adminLogin.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        typeId: et.id,
        dateFrom: '2026-11-20',
        dateTo: '2026-11-22',
        note: 'Season Championship'
      })
    });
    assert.equal(duplicateRes.status, 200);
    const createdEvent = await createRes.json();
    const dupeEvent = await duplicateRes.json();
    assert.equal(dupeEvent.id, createdEvent.id, 'Duplicate request must return existing event ID');

    // Assert NO additional messages were sent (still exactly 2 messages)
    assert.equal(sentMessages.length, 2, 'Duplicate event creation must not send duplicate notifications');

    // Assert only 1 event exists in database with this date
    const allEvents = db.getEvents();
    const matching = allEvents.filter(e => e.typeId === et.id && e.dateFrom === '2026-11-20');
    assert.equal(matching.length, 1, 'Only one event record must exist in DB');
  } finally {
    telegram.setTelegramFetch(null);
    await server.close();
  }
});

test('API Notification Triggers: event place assignment and autopick summary', async () => {
  const { startServer } = require('./server.js');
  const telegram = require('./telegram.js');
  const db = require('./db.js');
  const server = await startServer({ port: 0, dbPath: ':memory:' });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const sentMessages = [];
  telegram.setTelegramFetch(async (url, options) => {
    const payload = options.body ? JSON.parse(options.body) : {};
    if (url.includes('/sendMessage')) {
      sentMessages.push(payload);
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, result: { message_id: 103 } })
      };
    }
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  });

  try {
    db.setAppSetting('telegram_bot_token', 'mock_token_123');
    db.setAppSetting('telegram_staff_chat_id', '-100555666');

    // Setup player with user account and telegram
    const regRes = db.registerUser({ username: 'champion_user', password: 'password', playerName: 'Sector Victor' });
    db.approveUser(regRes.userId, 'r3');
    db.bindUserTelegram(regRes.userId, 777007, 'champion_tg');

    const adminLogin = await (await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin123' })
    })).json();

    const eventTypes = db.getEventTypes();
    const et = eventTypes[0];

    // 1. Test manual place assignment via PUT /api/events/:id
    const ev = db.saveEvent({
      typeId: et.id,
      dateFrom: '2026-12-01',
      dateTo: '2026-12-03',
      assignments: []
    });

    sentMessages.length = 0; // Clear messages

    const putRes = await fetch(`${baseUrl}/api/events/${ev.id}`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${adminLogin.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        ...ev,
        assignments: [
          { place: 1, playerId: regRes.playerId, coupons: 12500 }
        ]
      })
    });
    assert.equal(putRes.status, 200);

    // Verify personal notification sent to sector owner
    assert.equal(sentMessages.length, 1);
    const personalMsg = sentMessages[0];
    assert.equal(personalMsg.chat_id, 777007);
    assert.ok(personalMsg.text.includes('#1'));
    assert.ok(personalMsg.text.includes('Sector Victor'));
    assert.ok(personalMsg.text.includes('12500'));

    // 2. Test auto-pick triggers
    // Register candidate for an event with officer deficit
    const ev2 = db.saveEvent({
      typeId: et.id,
      dateFrom: '2026-12-10',
      dateTo: '2026-12-12',
      assignments: []
    });

    const catalog = db.getCatalog();
    const po = db.addPlayerOfficer(regRes.playerId, {
      catalogId: catalog[0].id,
      name: catalog[0].name,
      level: 0,
      coupons: 0
    });

    db.registerForEvent({
      eventId: ev2.id,
      playerId: regRes.playerId,
      desiredPlace: 1,
      officerId: po.id
    });

    sentMessages.length = 0;

    // 1. Dry-run autopick: must NOT send notifications and must NOT mutate db event
    const autopickRes = await fetch(`${baseUrl}/api/events/${ev2.id}/autopick`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminLogin.token}` }
    });
    assert.equal(autopickRes.status, 200);
    const autopickData = await autopickRes.json();
    assert.ok(autopickData.success);
    assert.ok(Array.isArray(autopickData.assignments));
    assert.equal(sentMessages.length, 0, 'Autopick preview must NOT send notifications');
    const evBeforeSave = db.getEventById(ev2.id);
    assert.equal(evBeforeSave.assignments.length, 0, 'Autopick preview must NOT mutate event assignments in db');

    // 2. Submit saveEvent with the autopick assignments
    const saveRes = await fetch(`${baseUrl}/api/events`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminLogin.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: ev2.id,
        typeId: ev2.typeId,
        dateFrom: ev2.dateFrom,
        dateTo: ev2.dateTo,
        assignments: autopickData.assignments
      })
    });
    assert.equal(saveRes.status, 200);

    // Should now send personal notification to assigned player + summary to staff chat
    assert.ok(sentMessages.length >= 2, 'saveEvent with assignments must dispatch notifications');
    const personalAutopick = sentMessages.find(m => m.chat_id === 777007);
    assert.ok(personalAutopick);
    assert.ok(personalAutopick.text.includes('Sector Victor'));

    const staffSummary = sentMessages.find(m => m.chat_id === -100555666);
    assert.ok(staffSummary);
    assert.ok(staffSummary.text.includes('Автоподбор успешно завершен'));
    assert.ok(staffSummary.text.includes(et.name));
  } finally {
    telegram.setTelegramFetch(null);
    await server.close();
  }
});

test('API Notification Triggers: stale stock reminders and staff summary', async () => {
  const { startServer } = require('./server.js');
  const telegram = require('./telegram.js');
  const db = require('./db.js');
  const server = await startServer({ port: 0, dbPath: ':memory:' });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const sentMessages = [];
  telegram.setTelegramFetch(async (url, options) => {
    const payload = options.body ? JSON.parse(options.body) : {};
    if (url.includes('/sendMessage')) {
      sentMessages.push(payload);
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, result: { message_id: 104 } })
      };
    }
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  });

  try {
    db.setAppSetting('telegram_bot_token', 'mock_token_123');
    db.setAppSetting('telegram_staff_chat_id', '-100444333');

    // 1. Create stale player (> 14 days ago) with user and telegram
    const staleReg = db.registerUser({ username: 'stale_commander', password: 'password', playerName: 'Sector Stale' });
    db.approveUser(staleReg.userId, 'r3');
    db.bindUserTelegram(staleReg.userId, 888111, 'stale_tg');
    const eighteenDaysAgo = new Date(Date.now() - 18 * 24 * 60 * 60 * 1000).toISOString();
    db.updatePlayer(staleReg.playerId, { stockUpdatedAt: eighteenDaysAgo });

    // 2. Create fresh player (today) with user and telegram
    const freshReg = db.registerUser({ username: 'fresh_commander', password: 'password', playerName: 'Sector Fresh' });
    db.approveUser(freshReg.userId, 'r3');
    db.bindUserTelegram(freshReg.userId, 888222, 'fresh_tg');
    db.updatePlayer(freshReg.playerId, { stockUpdatedAt: new Date().toISOString() });

    // Login accounts
    const adminLogin = await (await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin123' })
    })).json();

    const r3Login = await (await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'stale_commander', password: 'password' })
    })).json();

    // R3 is forbidden
    const r3CheckRes = await fetch(`${baseUrl}/api/telegram/check-reminders`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${r3Login.token}` }
    });
    assert.equal(r3CheckRes.status, 403);

    // R5 executes check-reminders
    const checkRes = await fetch(`${baseUrl}/api/telegram/check-reminders`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminLogin.token}` }
    });
    assert.equal(checkRes.status, 200);
    const checkData = await checkRes.json();
    assert.equal(checkData.success, true);
    assert.ok(checkData.staleCount >= 1);
    assert.ok(checkData.personalRemindersSent >= 1);
    assert.equal(checkData.staffAlertSent, true);

    // Verify personal reminder was sent to stale user (888111) but NOT fresh user (888222)
    const personalReminder = sentMessages.find(m => m.chat_id === 888111);
    assert.ok(personalReminder);
    assert.ok(personalReminder.text.includes('Sector Stale'));
    assert.ok(personalReminder.text.includes('18 дн.'));

    assert.ok(!sentMessages.some(m => m.chat_id === 888222));

    // Verify staff summary sent to staff chat
    const staffAlert = sentMessages.find(m => m.chat_id === -100444333);
    assert.ok(staffAlert);
    assert.ok(staffAlert.text.includes('актуальность складов'));
    assert.ok(staffAlert.text.includes('Устарели (>14 дн.)'));
  } finally {
    telegram.setTelegramFetch(null);
    await server.close();
  }
});

test('API Telegram Stale Alert Schedule CRUD & Smart Silence / Cooldown Triggers', async () => {
  const { startServer, checkStaleStockReminders } = require('./server.js');
  const telegram = require('./telegram.js');
  const db = require('./db.js');
  const server = await startServer({ port: 0, dbPath: ':memory:' });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const sentMessages = [];
  telegram.setTelegramFetch(async (url, options) => {
    const payload = options.body ? JSON.parse(options.body) : {};
    if (url.includes('/sendMessage')) {
      sentMessages.push(payload);
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, result: { message_id: 205 } })
      };
    }
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  });

  try {
    db.setAppSetting('telegram_bot_token', 'mock_token_schedule');
    db.setAppSetting('telegram_staff_chat_id', '-100999888');

    const adminLogin = await (await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin123' })
    })).json();

    const r3Reg = db.registerUser({ username: 'member_r3', password: 'password', playerName: 'Sector R3' });
    db.approveUser(r3Reg.userId, 'r3');
    const r3Login = await (await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'member_r3', password: 'password' })
    })).json();

    // 1. GET /api/telegram/schedule defaults
    const getRes = await fetch(`${baseUrl}/api/telegram/schedule`, {
      headers: { Authorization: `Bearer ${adminLogin.token}` }
    });
    assert.strictEqual(getRes.status, 200);
    const getData = await getRes.json();
    assert.strictEqual(getData.success, true);
    assert.strictEqual(getData.schedule.frequency, 'weekly');
    assert.strictEqual(getData.schedule.time, '10:00');
    assert.strictEqual(getData.schedule.smartSilence, true);
    assert.strictEqual(getData.schedule.personalCooldownDays, 7);
    assert.ok(getData.nextRun !== undefined);

    // 2. PUT /api/telegram/schedule RBAC: R3 gets 403
    const putR3Res = await fetch(`${baseUrl}/api/telegram/schedule`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${r3Login.token}`
      },
      body: JSON.stringify({ frequency: 'semiweekly' })
    });
    assert.strictEqual(putR3Res.status, 403);

    // 3. PUT /api/telegram/schedule as R5: updates successfully
    const putAdminRes = await fetch(`${baseUrl}/api/telegram/schedule`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminLogin.token}`
      },
      body: JSON.stringify({
        frequency: 'semiweekly',
        time: '14:00',
        smartSilence: true,
        personalCooldownDays: 7
      })
    });
    assert.strictEqual(putAdminRes.status, 200);
    const putData = await putAdminRes.json();
    assert.strictEqual(putData.success, true);
    assert.strictEqual(putData.schedule.frequency, 'semiweekly');
    assert.strictEqual(putData.schedule.time, '14:00');

    // 3b. PUT /api/telegram/schedule with clientTimezoneOffset (e.g. UTC+5 Yekaterinburg sets 15:00 local -> should become 13:00 MSK)
    const putTzRes = await fetch(`${baseUrl}/api/telegram/schedule`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminLogin.token}`
      },
      body: JSON.stringify({
        time: '15:00',
        clientTimezoneOffset: 5
      })
    });
    assert.strictEqual(putTzRes.status, 200);
    const putTzData = await putTzRes.json();
    assert.strictEqual(putTzData.schedule.time, '13:00', '15:00 at UTC+5 must be converted to 13:00 MSK (UTC+3)');

    // 4. Test Smart Silence: when staleCount === 0 and isScheduled === true -> no message in staff chat
    for (const player of db.getPlayers()) {
      db.updatePlayer(player.id, { stockUpdatedAt: new Date().toISOString() });
    }
    sentMessages.length = 0;

    const scheduledSilenceResult = await checkStaleStockReminders(null, { isScheduled: true });
    assert.strictEqual(scheduledSilenceResult.staleCount, 0);
    assert.strictEqual(scheduledSilenceResult.staffAlertSent, false, 'Scheduled run with smart silence must skip staff alert');
    assert.strictEqual(sentMessages.length, 0, 'No Telegram messages should be sent');

    // But manual check sends status even if staleCount === 0
    const manualCheckRes = await fetch(`${baseUrl}/api/telegram/check-reminders`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminLogin.token}` }
    });
    assert.strictEqual(manualCheckRes.status, 200);
    const manualData = await manualCheckRes.json();
    assert.strictEqual(manualData.staffAlertSent, true, 'Manual check must send summary to staff chat');
    assert.ok(sentMessages.some(m => m.chat_id === -100999888));

    // 5. Test Personal Cooldown: player gets reminder, but second run within 7 days skips them
    db.bindUserTelegram(r3Reg.userId, 777666, 'tg_r3_user');
    const fifteenDaysAgo = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString();
    db.updatePlayer(r3Reg.playerId, { stockUpdatedAt: fifteenDaysAgo, last_stock_reminder_sent_at: null });

    sentMessages.length = 0;
    const run1 = await checkStaleStockReminders(null, { isScheduled: true });
    assert.ok(run1.staleCount >= 1);
    assert.strictEqual(run1.personalRemindersSent, 1, 'First reminder must be sent');
    assert.ok(sentMessages.some(m => m.chat_id === 777666));

    // Immediately run again: cooldown (7 days) should suppress personal reminder
    sentMessages.length = 0;
    const run2 = await checkStaleStockReminders(null, { isScheduled: true });
    assert.strictEqual(run2.personalRemindersSent, 0, 'Personal reminder must be suppressed by 7-day cooldown');
    // Staff alert is sent because staleCount >= 1, but NO personal reminder to 777666
    assert.strictEqual(run2.staffAlertSent, true);
    assert.ok(sentMessages.some(m => m.chat_id === -100999888));
    assert.ok(!sentMessages.some(m => m.chat_id === 777666), 'User must not receive repeated reminder');
  } finally {
    telegram.setTelegramFetch(null);
    await server.close();
  }
});

test('API Mieru Tunnel Settings, RBAC & Connection Test', async () => {
  const { startServer } = require('./server.js');
  const server = await startServer({ port: 0, dbPath: ':memory:' });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    const adminLogin = await (await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin123' })
    })).json();

    const r3Reg = await (await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'r3_mieru_tester', password: 'password123' })
    })).json();
    const db = require('./db.js');
    db.approveUser(r3Reg.userId, 'r3');
    const r3Login = await (await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'r3_mieru_tester', password: 'password123' })
    })).json();

    // 1. Initial settings for R5
    const initRes = await fetch(`${baseUrl}/api/mieru/settings`, {
      headers: { Authorization: `Bearer ${adminLogin.token}` }
    });
    assert.equal(initRes.status, 200);
    const initData = await initRes.json();
    assert.equal(initData.enabled, false);
    assert.equal(initData.socks5Port, 1080);

    // 2. R3 is forbidden
    const r3Get = await fetch(`${baseUrl}/api/mieru/settings`, {
      headers: { Authorization: `Bearer ${r3Login.token}` }
    });
    assert.equal(r3Get.status, 403);

    const r3Put = await fetch(`${baseUrl}/api/mieru/settings`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${r3Login.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true })
    });
    assert.equal(r3Put.status, 403);

    // 3. R5 updates settings
    const putRes = await fetch(`${baseUrl}/api/mieru/settings`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${adminLogin.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        enabled: true,
        server: '194.87.100.200',
        portRange: '10000-10050',
        user: 'mieru_user',
        password: 'secret_mieru_password_123',
        transport: 'TCP',
        socks5Port: 1080
      })
    });
    assert.equal(putRes.status, 200);
    const putData = await putRes.json();
    assert.equal(putData.success, true);
    assert.equal(putData.enabled, true);
    assert.equal(putData.server, '194.87.100.200');
    assert.equal(putData.user, 'mieru_user');
    assert.ok(putData.passwordMasked.includes('***'));

    // 4. Test connection endpoint
    const testRes = await fetch(`${baseUrl}/api/mieru/test`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminLogin.token}` }
    });
    assert.equal(testRes.status, 200);
    const testData = await testRes.json();
    assert.ok(typeof testData.ok === 'boolean');
  } finally {
    await server.close();
  }
});

test('API Player Cabinet /api/my-profile preserves user telegram fields and supports retro officer operations', async () => {
  const { startServer } = require('./server.js');
  const db = require('./db.js');
  const server = await startServer({ port: 0, dbPath: ':memory:' });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    // 1. Create a user and approve
    const reg = db.registerUser({ username: 'retro_commander', password: 'password', playerName: 'Sector Retro' });
    db.approveUser(reg.userId, 'r3');

    // 2. Bind telegram
    db.bindUserTelegram(reg.userId, 12345678, 'retro_tg');

    // 3. Login
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'retro_commander', password: 'password' })
    });
    assert.equal(loginRes.status, 200);
    const loginData = await loginRes.json();
    const token = loginData.token;

    // 4. GET /api/my-profile
    const profileRes = await fetch(`${baseUrl}/api/my-profile`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    assert.equal(profileRes.status, 200);
    const profileData = await profileRes.json();

    assert.ok(profileData.user, 'Profile must have user object');
    assert.equal(profileData.user.telegram_chat_id, 12345678);
    assert.equal(profileData.user.telegramChatId, 12345678);
    assert.equal(profileData.user.telegram_username, 'retro_tg');
    assert.equal(profileData.user.telegramUsername, 'retro_tg');

    // 5. Add officer to my-profile
    const initialStock = profileData.stock || {};
    const addOffRes = await fetch(`${baseUrl}/api/my-profile/officers`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        catalogId: 'off-gen7-1',
        name: 'Офицер VII',
        level: 50,
        stars: 3,
        skills: [3, 3, 3, 3]
      })
    });
    assert.equal(addOffRes.status, 200);

    // Verify stock was not changed by officer creation alone (retro by default)
    const afterProfileRes = await fetch(`${baseUrl}/api/my-profile`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const afterProfileData = await afterProfileRes.json();
    assert.equal(afterProfileData.stock.coupons, initialStock.coupons);
    assert.equal(afterProfileData.stock.puzzles, initialStock.puzzles);
    assert.equal(afterProfileData.stock.starCoupons, initialStock.starCoupons);
  } finally {
    await server.close();
  }
});

test('API User Management: blocking, deletion, and registration sector linking (RBAC)', async () => {
  const { startServer } = require('./server.js');
  const server = await startServer({ port: 0, dbPath: ':memory:' });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    // 1. Login as admin (R5)
    const adminLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin123' })
    });
    const { token: adminToken } = await adminLoginRes.json();

    // 2. Register user with new sector
    const regRes = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'test_recruit',
        password: 'password123',
        playerName: 'База Рекрута'
      })
    });
    assert.equal(regRes.status, 200);
    const regData = await regRes.json();
    assert.ok(regData.userId);

    // 3. Approve user as R3
    const approveRes = await fetch(`${baseUrl}/api/users/${regData.userId}/approve`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ rank: 'r3' })
    });
    assert.equal(approveRes.status, 200);

    // 4. Recruit logs in and gets their profile
    const recruitLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'test_recruit', password: 'password123' })
    });
    assert.equal(recruitLoginRes.status, 200);
    const { token: recruitToken } = await recruitLoginRes.json();

    const recruitProfRes = await fetch(`${baseUrl}/api/my-profile`, {
      headers: { Authorization: `Bearer ${recruitToken}` }
    });
    assert.equal(recruitProfRes.status, 200);
    const recruitProfile = await recruitProfRes.json();
    assert.equal(recruitProfile.name, 'База Рекрута');
    assert.ok(Array.isArray(recruitProfile.officers));

    // 5. Non-R5 user cannot block or delete
    const forbiddenBlock = await fetch(`${baseUrl}/api/users/${regData.userId}/block`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${recruitToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ blocked: true })
    });
    assert.equal(forbiddenBlock.status, 403);

    const forbiddenDelete = await fetch(`${baseUrl}/api/users/${regData.userId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${recruitToken}` }
    });
    assert.equal(forbiddenDelete.status, 403);

    // 6. Admin cannot self-block or self-delete
    const selfBlock = await fetch(`${baseUrl}/api/users/1/block`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ blocked: true })
    });
    assert.equal(selfBlock.status, 400);

    const selfDelete = await fetch(`${baseUrl}/api/users/1`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert.equal(selfDelete.status, 400);

    // 7. Admin blocks user
    const blockRes = await fetch(`${baseUrl}/api/users/${regData.userId}/block`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ blocked: true })
    });
    assert.equal(blockRes.status, 200);
    const blockData = await blockRes.json();
    assert.equal(blockData.user.is_blocked, 1);

    // Blocked user's active session is rejected
    const blockedProfRes = await fetch(`${baseUrl}/api/my-profile`, {
      headers: { Authorization: `Bearer ${recruitToken}` }
    });
    assert.equal(blockedProfRes.status, 401);

    // Blocked user login rejected with 403 ACCOUNT_BLOCKED
    const blockedLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'test_recruit', password: 'password123' })
    });
    assert.equal(blockedLoginRes.status, 403);
    const blockedLoginData = await blockedLoginRes.json();
    assert.equal(blockedLoginData.error, 'ACCOUNT_BLOCKED');

    // 8. Admin unblocks user
    const unblockRes = await fetch(`${baseUrl}/api/users/${regData.userId}/block`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ blocked: false })
    });
    assert.equal(unblockRes.status, 200);

    const reLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'test_recruit', password: 'password123' })
    });
    assert.equal(reLoginRes.status, 200);

    // 9. Admin deletes user, keeping sector in guild
    const delRes = await fetch(`${baseUrl}/api/users/${regData.userId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert.equal(delRes.status, 200);

    // User is gone
    const checkDeleted = await fetch(`${baseUrl}/api/users`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    const allUsers = await checkDeleted.json();
    assert.ok(!allUsers.some(u => u.id === regData.userId));

    // Sector still exists with userId = null
    const checkSectors = await fetch(`${baseUrl}/api/players`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    const allSectors = await checkSectors.json();
    const keptSector = allSectors.find(s => s.name === 'База Рекрута');
    assert.ok(keptSector, 'Kept sector must exist in guild players');
    assert.equal(keptSector.userId, null, 'Kept sector must be unassigned');
  } finally {
    await server.close();
  }
});

test('API User Management: resolves character name for sector owners in GET /api/users', async () => {
  const { startServer } = require('./server.js');
  const db = require('./db.js');
  const server = await startServer({ port: 0, dbPath: ':memory:' });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    // 1. Admin login
    const adminLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin123' })
    });
    const { token: adminToken } = await adminLoginRes.json();

    // 2. Register user without sector initially
    const regRes = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'commander_tanya', password: 'password123', playerName: '' })
    });
    const regData = await regRes.json();
    const userId = regData.userId;

    // Approve user
    db.approveUser(userId, 'r4');

    // 3. Create a sector and assign userId
    const createSectorRes = await fetch(`${baseUrl}/api/players`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: 'Tanya ПВ',
        rank: 'r4',
        userId: userId
      })
    });
    assert.equal(createSectorRes.status, 200);
    const sectorData = await createSectorRes.json();
    assert.equal(sectorData.userId, userId);

    // 4. GET /api/users must return playerName = 'Tanya ПВ' and playerId = sectorData.id
    const usersRes = await fetch(`${baseUrl}/api/users`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert.equal(usersRes.status, 200);
    const usersList = await usersRes.json();
    const tanyaUser = usersList.find(u => u.id === userId);
    assert.ok(tanyaUser, 'User must exist in /api/users');
    assert.equal(tanyaUser.playerName, 'Tanya ПВ', 'Character name must be resolved in /api/users');
    assert.equal(tanyaUser.playerId, sectorData.id, 'playerId must match sector id in /api/users');
  } finally {
    await server.close();
  }
});

test('Event registrations visibility for R3 member in GET /api/events and GET /api/events/:id', async () => {
  const { startServer } = require('./server.js');
  const db = require('./db.js');
  const server = await startServer({ port: 0, dbPath: ':memory:' });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    // 1. Admin login
    const adminLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin123' })
    });
    const { token: adminToken } = await adminLoginRes.json();

    // 2. Create an event
    const eventRes = await fetch(`${baseUrl}/api/events`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        typeId: 1,
        dateFrom: '2026-11-10',
        dateTo: '2026-11-12',
        note: 'Test Event Visibility',
        assignments: []
      })
    });
    const createdEvent = await eventRes.json();
    assert.ok(createdEvent.id);

    // 3. Register R3 user and create sector
    const regRes = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'member_r3', password: 'password123' })
    });
    const regData = await regRes.json();
    db.approveUser(regData.userId, 'r3');

    const sectorRes = await fetch(`${baseUrl}/api/players`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Сектор Рядового',
        rank: 'r3',
        userId: regData.userId
      })
    });
    const sector = await sectorRes.json();

    // 4. Login as R3 member
    const memberLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'member_r3', password: 'password123' })
    });
    const { token: memberToken } = await memberLoginRes.json();

    // 5. Member registers for event
    const submitRegRes = await fetch(`${baseUrl}/api/events/${createdEvent.id}/register`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${memberToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sectorId: sector.id,
        desiredPlace: 2
      })
    });
    assert.equal(submitRegRes.status, 200);

    // 6. Member fetches GET /api/events - myRegistrations must contain playerName
    const eventsRes = await fetch(`${baseUrl}/api/events`, {
      headers: { Authorization: `Bearer ${memberToken}` }
    });
    assert.equal(eventsRes.status, 200);
    const eventsList = await eventsRes.json();
    const targetEv = eventsList.find(e => e.id === createdEvent.id);
    assert.ok(targetEv, 'Event must exist in list');
    assert.ok(Array.isArray(targetEv.myRegistrations), 'myRegistrations array must be present for member');
    assert.equal(targetEv.myRegistrations.length, 1);
    assert.equal(targetEv.myRegistrations[0].playerName, 'Сектор Рядового');

    // 7. Member fetches GET /api/events/:id - myRegistrations must contain playerName
    const eventDetailRes = await fetch(`${baseUrl}/api/events/${createdEvent.id}`, {
      headers: { Authorization: `Bearer ${memberToken}` }
    });
    assert.equal(eventDetailRes.status, 200);
    const detailData = await eventDetailRes.json();
    assert.ok(Array.isArray(detailData.myRegistrations), 'myRegistrations array must be present in event detail');
    assert.equal(detailData.myRegistrations.length, 1);
    assert.equal(detailData.myRegistrations[0].playerName, 'Сектор Рядового');

    // 8. Admin fetches GET /api/events/:id - registrations must contain all registrations with playerName
    const adminDetailRes = await fetch(`${baseUrl}/api/events/${createdEvent.id}`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert.equal(adminDetailRes.status, 200);
    const adminDetailData = await adminDetailRes.json();
    assert.ok(Array.isArray(adminDetailData.registrations), 'registrations must be present for admin');
    assert.equal(adminDetailData.registrations.length, 1);
    assert.equal(adminDetailData.registrations[0].playerName, 'Сектор Рядового');
  } finally {
    await server.close();
  }
});

test('API rejects event registration for officer with onlyPersonalPuzzles and GET /api/users returns isOnline', async () => {
  const { startServer } = require('./server.js');
  const db = require('./db.js');
  const server = await startServer({ port: 0, dbPath: ':memory:' });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    // 1. Admin login
    const adminLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin123' })
    });
    const { token: adminToken } = await adminLoginRes.json();

    // 2. Create an event
    const eventRes = await fetch(`${baseUrl}/api/events`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        typeId: 1,
        dateFrom: '2026-11-10',
        dateTo: '2026-11-12',
        assignments: []
      })
    });
    const event = await eventRes.json();

    // 3. Register user and create player with an officer having onlyPersonalPuzzles: true
    const regRes = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'puzzle_user', password: 'password123' })
    });
    const { userId } = await regRes.json();
    db.approveUser(userId, 'r3');

    const sectorRes = await fetch(`${baseUrl}/api/players`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'База Пазлы',
        rank: 'r3',
        userId
      })
    });
    const sector = await sectorRes.json();

    // Add officer with onlyPersonalPuzzles
    const addOffRes = await fetch(`${baseUrl}/api/players/${sector.id}/officers`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        catalogId: 'alex',
        level: 100,
        onlyPersonalPuzzles: true
      })
    });
    const newOfficer = await addOffRes.json();

    // 4. User logs in
    const userLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'puzzle_user', password: 'password123' })
    });
    const { token: userToken } = await userLoginRes.json();

    // 5. Try registering the officer with onlyPersonalPuzzles -> must be rejected with 400
    const submitRegRes = await fetch(`${baseUrl}/api/events/${event.id}/register`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${userToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sectorId: sector.id,
        officerId: newOfficer.id,
        desiredPlace: 1
      })
    });
    assert.equal(submitRegRes.status, 400);
    const regError = await submitRegRes.json();
    assert.equal(regError.error, 'OFFICER_ONLY_PERSONAL_PUZZLES');

    // 6. Admin checks GET /api/users: user should have isOnline: true
    const usersRes = await fetch(`${baseUrl}/api/users`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert.equal(usersRes.status, 200);
    const users = await usersRes.json();
    const puzzleUser = users.find(u => u.username === 'puzzle_user');
    assert.ok(puzzleUser);
    assert.equal(puzzleUser.isOnline, true);
  } finally {
    await server.close();
  }
});

test('Dynamic API endpoints return strict anti-caching headers (Cache-Control: no-store, no-cache, Pragma: no-cache, Expires: 0)', async () => {
  const { startServer } = require('./server.js');
  const server = await startServer({ port: 0, dbPath: ':memory:' });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin123' })
    });
    assert.equal(loginRes.status, 200);
    const { token } = await loginRes.json();

    // 1. Check GET /api/users
    const usersRes = await fetch(`${baseUrl}/api/users`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    assert.equal(usersRes.status, 200);
    const ccUsers = usersRes.headers.get('cache-control');
    assert.ok(ccUsers, 'cache-control header must be present');
    assert.ok(ccUsers.includes('no-store'), 'cache-control must contain no-store');
    assert.ok(ccUsers.includes('no-cache'), 'cache-control must contain no-cache');
    assert.ok(ccUsers.includes('must-revalidate'), 'cache-control must contain must-revalidate');
    assert.equal(usersRes.headers.get('pragma'), 'no-cache');
    assert.equal(usersRes.headers.get('expires'), '0');

    // 2. Check GET /api/events
    const eventsRes = await fetch(`${baseUrl}/api/events`);
    assert.equal(eventsRes.status, 200);
    const ccEvents = eventsRes.headers.get('cache-control');
    assert.ok(ccEvents && ccEvents.includes('no-store'));

    // 3. Check PATCH /api/users/:id and immediate GET /api/users reflection
    // First, register a regular user
    const regRes = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'perm_tester', password: 'testpassword123' })
    });
    assert.equal(regRes.status, 200);
    const regData = await regRes.json();
    const targetUserId = regData.userId;

    // Approve the user
    await fetch(`${baseUrl}/api/users/${targetUserId}/approve`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ rank: 'r3' })
    });

    // Update permissions via PATCH
    const patchRes = await fetch(`${baseUrl}/api/users/${targetUserId}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ permissions: ['view_sectors', 'view_stocks', 'manage_events'] })
    });
    assert.equal(patchRes.status, 200);
    const ccPatch = patchRes.headers.get('cache-control');
    assert.ok(ccPatch && ccPatch.includes('no-store'));

    // Fetch /api/users immediately -> must have the new permissions
    const refreshedUsersRes = await fetch(`${baseUrl}/api/users`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    assert.equal(refreshedUsersRes.status, 200);
    const allUsers = await refreshedUsersRes.json();
    const updatedUser = allUsers.find(u => u.id === targetUserId);
    assert.ok(updatedUser, 'User must exist');
    assert.deepEqual(updatedUser.permissions, ['view_sectors', 'view_stocks', 'manage_events']);
  } finally {
    await server.close();
  }
});

test('API Event RSVP, Post-Event Results submission, and stock rewards accrual', async () => {
  const { startServer } = require('./server.js');
  const telegram = require('./telegram.js');
  const server = await startServer({ port: 0, dbPath: ':memory:' });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const sentMessages = [];
  telegram.setTelegramFetch(async (url, options = {}) => {
    const payload = JSON.parse(options.body || '{}');
    sentMessages.push({ url, payload });
    if (url.includes('/sendMessage')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, result: { message_id: 1001, chat: { id: payload.chat_id }, text: payload.text } })
      };
    }
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  });

  try {
    const adminLogin = await (await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin123' })
    })).json();

    const db = require('./db.js');
    db.setAppSetting('telegram_bot_token', 'test_token');
    db.setAppSetting('telegram_staff_chat_id', '-100999999');

    // Create soldier user
    const soldierLogin = await (await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'rsvp_hero',
        password: 'pass',
        playerName: 'RSVP Hero Sector'
      })
    })).json();

    const soldierUser = db.findUserByUsername('rsvp_hero');
    db.approveUser(soldierUser.id, 'r3');
    db.bindUserTelegram(soldierUser.id, 777111, 'rsvp_hero_tg');

    const soldierAuth = await (await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'rsvp_hero', password: 'pass' })
    })).json();
    assert.ok(soldierAuth.token, 'Soldier auth token should be present');

    // Create an event
    const eventType = db.getEventTypes()[0];
    const eventRes = await fetch(`${baseUrl}/api/events`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminLogin.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        typeId: eventType.id,
        dateFrom: '2026-12-01',
        dateTo: '2026-12-07',
        assignments: [
          { place: 1, playerId: soldierUser.player_id, officerId: 'o1' }
        ]
      })
    });
    assert.equal(eventRes.status, 200);
    const createdEvent = await eventRes.json();
    assert.ok(createdEvent.id);

    // Verify event_place_assigned notification was sent with inline keyboard
    const placeAssignedMsg = sentMessages.find(m => m.url.includes('/sendMessage') && m.payload.chat_id === 777111 && m.payload.reply_markup?.inline_keyboard);
    assert.ok(placeAssignedMsg, 'Telegram notification with inline keyboard should be sent to user');

    // 1. Test Web RSVP: POST /api/events/:id/rsvp
    const rsvpRes = await fetch(`${baseUrl}/api/events/${createdEvent.id}/rsvp`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${soldierAuth.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ place: 1, status: 'confirmed' })
    });
    assert.equal(rsvpRes.status, 200);
    const rsvpData = await rsvpRes.json();
    assert.equal(rsvpData.event.assignments[0].rsvpStatus, 'confirmed');

    // 2. Test Telegram Callback RSVP: decline
    const webhookRes = await fetch(`${baseUrl}/api/telegram/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        callback_query: {
          id: 'cq_rsvp_1',
          from: { id: 777111, username: 'rsvp_hero_tg' },
          message: { message_id: 1001, chat: { id: 777111 }, text: 'Назначено место #1' },
          data: `rsvp_event:decline:${createdEvent.id}:1`
        }
      })
    });
    assert.equal(webhookRes.status, 200);
    const updatedEv = db.getEventById(createdEvent.id);
    assert.equal(updatedEv.assignments[0].rsvpStatus, 'declined');

    // Verify staff chat alert was sent about decline
    const staffDeclineAlert = sentMessages.find(m => m.payload.chat_id === -100999999 && m.payload.text?.includes('Отказ от участия'));
    assert.ok(staffDeclineAlert, 'Staff chat should be alerted about decline');

    // 3. Test Results Submission via Web: POST /api/events/:id/submit-result
    const initialPlayer = db.getPlayerById(soldierUser.player_id);
    const initialCoupons = Number(initialPlayer.stock.coupons) || 0;

    const resultRes = await fetch(`${baseUrl}/api/events/${createdEvent.id}/submit-result`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${soldierAuth.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ place: 1, actualPlace: 1 })
    });
    assert.equal(resultRes.status, 200);
    const resultData = await resultRes.json();
    assert.equal(resultData.event.assignments[0].resultStatus, 'confirmed');
    assert.equal(resultData.event.assignments[0].accrued, true);
    assert.ok(resultData.accruedCoupons > 0, 'Prize coupons should be greater than 0');

    // Verify player stock was updated
    const afterPlayer = db.getPlayerById(soldierUser.player_id);
    assert.equal(afterPlayer.stock.coupons, initialCoupons + resultData.accruedCoupons);

    // Verify stock_history_records has source 'event_reward'
    const history = db.getStockHistory(soldierUser.player_id);
    assert.ok(history.some(h => h.source === 'event_reward' && h.diffSummary.includes('Награда за событие')));

    // 4. Test Finish Event Prompt & Summary endpoints
    const finishRes = await fetch(`${baseUrl}/api/events/${createdEvent.id}/finish`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminLogin.token}` }
    });
    assert.equal(finishRes.status, 200);

    const summaryRes = await fetch(`${baseUrl}/api/events/${createdEvent.id}/summary`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminLogin.token}` }
    });
    assert.equal(summaryRes.status, 200);
    const summaryData = await summaryRes.json();
    assert.equal(summaryData.confirmedCount, 1);

    // Verify staff summary link points directly to #event/:id
    const staffSummaryMsg = sentMessages.find(m => m.payload.chat_id === -100999999 && m.payload.text?.includes('Итоги события'));
    assert.ok(staffSummaryMsg, 'Staff summary message should be dispatched');
    assert.ok(staffSummaryMsg.payload.text?.includes(`#event/${createdEvent.id}`), 'Staff summary must link directly to #event/:id');

    // 5. Test Result Correction: POST /api/events/:id/submit-result with updated place
    const beforeCorrectionCoupons = db.getPlayerById(soldierUser.player_id).stock.coupons;
    const correctionRes = await fetch(`${baseUrl}/api/events/${createdEvent.id}/submit-result`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${soldierAuth.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ place: 1, actualPlace: 2 })
    });
    assert.equal(correctionRes.status, 200);
    const correctionData = await correctionRes.json();
    assert.equal(correctionData.event.assignments[0].actualPlace, 2);

    const afterCorrectionCoupons = db.getPlayerById(soldierUser.player_id).stock.coupons;
    const et = db.getEventTypes().find(t => t.id === createdEvent.typeId);
    const place1Coupons = et.places.find(p => p.place === 1)?.coupons || 0;
    const place2Coupons = et.places.find(p => p.place === 2)?.coupons || 0;
    assert.equal(afterCorrectionCoupons, beforeCorrectionCoupons + (place2Coupons - place1Coupons));
  } finally {
    telegram.setTelegramFetch(null);
    await server.close();
  }
});

test('Player timezone management and 09:00 AM local morning event briefings', async () => {
  const { startServer, checkScheduledEventMorningReminders } = require('./server.js');
  const telegram = require('./telegram.js');
  const db = require('./db.js');
  const server = await startServer({ port: 0, dbPath: ':memory:' });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  db.setAppSetting('telegram_bot_token', 'test_morning_token_999');

  const sentMessages = [];
  telegram.setTelegramFetch(async (url, options) => {
    if (url.includes('/sendMessage')) {
      const payload = JSON.parse(options.body);
      sentMessages.push(payload);
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, result: { message_id: 888, chat: { id: payload.chat_id } } })
      };
    }
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  });

  try {
    // 1. Create soldier with Moscow timezone (UTC+3)
    const mskSoldier = db.registerUser({ username: 'msk_warrior', password: 'password', playerName: 'База Москва' });
    db.approveUser(mskSoldier.userId, 'r3');
    db.bindUserTelegram(mskSoldier.userId, 10101, 'msk_tg');

    // 2. Create soldier with Yekaterinburg timezone (UTC+5)
    const yekatSoldier = db.registerUser({ username: 'ural_warrior', password: 'password', playerName: 'База Урал' });
    db.approveUser(yekatSoldier.userId, 'r3');
    db.bindUserTelegram(yekatSoldier.userId, 20202, 'ural_tg');

    // Login as ural_warrior and set timezone via PUT /api/my-profile/timezone
    const uralLogin = await (await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'ural_warrior', password: 'password' })
    })).json();

    const tzUpdateRes = await fetch(`${baseUrl}/api/my-profile/timezone`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${uralLogin.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        timezone: 'Asia/Yekaterinburg',
        timezoneOffset: 5
      })
    });
    assert.equal(tzUpdateRes.status, 200);
    const tzData = await tzUpdateRes.json();
    assert.equal(tzData.success, true);
    assert.equal(tzData.timezone, 'Asia/Yekaterinburg');
    assert.equal(tzData.timezoneOffset, 5);

    // Verify GET /api/my-profile reflects timezone
    const profileRes = await fetch(`${baseUrl}/api/my-profile`, {
      headers: { 'Authorization': `Bearer ${uralLogin.token}` }
    });
    assert.equal(profileRes.status, 200);
    const profile = await profileRes.json();
    assert.equal(profile.user.timezone, 'Asia/Yekaterinburg');
    assert.equal(profile.user.timezoneOffset, 5);

    // 3. Create Event starting on 2026-11-16
    const eventTypes = db.getEventTypes();
    const et = eventTypes[0]; // King of War
    const mskUser = db.findUserById(mskSoldier.userId);
    const uralUser = db.findUserById(yekatSoldier.userId);

    const ev = db.saveEvent({
      typeId: et.id,
      dateFrom: '2026-11-16',
      dateTo: '2026-11-18',
      note: 'Большая битва',
      assignments: [
        { place: 1, playerId: mskUser.player_id, rsvpStatus: 'confirmed' },
        { place: 2, playerId: uralUser.player_id, rsvpStatus: 'confirmed' }
      ]
    });

    // 4. Test Night Protection: At 00:00 UTC (03:00 MSK / 05:00 Yekaterinburg)
    // Game event starts on game server, but players are asleep! Must NOT send.
    sentMessages.length = 0;
    const nightResult = await checkScheduledEventMorningReminders(null, {
      now: '2026-11-16T00:00:00.000Z'
    });
    assert.equal(nightResult.remindersSent, 0, 'No morning reminders sent at 00:00 UTC');
    assert.equal(sentMessages.length, 0);

    // 5. At 04:00 UTC:
    // - Ural player (UTC+5): local time is 09:00 AM -> Must trigger!
    // - Moscow player (UTC+3): local time is 07:00 AM -> Must NOT trigger yet!
    sentMessages.length = 0;
    const morningUralResult = await checkScheduledEventMorningReminders(null, {
      now: '2026-11-16T04:00:00.000Z'
    });
    assert.equal(morningUralResult.remindersSent, 1, 'Only Ural player receives reminder at 04:00 UTC (09:00 local)');
    assert.equal(sentMessages.length, 1);
    assert.equal(sentMessages[0].chat_id, 20202);
    assert.ok(sentMessages[0].text.includes('Доброе утро, База Урал'));
    assert.ok(sentMessages[0].text.includes('#2'));
    assert.ok(sentMessages[0].text.includes('00:00 UTC'));

    // 6. At 06:00 UTC:
    // - Moscow player (UTC+3): local time is 09:00 AM -> Must trigger!
    // - Ural player (UTC+5): already sent -> Deduplicated!
    sentMessages.length = 0;
    const morningMskResult = await checkScheduledEventMorningReminders(null, {
      now: '2026-11-16T06:00:00.000Z'
    });
    assert.equal(morningMskResult.remindersSent, 1, 'Moscow player receives reminder at 06:00 UTC (09:00 local)');
    assert.equal(sentMessages.length, 1);
    assert.equal(sentMessages[0].chat_id, 10101);
    assert.ok(sentMessages[0].text.includes('Доброе утро, База Москва'));
    assert.ok(sentMessages[0].text.includes('#1'));

    // 7. Test manual trigger endpoint POST /api/telegram/check-morning-reminders
    const adminLogin = await (await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin123' })
    })).json();

    const triggerRes = await fetch(`${baseUrl}/api/telegram/check-morning-reminders`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${adminLogin.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ force: false })
    });
    assert.equal(triggerRes.status, 200);
    const triggerData = await triggerRes.json();
    assert.equal(triggerData.success, true);
  } finally {
    telegram.setTelegramFetch(null);
    await server.close();
  }
});

test('API POST /api/events/:id/share-grid enforces RBAC and sends poster to staff chat', async () => {
  const { startServer } = require('./server.js');
  const telegram = require('./telegram.js');
  const server = await startServer({ port: 0, dbPath: ':memory:' });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const sentPhotos = [];
  telegram.setTelegramFetch(async (url, init) => {
    if (url.includes('/sendPhoto')) {
      const isFormData = init && init.body && typeof init.body.get === 'function';
      const chatId = isFormData ? init.body.get('chat_id') : JSON.parse(init.body || '{}').chat_id;
      const caption = isFormData ? init.body.get('caption') : JSON.parse(init.body || '{}').caption;
      const replyMarkup = isFormData ? init.body.get('reply_markup') : JSON.parse(init.body || '{}').reply_markup;
      sentPhotos.push({ chatId, caption, replyMarkup });
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, result: { message_id: 888 } }),
        text: async () => JSON.stringify({ ok: true, result: { message_id: 888 } })
      };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ ok: true, result: {} }),
      text: async () => JSON.stringify({ ok: true, result: {} })
    };
  });

  try {
    const adminLogin = await (await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin123' })
    })).json();

    // Configure staff chat ID
    await fetch(`${baseUrl}/api/telegram/settings`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${adminLogin.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: '12345:TEST_TOKEN', staffChatId: '-100987654321' })
    });

    // Create an event
    const eventTypesRes = await fetch(`${baseUrl}/api/event-types`);
    const eventTypes = await eventTypesRes.json();
    const eventType = eventTypes[0] || { id: 'king-of-war' };

    const eventRes = await fetch(`${baseUrl}/api/events`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminLogin.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        typeId: eventType.id,
        title: 'Битва за трон',
        dateFrom: '2026-11-20',
        dateTo: '2026-11-22'
      })
    });
    const event = await eventRes.json();
    assert(event && event.id);

    // Register R3 user
    const r3Reg = await (await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'r3_grid_sharer', password: 'password123' })
    })).json();
    await fetch(`${baseUrl}/api/users/${r3Reg.userId}/approve`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminLogin.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ rank: 'r3' })
    });
    const r3Login = await (await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'r3_grid_sharer', password: 'password123' })
    })).json();

    // 1. R3 attempt -> 403 Forbidden
    const r3Res = await fetch(`${baseUrl}/api/events/${event.id}/share-grid`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${r3Login.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        imageBase64: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
      })
    });
    assert.equal(r3Res.status, 403);

    // 2. Admin without imageBase64 -> 400
    const emptyRes = await fetch(`${baseUrl}/api/events/${event.id}/share-grid`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminLogin.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    assert.equal(emptyRes.status, 400);

    // 3. Admin valid share -> 200 and photo sent to staff chat
    const shareRes = await fetch(`${baseUrl}/api/events/${event.id}/share-grid`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminLogin.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        imageBase64: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        caption: '📊 Инфографика сетки: Битва за трон'
      })
    });
    assert.equal(shareRes.status, 200);
    const shareData = await shareRes.json();
    assert.equal(shareData.success, true);
    assert.equal(shareData.messageId, 888);

    assert.equal(sentPhotos.length, 1);
    assert.equal(String(sentPhotos[0].chatId), '-100987654321');
    assert.ok(sentPhotos[0].caption.includes('Битва за трон'));
  } finally {
    telegram.setTelegramFetch(null);
    await server.close();
  }
});

test('Telegram bot fighter suite commands: /me, /deficit, /events, /menu', async () => {
  const { startServer, handleTelegramUpdate } = require('./server.js');
  const telegram = require('./telegram.js');
  const db = require('./db.js');
  const server = await startServer({ port: 0, dbPath: ':memory:' });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  db.setAppSetting('telegram_bot_token', 'test_fighter_bot_token');

  const sentMessages = [];
  telegram.setTelegramFetch(async (url, init) => {
    if (url.includes('/sendMessage')) {
      const payload = JSON.parse(init.body);
      sentMessages.push(payload);
      return { ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: 1234 } }) };
    }
    if (url.includes('/answerCallbackQuery')) {
      return { ok: true, status: 200, json: async () => ({ ok: true, result: true }) };
    }
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  });

  try {
    // 1. Create and bind user
    await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'fighter1', password: 'password123', playerName: 'Sector 7' })
    });
    const user = db.findUserByUsername('fighter1');
    assert.ok(user);
    db.approveUser(user.id, 'r3');
    db.bindUserTelegram(user.id, 999111, 'fighter_tg');

    // 2. Test /me command
    sentMessages.length = 0;
    const meRes = await handleTelegramUpdate({
      message: {
        chat: { id: 999111, type: 'private' },
        from: { id: 999111, username: 'fighter_tg' },
        text: '/me'
      }
    });
    assert.equal(meRes.ok, true);
    assert.equal(meRes.command, 'me');
    assert.equal(sentMessages.length, 1);
    assert.ok(sentMessages[0].text.includes('Sector 7'));
    assert.ok(sentMessages[0].text.includes('Купоны'));
    assert.ok(sentMessages[0].reply_markup && sentMessages[0].reply_markup.inline_keyboard);

    // 3. Test /deficit command
    sentMessages.length = 0;
    const defRes = await handleTelegramUpdate({
      message: {
        chat: { id: 999111, type: 'private' },
        from: { id: 999111, username: 'fighter_tg' },
        text: '/deficit'
      }
    });
    assert.equal(defRes.ok, true);
    assert.equal(defRes.command, 'deficit');
    assert.equal(sentMessages.length, 1);
    assert.ok(sentMessages[0].text.includes('дефицита') || sentMessages[0].text.includes('дефицит'));

    // 4. Test /events command
    sentMessages.length = 0;
    const evRes = await handleTelegramUpdate({
      message: {
        chat: { id: 999111, type: 'private' },
        from: { id: 999111, username: 'fighter_tg' },
        text: '/events'
      }
    });
    assert.equal(evRes.ok, true);
    assert.equal(evRes.command, 'events');
    assert.equal(sentMessages.length, 1);
    assert.ok(sentMessages[0].text.includes('Ближайшие события'));

    // 5. Test /menu command
    sentMessages.length = 0;
    const menuRes = await handleTelegramUpdate({
      message: {
        chat: { id: 999111, type: 'private' },
        from: { id: 999111, username: 'fighter_tg' },
        text: '/menu'
      }
    });
    assert.equal(menuRes.ok, true);
    assert.equal(menuRes.command, 'menu');
    assert.equal(sentMessages.length, 1);
    assert.ok(sentMessages[0].reply_markup && sentMessages[0].reply_markup.inline_keyboard);

    // 6. Test callback queries for menu buttons (cmd_me, cmd_deficit, cmd_events, cmd_stock_help, cmd_events_past, cmd_menu)
    sentMessages.length = 0;
    const cbMeRes = await handleTelegramUpdate({
      callback_query: {
        id: 'cq_me_1',
        from: { id: 999111 },
        data: 'cmd_me',
        message: { chat: { id: 999111 }, message_id: 1234 }
      }
    });
    assert.equal(cbMeRes.ok, true);
    assert.equal(cbMeRes.action, 'cmd_me');

    const cbEventsPastRes = await handleTelegramUpdate({
      callback_query: {
        id: 'cq_ev_past_1',
        from: { id: 999111 },
        data: 'cmd_events_past',
        message: { chat: { id: 999111 }, message_id: 1234 }
      }
    });
    assert.equal(cbEventsPastRes.ok, true);
    assert.equal(cbEventsPastRes.action, 'cmd_events_past');

    const cbEventsUpcomingRes = await handleTelegramUpdate({
      callback_query: {
        id: 'cq_ev_up_1',
        from: { id: 999111 },
        data: 'cmd_events_upcoming',
        message: { chat: { id: 999111 }, message_id: 1234 }
      }
    });
    assert.equal(cbEventsUpcomingRes.ok, true);
    assert.equal(cbEventsUpcomingRes.action, 'cmd_events_upcoming');

    const cbMenuRes = await handleTelegramUpdate({
      callback_query: {
        id: 'cq_menu_1',
        from: { id: 999111 },
        data: 'cmd_menu',
        message: { chat: { id: 999111 }, message_id: 1234 }
      }
    });
    assert.equal(cbMenuRes.ok, true);
    assert.equal(cbMenuRes.action, 'cmd_menu');

    // Test /events past command
    sentMessages.length = 0;
    const evPastCmdRes = await handleTelegramUpdate({
      message: {
        message_id: 1236,
        from: { id: 999111, username: 'ranger' },
        chat: { id: 999111, type: 'private' },
        text: '/events past'
      }
    });
    assert.equal(evPastCmdRes.ok, true);
    assert.equal(evPastCmdRes.command, 'events');
    assert.equal(evPastCmdRes.mode, 'past');
    assert.ok(sentMessages.length > 0);

    // 7. Test interactive event registration via Telegram Callback
    const allEvents = db.getEvents();
    assert.ok(allEvents.length > 0);
    const targetEvent = allEvents[0];

    const regRes = await handleTelegramUpdate({
      callback_query: {
        id: 'cq_reg_1',
        from: { id: 999111 },
        data: `reg_event:${targetEvent.id}:2`,
        message: { chat: { id: 999111 }, message_id: 1234, text: 'Открыта регистрация' }
      }
    });
    assert.equal(regRes.ok, true);
    assert.equal(regRes.action, 'registered');
    assert.equal(regRes.desiredPlace, 2);

    // Verify registration saved in DB
    const playerRecord = db.getPlayersByUserId(user.id)[0];
    assert.ok(playerRecord);
    const regItem = db.getUserRegistration(targetEvent.id, playerRecord.id);
    assert.ok(regItem);
    assert.equal(regItem.desiredPlace, 2);

    // Test unregistration via Telegram Callback
    const unregRes = await handleTelegramUpdate({
      callback_query: {
        id: 'cq_unreg_1',
        from: { id: 999111 },
        data: `unreg_event:${targetEvent.id}`,
        message: { chat: { id: 999111 }, message_id: 1234, text: 'Открыта регистрация' }
      }
    });
    assert.equal(unregRes.ok, true);
    assert.equal(unregRes.action, 'unregistered');

    const regAfterItem = db.getUserRegistration(targetEvent.id, playerRecord.id);
    assert.equal(regAfterItem, null);

  } finally {
    telegram.setTelegramFetch(null);
    await server.close();
  }
});

test('Telegram bot officer suite commands: /who, /stale, /ping_stale, /digest (RBAC)', async () => {
  const { startServer, handleTelegramUpdate } = require('./server.js');
  const telegram = require('./telegram.js');
  const db = require('./db.js');
  const server = await startServer({ port: 0, dbPath: ':memory:' });

  db.setAppSetting('telegram_bot_token', 'test_officer_token_123');
  db.setAppSetting('telegram_staff_chat_id', '-100999888');

  const sentMessages = [];
  telegram.setTelegramFetch(async (url, init) => {
    if (url.includes('/sendMessage')) {
      const payload = JSON.parse(init.body);
      sentMessages.push(payload);
      return { ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: 555 } }) };
    }
    if (url.includes('/answerCallbackQuery')) {
      return { ok: true, status: 200, json: async () => ({ ok: true, result: true }) };
    }
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  });

  try {
    // 1. Create officer R4 and fighter R3
    const officer = db.registerUser({ username: 'officer_alex', password: 'password123' });
    db.approveUser(officer.id, 'r4');
    db.bindUserTelegram(officer.id, 888111, 'alex_tg');

    const fighter = db.registerUser({ username: 'soldier_bob', password: 'password123' });
    db.approveUser(fighter.id, 'r3');
    db.bindUserTelegram(fighter.id, 888222, 'bob_tg');
    db.createPlayer({ name: 'Sector 7 (Рейнджер)', power: 45000000, vipLevel: 14, userId: fighter.id });

    // 2. R3 attempts officer commands -> Forbidden
    sentMessages.length = 0;
    const r3WhoRes = await handleTelegramUpdate({
      message: { chat: { id: 888222, type: 'private' }, from: { id: 888222 }, text: '/who Sector 1' }
    });
    assert.equal(r3WhoRes.ok, true);
    assert.equal(r3WhoRes.authorized, false);
    assert.ok(sentMessages[0].text.includes('Доступ запрещен'));

    // 3. Officer R4 runs /who
    sentMessages.length = 0;
    const r4WhoRes = await handleTelegramUpdate({
      message: { chat: { id: 888111, type: 'private' }, from: { id: 888111 }, text: '/who Sector' }
    });
    assert.equal(r4WhoRes.ok, true);
    assert.equal(r4WhoRes.command, 'who');
    assert.ok(sentMessages[0].text.includes('Досье бойца'));

    // 4. Officer R4 runs /stale
    sentMessages.length = 0;
    const r4StaleRes = await handleTelegramUpdate({
      message: { chat: { id: 888111, type: 'private' }, from: { id: 888111 }, text: '/stale' }
    });
    assert.equal(r4StaleRes.ok, true);
    assert.equal(r4StaleRes.command, 'stale');
    assert.ok(sentMessages[0].text.includes('Отчет по устаревшим складам') || sentMessages[0].text.includes('актуальны'));

    // 5. Staff Chat runs /digest
    sentMessages.length = 0;
    const staffDigestRes = await handleTelegramUpdate({
      message: { chat: { id: -100999888, type: 'supergroup' }, from: { id: 888111 }, text: '/digest' }
    });
    assert.equal(staffDigestRes.ok, true);
    assert.equal(staffDigestRes.command, 'digest');
    assert.ok(sentMessages[0].text.includes('Оперативная сводка альянса'));

    // 6. Officer runs /ping_stale
    sentMessages.length = 0;
    const pingStaleRes = await handleTelegramUpdate({
      message: { chat: { id: -100999888, type: 'supergroup' }, from: { id: 888111 }, text: '/ping_stale' }
    });
    assert.equal(pingStaleRes.ok, true);
    assert.equal(pingStaleRes.command, 'ping_stale');
    assert.ok(sentMessages.some(m => m.text && m.text.includes('напоминаний')));

  } finally {
    telegram.setTelegramFetch(null);
    await server.close();
  }
});

test('Telegram Webhook server screenshot OCR processing and interactive confirmation callbacks', async () => {
  const { startServer, handleTelegramUpdate, setServerOcrRunner } = require('./server.js');
  const telegram = require('./telegram.js');
  const db = require('./db.js');
  const server = await startServer({ port: 0, dbPath: ':memory:' });

  db.setAppSetting('telegram_bot_token', 'test_ocr_token_456');

  const sentMessages = [];
  const answeredCallbacks = [];

  telegram.setTelegramFetch(async (url, init) => {
    if (url.includes('/sendMessage')) {
      const payload = JSON.parse(init.body);
      sentMessages.push(payload);
      return { ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: 888 } }) };
    }
    if (url.includes('/answerCallbackQuery')) {
      const payload = JSON.parse(init.body);
      answeredCallbacks.push(payload);
      return { ok: true, status: 200, json: async () => ({ ok: true, result: true }) };
    }
    if (url.includes('/getFile')) {
      return { ok: true, status: 200, json: async () => ({ ok: true, result: { file_path: 'photos/warehouse_test.jpg' } }) };
    }
    if (url.includes('/file/bot')) {
      // Return dummy JPEG buffer
      return { ok: true, status: 200, arrayBuffer: async () => Buffer.from('FAKE_JPEG_IMAGE_DATA') };
    }
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  });

  try {
    const soldier = db.registerUser({ username: 'ocr_soldier', password: 'password123' });
    db.approveUser(soldier.id, 'r3');
    db.bindUserTelegram(soldier.id, 999333, 'ocr_soldier_tg');
    const player = db.createPlayer({
      name: 'Sector OCR (Снайпер)',
      power: 35000000,
      stock: { coupons: 5000, puzzles: 100, starCoupons: 0, legendaryStars1: 0, legendaryStars2: 0, legendaryStars3: 0 },
      userId: soldier.id
    });

    // 1. Mock OCR to recognize numbers
    setServerOcrRunner(async () => ({
      coupons: 16500,
      puzzles: 410,
      starCoupons: 14,
      legendaryStars1: 2,
      legendaryStars2: 1,
      legendaryStars3: 0
    }));

    sentMessages.length = 0;
    const ocrUploadRes = await handleTelegramUpdate({
      message: {
        chat: { id: 999333, type: 'private' },
        from: { id: 999333 },
        photo: [{ file_id: 'photo_ocr_test', file_size: 1024 }]
      }
    });

    assert.equal(ocrUploadRes.ok, true);
    assert.equal(ocrUploadRes.ocr, true);
    assert.ok(ocrUploadRes.historyId > 0);
    assert.ok(sentMessages[0].text.includes('Распознаны данные склада'));
    assert.ok(sentMessages[0].text.includes('16 500'));
    assert.ok(sentMessages[0].text.includes('410'));
    assert.equal(sentMessages[0].reply_markup.inline_keyboard[0][0].callback_data, `confirm_ocr_stock:${ocrUploadRes.historyId}`);

    // 2. Confirm OCR changes
    answeredCallbacks.length = 0;
    sentMessages.length = 0;
    const confirmOcrRes = await handleTelegramUpdate({
      callback_query: {
        id: 'cq_confirm_ocr_1',
        from: { id: 999333 },
        message: { chat: { id: 999333 } },
        data: `confirm_ocr_stock:${ocrUploadRes.historyId}`
      }
    });

    assert.equal(confirmOcrRes.ok, true);
    assert.equal(confirmOcrRes.action, 'confirm_ocr_stock');
    assert.ok(answeredCallbacks.some(c => c.text.includes('успешно применены')));
    const updatedPlayer = db.getPlayerById(player.id);
    assert.equal(updatedPlayer.stock.coupons, 16500);
    assert.equal(updatedPlayer.stock.puzzles, 410);

    // 3. Fallback: OCR returns null or unavailable
    setServerOcrRunner(async () => null);
    sentMessages.length = 0;
    const fallbackUploadRes = await handleTelegramUpdate({
      message: {
        chat: { id: 999333, type: 'private' },
        from: { id: 999333 },
        photo: [{ file_id: 'photo_fallback_test', file_size: 1024 }]
      }
    });

    assert.equal(fallbackUploadRes.ok, true);
    assert.equal(fallbackUploadRes.fallback, true);
    assert.ok(sentMessages[0].text.includes('Скриншот склада получен'));
    assert.equal(sentMessages[0].reply_markup.inline_keyboard[0][0].callback_data, 'confirm_current_stock');

    // 4. Confirm current stock callback
    answeredCallbacks.length = 0;
    sentMessages.length = 0;
    const confirmFallbackRes = await handleTelegramUpdate({
      callback_query: {
        id: 'cq_confirm_current_1',
        from: { id: 999333 },
        message: { chat: { id: 999333 } },
        data: 'confirm_current_stock'
      }
    });

    assert.equal(confirmFallbackRes.ok, true);
    assert.equal(confirmFallbackRes.action, 'confirm_current_stock');
    assert.ok(answeredCallbacks.some(c => c.text.includes('актуальный')));

  } finally {
    setServerOcrRunner(null);
    telegram.setTelegramFetch(null);
    await server.close();
  }
});

test('Telegram Mini App HMAC auth and multi-chat announcement channel binding', async () => {
  const crypto = require('node:crypto');
  const { startServer, handleTelegramUpdate } = require('./server.js');
  const telegram = require('./telegram.js');
  const db = require('./db.js');
  const server = await startServer({ port: 0, dbPath: ':memory:' });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const botToken = '987654321:XYZ_Test_Token_For_TMA';
  db.setAppSetting('telegram_bot_token', botToken);

  const sentMessages = [];
  telegram.setTelegramFetch(async (url, init) => {
    if (url.includes('/sendMessage')) {
      const payload = JSON.parse(init.body);
      sentMessages.push(payload);
      return { ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: 101 } }) };
    }
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  });

  try {
    // 1. Setup users
    const admin = db.findUserByUsername('admin');
    const adminSession = db.createSession(admin.id);

    const fighter = db.registerUser({ username: 'tma_soldier', password: 'password123' });
    db.approveUser(fighter.id, 'r3');
    db.bindUserTelegram(fighter.id, 555444333, 'tma_soldier_tg');

    // Helper to generate initData
    function createInitData(userObj, authDate = Math.floor(Date.now() / 1000), customToken = botToken) {
      const uStr = JSON.stringify(userObj);
      const pairs = [
        `auth_date=${authDate}`,
        `query_id=AAH555`,
        `user=${uStr}`
      ];
      pairs.sort();
      const dataCheckString = pairs.join('\n');
      const secretKey = crypto.createHmac('sha256', 'WebAppData').update(customToken).digest();
      const hash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

      const params = new URLSearchParams();
      params.set('query_id', 'AAH555');
      params.set('user', uStr);
      params.set('auth_date', String(authDate));
      params.set('hash', hash);
      return params.toString();
    }

    // 2. Test POST /api/auth/telegram-webapp with valid initData
    const validInitData = createInitData({ id: 555444333, username: 'tma_soldier_tg', first_name: 'Soldier' });
    const authRes = await fetch(`${baseUrl}/api/auth/telegram-webapp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData: validInitData })
    });
    assert.equal(authRes.status, 200);
    const authData = await authRes.json();
    assert.equal(authData.success, true);
    assert.equal(authData.user.username, 'tma_soldier');
    assert.ok(authData.token);
    assert.ok(authRes.headers.get('set-cookie')?.includes('token='));

    // 3. Test POST /api/auth/telegram-webapp with invalid signature
    const invalidRes = await fetch(`${baseUrl}/api/auth/telegram-webapp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData: validInitData.replace(/hash=[a-f0-9]{10}/, 'hash=0000000000') })
    });
    assert.equal(invalidRes.status, 401);

    // 4. Test POST /api/auth/telegram-webapp with unbound user
    const unboundInitData = createInitData({ id: 999999999, username: 'unknown_stranger' });
    const unboundRes = await fetch(`${baseUrl}/api/auth/telegram-webapp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData: unboundInitData })
    });
    assert.equal(unboundRes.status, 404);

    // 5. Test Channel PIN generation (POST /api/telegram/channel-bind-token)
    const pinRes = await fetch(`${baseUrl}/api/telegram/channel-bind-token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminSession}`
      }
    });
    assert.equal(pinRes.status, 200);
    const pinData = await pinRes.json();
    assert.ok(pinData.pin.startsWith('KOW-CHAN-'));

    // 6. Test /connect_channel <PIN> command in Telegram
    sentMessages.length = 0;
    const channelBindRes = await handleTelegramUpdate({
      message: {
        chat: { id: -100777666, type: 'channel', title: 'KoW Announcements' },
        from: { id: 555444333 },
        text: `/connect_channel ${pinData.pin}`
      }
    });
    assert.equal(channelBindRes.ok, true);
    assert.equal(channelBindRes.channelConnected, true);
    assert.equal(db.getAppSetting('telegram_announcement_chat_id'), '-100777666');
    assert.ok(sentMessages[0].text.includes('Канал/чат анонсов успешно подключен'));

    // 7. Verify GET & PUT /api/telegram/settings with announcementChatId
    const getSettingsRes = await fetch(`${baseUrl}/api/telegram/settings`, {
      headers: { Authorization: `Bearer ${adminSession}` }
    });
    assert.equal(getSettingsRes.status, 200);
    const settingsData = await getSettingsRes.json();
    assert.equal(settingsData.announcementChatId, '-100777666');

    // Update announcementChatId via PUT
    const putSettingsRes = await fetch(`${baseUrl}/api/telegram/settings`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminSession}`
      },
      body: JSON.stringify({ announcementChatId: '-100123456789' })
    });
    assert.equal(putSettingsRes.status, 200);
    const putData = await putSettingsRes.json();
    assert.equal(putData.announcementChatId, '-100123456789');
    assert.equal(db.getAppSetting('telegram_announcement_chat_id'), '-100123456789');

  } finally {
    telegram.setTelegramFetch(null);
    await server.close();
  }
});






async function run() {
  let passed = 0;
  let failed = 0;
  for (const { name, fn } of tests) {
    try {
      await fn();
      console.log(`ok - ${name}`);
      passed++;
    } catch (err) {
      console.error(`not ok - ${name}`);
      console.error(err);
      failed++;
      process.exitCode = 1;
    }
  }
  console.log(`\nTests finished: ${passed} passed, ${failed} failed`);
}

run();
