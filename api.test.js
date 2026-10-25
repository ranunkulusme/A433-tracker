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

    // R4 cannot access /api/users (only R5)
    const r4UsersRes = await fetch(`${baseUrl}/api/users`, {
      headers: { Authorization: `Bearer ${officer1Login.token}` }
    });
    assert.equal(r4UsersRes.status, 403);

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
        sector: { vipLevel: 12, confidentialityLevel: 5, power: 15000000, kills: 250000, killPoints: 250000 },
        stock: { coupons: 15000, puzzles: 120, chests: 10 }
      })
    });
    assert.equal(putProfRes.status, 200);
    const updatedProf = await putProfRes.json();
    assert.equal(updatedProf.sector.vipLevel, 12);
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
      body: JSON.stringify({ name: 'Новый Воин', rank: 'r3' })
    });
    assert.equal(createPlayerRes.status, 200);
    const createdPlayer = await createPlayerRes.json();
    assert.equal(createdPlayer.name, 'Новый Воин');

    // 4. R5 updates the player
    const updatePlayerRes = await fetch(`${baseUrl}/api/players/${createdPlayer.id}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${adminLogin.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Ветеран Войны' })
    });
    assert.equal(updatePlayerRes.status, 200);
    const updated = await updatePlayerRes.json();
    assert.equal(updated.name, 'Ветеран Войны');

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
        skills: [5, 5, 5, 5]
      })
    });
    assert.equal(putOffRes.status, 200);
    const putOffData = await putOffRes.json();
    assert.deepEqual(putOffData.skills, [5, 5, 5, 5]);

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
