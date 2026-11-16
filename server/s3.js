'use strict';

const crypto = require('node:crypto');
const http = require('node:http');
const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');

/**
 * Извлекает и нормализует конфигурацию S3 из переменных окружения.
 * Возвращает null, если S3 не настроен.
 */
function getS3Config(env = process.env) {
  let endpoint = (env.S3_ENDPOINT || env.S3_HOST || '').trim();
  if (!endpoint) return null;

  let useSsl = env.S3_USE_SSL !== 'false';
  if (endpoint.startsWith('https://')) {
    useSsl = true;
    endpoint = endpoint.replace(/^https:\/\//, '');
  } else if (endpoint.startsWith('http://')) {
    useSsl = false;
    endpoint = endpoint.replace(/^http:\/\//, '');
  }
  endpoint = endpoint.replace(/\/+$/, '');

  const bucket = (env.S3_BUCKET || '').trim();
  const accessKey = (env.S3_ACCESS_KEY || env.S3_ACCESS_KEY_ID || env.AWS_ACCESS_KEY_ID || '').trim();
  const secretKey = (env.S3_SECRET_KEY || env.S3_SECRET_ACCESS_KEY || env.AWS_SECRET_ACCESS_KEY || '').trim();

  if (!bucket || !accessKey || !secretKey) {
    return null;
  }

  const region = (env.S3_REGION || env.AWS_DEFAULT_REGION || 'ru-1').trim();
  const key = (env.S3_KEY || 'kow.db').trim();

  let port = Number(env.S3_PORT);
  if (!port) {
    const colonIdx = endpoint.lastIndexOf(':');
    if (colonIdx > -1) {
      const parsedPort = Number(endpoint.slice(colonIdx + 1));
      if (!Number.isNaN(parsedPort)) {
        port = parsedPort;
      }
    }
  }
  if (!port) {
    port = useSsl ? 443 : 80;
  }

  const syncIntervalMs = Math.max(500, Number(env.S3_SYNC_INTERVAL_MS) || 5000);

  return {
    endpoint,
    bucket,
    accessKey,
    secretKey,
    region,
    key,
    useSsl,
    port,
    syncIntervalMs
  };
}

/**
 * Хелперы хеширования для AWS Signature Version 4
 */
function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function hmac(key, data, encoding) {
  const h = crypto.createHmac('sha256', key).update(data);
  return encoding ? h.digest(encoding) : h.digest();
}

function getSigningKey(secretKey, dateStamp, region, service) {
  const kSecret = 'AWS4' + secretKey;
  const kDate = hmac(kSecret, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  return hmac(kService, 'aws4_request');
}

/**
 * Формирует заголовки AWS Signature Version 4 для HTTP-запроса к S3.
 */
function buildAwsV4Headers({
  method = 'GET',
  pathname = '/',
  query = '',
  headers = {},
  body = '',
  accessKey,
  secretKey,
  region = 'ru-1',
  service = 's3',
  date = new Date(),
  host
}) {
  const pad = (n) => String(n).padStart(2, '0');
  const dateStamp = `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}`;
  const amzDate = `${dateStamp}T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;

  const payload = Buffer.isBuffer(body) ? body : Buffer.from(body || '', 'utf8');
  const payloadHash = sha256(payload);

  const reqHeaders = {
    ...headers,
    host: host,
    'x-amz-date': amzDate,
    'x-amz-content-sha256': payloadHash
  };

  const headerKeys = Object.keys(reqHeaders)
    .map(k => k.toLowerCase())
    .sort();

  const signedHeaders = headerKeys.join(';');

  const canonicalHeaders = headerKeys
    .map(k => `${k}:${String(reqHeaders[k]).trim()}\n`)
    .join('');

  const canonicalRequest = [
    method.toUpperCase(),
    pathname,
    query,
    canonicalHeaders,
    signedHeaders,
    payloadHash
  ].join('\n');

  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    sha256(canonicalRequest)
  ].join('\n');

  const signingKey = getSigningKey(secretKey, dateStamp, region, service);
  const signature = hmac(signingKey, stringToSign, 'hex');

  const authorization = `AWS4-HMAC-SHA256 Credential=${accessKey}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return {
    ...reqHeaders,
    authorization
  };
}

/**
 * Выполняет сетевой запрос к S3 endpoint
 */
function s3Request(config, { method = 'GET', key, body = null, headers = {} }) {
  return new Promise((resolve, reject) => {
    const rawHost = config.endpoint.replace(/:[0-9]+$/, '');
    const reqKey = key || config.key;
    const cleanKey = reqKey.replace(/^\/+/, '');
    const pathname = `/${config.bucket}/${encodeURI(cleanKey)}`;

    const customHeaders = { ...headers };
    if (body) {
      const buf = Buffer.isBuffer(body) ? body : Buffer.from(body, 'utf8');
      customHeaders['content-length'] = buf.length;
    }

    const signedHeaders = buildAwsV4Headers({
      method,
      pathname,
      query: '',
      headers: customHeaders,
      body: body || '',
      accessKey: config.accessKey,
      secretKey: config.secretKey,
      region: config.region,
      service: 's3',
      host: config.endpoint
    });

    const options = {
      hostname: rawHost,
      port: config.port,
      path: pathname,
      method: method.toUpperCase(),
      headers: signedHeaders,
      timeout: 30000
    };

    const client = config.useSsl ? https : http;
    const req = client.request(options, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const resBody = Buffer.concat(chunks);
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: resBody
        });
      });
    });

    req.on('timeout', () => {
      req.destroy(new Error(`S3 request timeout (${options.method} ${pathname})`));
    });

    req.on('error', (err) => {
      reject(err);
    });

    if (body) {
      req.write(body);
    }
    req.end();
  });
}

