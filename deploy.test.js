const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const assert = require('assert');

function runDeployTests() {
  const projectRoot = __dirname;
  const deployShPath = path.join(projectRoot, 'deploy.sh');
  const nginxConfPath = path.join(projectRoot, 'deploy', 'nginx', 'kow-tracker.conf');
  const servicePath = path.join(projectRoot, 'deploy', 'systemd', 'kow-tracker.service');
  const backupShPath = path.join(projectRoot, 'deploy', 'scripts', 'backup.sh');

  console.log('--- Запуск тестов развертывания и конфигураций deploy/ ---');

  // 1. Проверка существования и прав исполняемости
  assert.ok(fs.existsSync(deployShPath), 'deploy.sh должен существовать');
  fs.accessSync(deployShPath, fs.constants.X_OK);
  console.log('ok - deploy.sh существует и является исполняемым');

  assert.ok(fs.existsSync(backupShPath), 'backup.sh должен существовать');
  fs.accessSync(backupShPath, fs.constants.X_OK);
  console.log('ok - backup.sh существует и является исполняемым');

  // 2. Синтаксическая валидация bash-скриптов
  execSync(`bash -n "${deployShPath}"`, { stdio: 'pipe' });
  console.log('ok - deploy.sh проходит проверку синтаксиса bash -n');

  execSync(`bash -n "${backupShPath}"`, { stdio: 'pipe' });
  console.log('ok - backup.sh проходит проверку синтаксиса bash -n');

  // 3. Проверка флага справки --help / -h
  const helpOutput = execSync(`"${deployShPath}" --help`, { encoding: 'utf8' });
  assert.ok(helpOutput.includes('--domain'), '--help должен содержать параметр --domain');
  assert.ok(helpOutput.includes('--email'), '--help должен содержать параметр --email');
  assert.ok(helpOutput.includes('--skip-ssl'), '--help должен содержать параметр --skip-ssl');
  assert.ok(helpOutput.includes('--auto'), '--help должен содержать параметр --auto');
  console.log('ok - deploy.sh --help выводит полную справку по параметрам Nginx и SSL');

  // 4. Проверка шаблона конфигурации Nginx
  assert.ok(fs.existsSync(nginxConfPath), 'deploy/nginx/kow-tracker.conf должен существовать');
  const nginxContent = fs.readFileSync(nginxConfPath, 'utf8');
  assert.ok(nginxContent.includes('proxy_pass http://127.0.0.1:3000;'), 'Nginx должен проксировать на 127.0.0.1:3000');
  assert.ok(nginxContent.includes('location /.well-known/acme-challenge/'), 'Nginx должен содержать ACME challenge путь');
  assert.ok(nginxContent.includes('client_max_body_size'), 'Nginx должен настраивать client_max_body_size');
  assert.ok(nginxContent.includes('Strict-Transport-Security'), 'Nginx должен содержать заголовок HSTS');
  assert.ok(nginxContent.includes('location = /sw.js'), 'Nginx должен оптимизировать Service Worker кэширование');
  console.log('ok - deploy/nginx/kow-tracker.conf содержит все необходимые директивы PWA и безопасности');

  // 5. Проверка шаблонизации домена в Nginx конфиге
  const testDomain = 'kow.alliance-warriors.com';
  const templatedNginx = nginxContent
    .replace(/your-domain\.com www\.your-domain\.com/g, testDomain)
    .replace(/your-domain\.com/g, testDomain);

  assert.ok(templatedNginx.includes(`server_name ${testDomain};`), 'Шаблонизация должна подставить server_name');
  assert.ok(templatedNginx.includes(`/etc/letsencrypt/live/${testDomain}/fullchain.pem`), 'Шаблонизация должна подставить путь к fullchain.pem');
  assert.ok(templatedNginx.includes(`/etc/letsencrypt/live/${testDomain}/privkey.pem`), 'Шаблонизация должна подставить путь к privkey.pem');
  assert.ok(!templatedNginx.includes('your-domain.com'), 'Все плейсхолдеры your-domain.com должны быть заменены');
  console.log('ok - шаблонизация deploy/nginx/kow-tracker.conf корректно подставляет домен и SSL-сертификаты');

  // 6. Проверка unit-файла systemd
  assert.ok(fs.existsSync(servicePath), 'deploy/systemd/kow-tracker.service должен существовать');
  const serviceContent = fs.readFileSync(servicePath, 'utf8');
  assert.ok(serviceContent.includes('ExecStart='), 'Systemd unit должен содержать ExecStart');
  assert.ok(serviceContent.includes('Restart=always'), 'Systemd unit должен содержать Restart=always');
  console.log('ok - deploy/systemd/kow-tracker.service валиден');

  console.log('Все тесты развертывания успешно пройдены!');
}

if (require.main === module) {
  runDeployTests();
}

module.exports = { runDeployTests };
