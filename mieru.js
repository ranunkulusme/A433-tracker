/**
 * KoW Tracker - Mieru Tunnel Client Manager
 * Manages configuration and process lifecycle for the Mieru client tunnel.
 * Pure Node.js with zero external dependencies.
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const telegram = require('./telegram.js');

let activeMieruProcess = null;
let mieruStatus = {
  running: false,
  pid: null,
  startedAt: null,
  port: 1080,
  error: null
};

/**
 * Format individual connection settings into a standard Mieru client JSON object.
 */
function formatMieruConfig({
  server = '',
  portRange = '10000-10050',
  user = '',
  password = '',
  transport = 'TCP',
  socks5Port = 1080
} = {}) {
  const cleanServer = String(server || '').trim();
  const cleanPortRange = String(portRange || '10000-10050').trim();
  const cleanUser = String(user || '').trim();
  const cleanPassword = String(password || '').trim();
  const cleanTransport = String(transport || 'TCP').trim().toUpperCase() === 'UDP' ? 'UDP' : 'TCP';
  const cleanSocksPort = parseInt(socks5Port, 10) || 1080;

  return {
    profiles: [
      {
        profileName: 'default',
        serverAddress: cleanServer,
        portRanges: [cleanPortRange],
        user: cleanUser,
        password: cleanPassword,
        transport: cleanTransport,
        multiplexing: 'MULTIPLEXING_MIDDLE'
      }
    ],
    activeProfile: 'default',
    socks5Port: cleanSocksPort,
    httpPort: 0,
    logging: {
      level: 'INFO'
    }
  };
}

/**
 * Parse raw Mieru JSON string or validate an existing object.
 */
function parseMieruConfig(jsonInput) {
  let parsed = null;
  if (typeof jsonInput === 'string') {
    try {
      parsed = JSON.parse(jsonInput);
    } catch (e) {
      return { ok: false, error: 'INVALID_JSON', message: `Ошибка парсинга JSON: ${e.message}` };
    }
  } else if (typeof jsonInput === 'object' && jsonInput !== null) {
    parsed = jsonInput;
  } else {
    return { ok: false, error: 'EMPTY_CONFIG', message: 'Конфигурация не предоставлена' };
  }

  const profiles = Array.isArray(parsed.profiles) ? parsed.profiles : [];
  const activeProfileName = parsed.activeProfile || (profiles[0]?.profileName);
  const activeProfile = profiles.find(p => p.profileName === activeProfileName) || profiles[0] || {};

  const server = activeProfile.serverAddress || '';
  const portRanges = Array.isArray(activeProfile.portRanges) ? activeProfile.portRanges : [];
  const portRange = portRanges[0] || '';
  const user = activeProfile.user || '';
  const password = activeProfile.password || '';
  const transport = (activeProfile.transport || 'TCP').toUpperCase();
  const socks5Port = parseInt(parsed.socks5Port, 10) || 1080;

  return {
    ok: true,
    config: parsed,
    fields: {
      server,
      portRange,
      user,
      password,
      transport,
      socks5Port
    }
  };
}

/**
 * Mask password for secure UI display.
 */
function maskSecret(secret) {
  if (!secret || typeof secret !== 'string') return '';
  if (secret.length <= 4) return '***';
  return secret.slice(0, 2) + '***' + secret.slice(-2);
}

/**
 * Start or restart the local Mieru client process.
 */
function startMieruProcess(configObj, dataDir = path.join(__dirname, 'data')) {
  stopMieruProcess();

  try {
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    const configPath = path.join(dataDir, 'mieru-client.json');
    fs.writeFileSync(configPath, JSON.stringify(configObj, null, 2), { mode: 0o600 });

    const port = configObj.socks5Port || 1080;

    // Check if mieru binary is available in PATH
    try {
      const proc = spawn('mieru', ['run', '-c', configPath], {
        detached: false,
        stdio: 'pipe'
      });

      proc.stdout.on('data', chunk => {
        const text = chunk.toString('utf8').trim();
        if (text) console.log(`[Mieru] ${text}`);
      });

      proc.stderr.on('data', chunk => {
        const text = chunk.toString('utf8').trim();
        if (text) console.warn(`[Mieru stderr] ${text}`);
      });

      proc.on('error', err => {
        console.warn(`[Mieru] Could not spawn binary (might be running externally): ${err.message}`);
        mieruStatus.running = false;
        mieruStatus.error = err.message;
      });

      proc.on('exit', (code, signal) => {
        console.log(`[Mieru] Process exited with code ${code}, signal ${signal}`);
        mieruStatus.running = false;
        mieruStatus.pid = null;
        activeMieruProcess = null;
      });

      activeMieruProcess = proc;
      mieruStatus = {
        running: true,
        pid: proc.pid,
        startedAt: new Date().toISOString(),
        port,
        error: null
      };

      console.log(`[Mieru] Client process started (PID: ${proc.pid}, SOCKS5: 127.0.0.1:${port})`);
      return { success: true, status: mieruStatus };
    } catch (spawnErr) {
      console.warn(`[Mieru] Spawn failed: ${spawnErr.message}`);
      mieruStatus = {
        running: false,
        pid: null,
        startedAt: null,
        port,
        error: spawnErr.message
      };
      return { success: false, error: spawnErr.message, status: mieruStatus };
    }
  } catch (err) {
    console.error('[Mieru] Error saving config or starting client:', err.message);
    mieruStatus.error = err.message;
    return { success: false, error: err.message };
  }
}

/**
 * Stop the active Mieru process cleanly.
 */
function stopMieruProcess() {
  if (activeMieruProcess) {
    try {
      activeMieruProcess.kill('SIGTERM');
      console.log(`[Mieru] Process (PID: ${activeMieruProcess.pid}) terminated.`);
    } catch (e) {}
    activeMieruProcess = null;
  }
  mieruStatus.running = false;
  mieruStatus.pid = null;
  mieruStatus.startedAt = null;
  return { success: true };
}

function getMieruStatus() {
  return { ...mieruStatus };
}

/**
 * Test connectivity through Mieru SOCKS5 proxy to Telegram Bot API.
 */
async function testMieruConnection(proxyUrl, botToken) {
  const token = botToken || '123456:FAKE_TOKEN_FOR_PING';
  const start = Date.now();

  try {
    const res = await telegram.callTelegramApi(token, 'getMe', null, {
      proxyUrl,
      timeoutMs: 8000
    });

    const latencyMs = Date.now() - start;

    if (res.ok) {
      return {
        ok: true,
        latencyMs,
        botUsername: res.result?.username || null
      };
    }

    // Telegram replied with error (e.g. 401 Unauthorized for fake token), but connection itself SUCCEEDED!
    if (res.errorCode === 401 || (res.error && res.error.includes('Unauthorized'))) {
      return {
        ok: true,
        latencyMs,
        botUsername: null,
        note: 'Туннель работает (сервер Telegram ответил, но токен бота не настроен)'
      };
    }

    return {
      ok: false,
      latencyMs,
      error: res.error || 'Ошибка проверки туннеля'
    };
  } catch (err) {
    return {
      ok: false,
      latencyMs: Date.now() - start,
      error: err.message || 'Ошибка сети через прокси'
    };
  }
}

module.exports = {
  formatMieruConfig,
  parseMieruConfig,
  maskSecret,
  startMieruProcess,
  stopMieruProcess,
  getMieruStatus,
  testMieruConnection
};
