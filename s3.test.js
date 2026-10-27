const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

const s3 = require('./s3.js');

test('getS3Config parses environment variables correctly and returns null when not configured', () => {
  // Empty env -> null
  assert.equal(s3.getS3Config({}), null);

  // Partial env missing secret -> null
  assert.equal(s3.getS3Config({
    S3_ENDPOINT: 's3.timeweb.cloud',
    S3_BUCKET: 'my-bucket',
    S3_ACCESS_KEY: 'access123'
  }), null);

  // Full config
  const cfg = s3.getS3Config({
    S3_ENDPOINT: 'https://s3.timeweb.cloud/',
    S3_BUCKET: 'my-bucket',
    S3_ACCESS_KEY: 'access123',
    S3_SECRET_KEY: 'secret456',
    S3_REGION: 'ru-1',
    S3_KEY: 'custom-kow.db',
    S3_SYNC_INTERVAL_MS: '2000'
  });

  assert(cfg);
  assert.equal(cfg.endpoint, 's3.timeweb.cloud');
  assert.equal(cfg.bucket, 'my-bucket');
  assert.equal(cfg.accessKey, 'access123');
  assert.equal(cfg.secretKey, 'secret456');
  assert.equal(cfg.region, 'ru-1');
  assert.equal(cfg.key, 'custom-kow.db');
  assert.equal(cfg.useSsl, true);
  assert.equal(cfg.syncIntervalMs, 2000);
});

test('buildAwsV4Headers generates valid AWS Signature Version 4 headers', () => {
  const fixedDate = new Date('2026-10-27T12:00:00.000Z');
  const headers = s3.buildAwsV4Headers({
    method: 'GET',
    pathname: '/my-bucket/kow.db',
    body: '',
    accessKey: 'TEST_ACCESS_KEY',
    secretKey: 'TEST_SECRET_KEY',
    region: 'ru-1',
    service: 's3',
    date: fixedDate,
    host: 's3.timeweb.cloud'
  });

  assert.equal(headers['host'], 's3.timeweb.cloud');
  assert.equal(headers['x-amz-date'], '20261027T120000Z');
  assert.equal(headers['x-amz-content-sha256'], 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert(headers['authorization'].startsWith('AWS4-HMAC-SHA256 Credential=TEST_ACCESS_KEY/20261027/ru-1/s3/aws4_request'));
  assert(headers['authorization'].includes('SignedHeaders=host;x-amz-content-sha256;x-amz-date'));
  assert(headers['authorization'].includes('Signature='));
});

test('s3 download and upload against mock S3 server works properly', async () => {
  const mockStorage = new Map();
  let receivedAuth = '';

  const server = http.createServer((req, res) => {
    receivedAuth = req.headers['authorization'] || '';
    const urlPath = req.url; // e.g. /my-bucket/kow.db

    if (req.method === 'GET') {
      if (mockStorage.has(urlPath)) {
        res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
        res.end(mockStorage.get(urlPath));
      } else {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('NoSuchKey');
      }
    } else if (req.method === 'PUT') {
      const chunks = [];
      req.on('data', chunk => chunks.push(chunk));
      req.on('end', () => {
        mockStorage.set(urlPath, Buffer.concat(chunks));
        res.writeHead(200);
        res.end();
      });
    } else {
      res.writeHead(405);
      res.end();
    }
  });

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  const testDir = path.join(__dirname, 'test-s3-temp');
  fs.mkdirSync(testDir, { recursive: true });
  const localDbFile = path.join(testDir, 'test-kow.db');

  const config = {
    endpoint: `127.0.0.1:${port}`,
    bucket: 'test-bucket',
    key: 'kow.db',
    accessKey: 'AK_TEST',
    secretKey: 'SK_TEST',
    region: 'ru-1',
    useSsl: false,
    port: port,
    syncIntervalMs: 50
  };

  try {
    // 1. Initial download when bucket is empty returns { found: false }
    const initialDownload = await s3.downloadFile(config, localDbFile);
    assert.equal(initialDownload.found, false);
    assert.equal(fs.existsSync(localDbFile), false);
    assert(receivedAuth.includes('AWS4-HMAC-SHA256 Credential=AK_TEST'));

    // 2. Upload file
    fs.writeFileSync(localDbFile, 'SQLITE_MOCK_DATABASE_BINARY_CONTENT');
    const uploadRes = await s3.uploadFile(config, localDbFile);
    assert.equal(uploadRes.success, true);
    assert.equal(uploadRes.bytes, 'SQLITE_MOCK_DATABASE_BINARY_CONTENT'.length);

    // 3. Download uploaded file to a different destination
    const downloadedFile = path.join(testDir, 'downloaded.db');
    const secondDownload = await s3.downloadFile(config, downloadedFile);
    assert.equal(secondDownload.found, true);
    assert.equal(fs.readFileSync(downloadedFile, 'utf8'), 'SQLITE_MOCK_DATABASE_BINARY_CONTENT');

    // 4. S3SyncManager test with debounced push
    let checkpointCalled = false;
    const syncMgr = new s3.S3SyncManager({
      config,
      dbPath: localDbFile,
      onCheckpoint: () => { checkpointCalled = true; }
    });

    assert.equal(syncMgr.getStatus().enabled, true);
    assert.equal(syncMgr.getStatus().bucket, 'test-bucket');

    // Debounced push
    fs.writeFileSync(localDbFile, 'UPDATED_MOCK_CONTENT');
    await syncMgr.pushDebounced(50);
    // Wait for timer
    await new Promise(r => setTimeout(r, 120));

    assert.equal(checkpointCalled, true);
    assert(syncMgr.getStatus().lastSyncAt);
    assert.equal(mockStorage.get('/test-bucket/kow.db').toString('utf8'), 'UPDATED_MOCK_CONTENT');
  } finally {
    server.close();
    fs.rmSync(testDir, { recursive: true, force: true });
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
  console.log(`\nS3 Tests finished: ${passed} passed, ${failed} failed`);
}

run();