/**
 * Скачивает файл базы данных из S3 в целевой локальный путь
 */
async function downloadFile(config, targetFilePath) {
  if (!config) return { found: false, skipped: true };

  const res = await s3Request(config, { method: 'GET', key: config.key });

  if (res.statusCode === 404) {
    return { found: false, statusCode: 404 };
  }

  if (res.statusCode >= 200 && res.statusCode < 300) {
    const targetDir = path.dirname(targetFilePath);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    const tmpPath = `${targetFilePath}.s3tmp-${Date.now()}`;
    fs.writeFileSync(tmpPath, res.body);
    fs.renameSync(tmpPath, targetFilePath);

    return {
      found: true,
      statusCode: res.statusCode,
      bytes: res.body.length
    };
  }

  const errSnippet = res.body.toString('utf8').slice(0, 300);
  throw new Error(`S3 download failed with status ${res.statusCode}: ${errSnippet}`);
}

/**
 * Загружает локальный файл базы данных в S3
 */
async function uploadFile(config, sourceFilePath) {
  if (!config) return { success: false, skipped: true };

  if (!fs.existsSync(sourceFilePath)) {
    throw new Error(`Cannot upload to S3: source file does not exist: ${sourceFilePath}`);
  }

  const data = fs.readFileSync(sourceFilePath);
  const res = await s3Request(config, {
    method: 'PUT',
    key: config.key,
    body: data,
    headers: {
      'content-type': 'application/x-sqlite3'
    }
  });

  if (res.statusCode >= 200 && res.statusCode < 300) {
    return {
      success: true,
      statusCode: res.statusCode,
      bytes: data.length
    };
  }

  const errSnippet = res.body.toString('utf8').slice(0, 300);
  throw new Error(`S3 upload failed with status ${res.statusCode}: ${errSnippet}`);
}

/**
 * Менеджер управления синхронизацией между SQLite и S3
 */
class S3SyncManager {
  constructor({ config, dbPath, onCheckpoint, logger = console }) {
    this.config = config;
    this.dbPath = dbPath;
    this.onCheckpoint = onCheckpoint;
    this.logger = logger;

    this.lastSyncAt = null;
    this.lastError = null;
    this.isSyncing = false;
    this.hasPendingSync = false;
    this.timer = null;
  }

  getStatus() {
    return {
      enabled: Boolean(this.config),
      bucket: this.config?.bucket || null,
      endpoint: this.config?.endpoint || null,
      key: this.config?.key || null,
      lastSyncAt: this.lastSyncAt,
      isSyncing: this.isSyncing,
      lastError: this.lastError ? this.lastError.message : null
    };
  }

  async pull(customDbPath = null) {
    if (!this.config) return { found: false, skipped: true };
    const target = customDbPath || this.dbPath;
    this.logger.log(`[S3] Pulling database from s3://${this.config.bucket}/${this.config.key} to ${target}...`);
    try {
      const res = await downloadFile(this.config, target);
      if (res.found) {
        this.lastSyncAt = new Date().toISOString();
        this.lastError = null;
        this.logger.log(`[S3] Successfully restored database (${res.bytes} bytes) from S3.`);
      } else {
        this.logger.log(`[S3] No existing database in s3://${this.config.bucket}/${this.config.key}. A fresh database will be initialized.`);
      }
      return res;
    } catch (err) {
      this.lastError = err;
      this.logger.error(`[S3] Failed to pull database from S3:`, err.message);
      throw err;
    }
  }

  async pushImmediate() {
    if (!this.config) return { success: false, skipped: true };

    if (this.isSyncing) {
      this.hasPendingSync = true;
      return { inProgress: true };
    }

    this.isSyncing = true;
    try {
      if (typeof this.onCheckpoint === 'function') {
        try {
          this.onCheckpoint();
        } catch (cpErr) {
          this.logger.warn(`[S3] SQLite checkpoint warning before S3 push:`, cpErr.message);
        }
      }

      const res = await uploadFile(this.config, this.dbPath);
      this.lastSyncAt = new Date().toISOString();
      this.lastError = null;
      return res;
    } catch (err) {
      this.lastError = err;
      this.logger.error(`[S3] Failed to push database to S3:`, err.message);
      throw err;
    } finally {
      this.isSyncing = false;
      if (this.hasPendingSync) {
        this.hasPendingSync = false;
        setImmediate(() => this.pushImmediate().catch(() => {}));
      }
    }
  }

  pushDebounced(delayMs = null) {
    if (!this.config) return;

    if (this.timer) {
      clearTimeout(this.timer);
    }

    const delay = delayMs !== null ? delayMs : this.config.syncIntervalMs;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.pushImmediate().catch((err) => {
        this.logger.error(`[S3] Debounced push error:`, err.message);
      });
    }, delay);
  }
}

module.exports = {
  getS3Config,
  buildAwsV4Headers,
  s3Request,
  downloadFile,
  uploadFile,
  S3SyncManager
};
