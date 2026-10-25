# PWA and Offline Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Реализовать поддержку Progressive Web App (PWA) для установки KoW Tracker на смартфоны (iOS Safari и Android Chrome) с оффлайн-кэшированием статической оболочки через Service Worker и фоновой синхронизацией личного кабинета через очередь Outbox.

**Architecture:**
1. **PWA Manifest и иконки:** `manifest.json` с полноэкранным режимом `standalone` и иконками 192×192 / 512×512.
2. **Service Worker (`sw.js`):** кэширование статической оболочки (HTML, CSS, JS, иконки) по стратегии *Stale-While-Revalidate*; пропуск запросов `/api/*` напрямую в сеть.
3. **Серверный слой (`server.js`):** корректная отдача `manifest.json`, `sw.js` (с заголовком `Service-Worker-Allowed: /`) и каталога `/icons/*`.
4. **Математическое ядро (`logic.js`):** чистые функции управления очередью Outbox (`createOutboxItem`, `filterOutboxQueue`, `isOfflineMutationAllowed`).
5. **Клиентская синхронизация (`app.js`):** кэширование сессии пользователя при холодном старте, перехват сетевых сбоев в `apiFetch`, оптимистичное применение изменений к UI и автоматический сброс очереди (`flushOutboxQueue`) при появлении сети.
6. **Интерфейс (`index.html`, `style.css`):** компактный индикатор статуса сети (`🟢 Онлайн` / `🟡 Оффлайн: N в очереди`) и кнопка установки PWA (`beforeinstallprompt` для Android и подсказка для iOS).

**Tech Stack:** Vanilla JavaScript (ES6+), Web App Manifest, Service Worker API, HTML5, CSS3, Node.js HTTP (`server.js`), SQLite (`db.js`).

**Spec:** [`docs/superpowers/specs/2026-10-25-pwa-and-offline-sync-design.md`](file:///Users/ranunkulus/Downloads/KOW/docs/superpowers/specs/2026-10-25-pwa-and-offline-sync-design.md)

## Global Constraints

- **Строгое соблюдение GitFlow:** разработка ведется в ветке `feature/pwa-and-offline-sync`, ответвленной от актуального `master` (v3.1.0). Прямые коммиты в `master` запрещены.
- **Нулевые внешние зависимости сервера:** бэкенд использует исключительно нативные модули Node.js (`node:http`, `node:sqlite`, `node:crypto`, `node:fs`, `node:path`).
- **Совместимость с iOS Safari:** не использовать W3C `SyncManager` в Service Worker; очередь Outbox реализуется на клиенте в `app.js` и гарантированно работает на всех браузерах.
- **Безопасность сессий:** токен и пользователь кэшируются локально, но стираются только при получении явного HTTP `401 Unauthorized` от сервера. При сетевых ошибках в оффлайне сессия сохраняется.
- Все тесты запускаются через команду `node logic.test.js && node db.test.js && node api.test.js`.

## Review Focus

- **Холодный старт в оффлайне:** запуск приложения без сети под ранее авторизованным пользователем не приводит к удалению токена или показу окна логина.
- **Оптимистичные изменения в UI:** при изменении запасов/офицера в оффлайне интерфейс обновляется мгновенно, а запрос регистрируется в очереди `kow_outbox_queue`.
- **Воспроизведение очереди:** при наступлении события `online` или вызове `flushOutboxQueue` запросы отправляются в строгом порядке FIFO с токеном авторизации, а по завершении вызывается `loadDataFromServer()`.
- **Защита от зависания очереди:** запрос, завершившийся ошибкой 4xx (кроме 401), отбрасывается, выводится тост с ошибкой, а последующие запросы продолжают выполняться.
- **Ограничение прав:** оффлайн-мутации разрешены только для операций личного кабинета (сектор, запасы, офицеры, заявки на ивенты); административные действия Р4/Р5 блокируются с предупреждением.

---

### Task 1: Генерация иконок PWA, Web App Manifest и мобильные мета-теги

**Files:**
- Create: `manifest.json`
- Create: `icons/icon-192.png`, `icons/icon-512.png` (скрипт генерации на Node.js или векторные PNG)
- Modify: `index.html`

**Interfaces:**
- Produces:
  - `manifest.json`: манифест приложения со свойствами `name`, `short_name`, `start_url`, `display: "standalone"`, `theme_color: "#0f172a"`, `background_color: "#0f172a"`, `icons`.
  - Мобильные мета-теги в `<head>` `index.html`: `theme-color`, `apple-mobile-web-app-capable`, `apple-mobile-web-app-status-bar-style`, `apple-touch-icon`.

- [ ] **Step 1: Написать падающий юнит-тест структуры манифеста и иконок в `logic.test.js`**

```javascript
// Тест валидности manifest.json и наличия иконок
const fs = require('fs');
const path = require('path');

const manifestPath = path.join(__dirname, 'manifest.json');
assert(fs.existsSync(manifestPath), 'manifest.json must exist');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
assert.strictEqual(manifest.display, 'standalone');
assert.strictEqual(manifest.theme_color, '#0f172a');
assert(Array.isArray(manifest.icons) && manifest.icons.length >= 2);
console.log('ok - manifest.json is valid and contains required PWA fields');
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Запуск: `node logic.test.js`  
Ожидается: FAIL (`manifest.json must exist`).

- [ ] **Step 3: Создать `manifest.json`, сгенерировать иконки и обновить `index.html`**

1. Создать `manifest.json` согласно спецификации.
2. Создать директорию `icons/` и сгенерировать `icon-192.png` и `icon-512.png` с логотипом KoW Tracker (синий шеврон с импульсом).
3. В `index.html` добавить ссылки на манифест, иконку и мета-теги iOS Safari.

- [ ] **Step 4: Запустить тест и убедиться, что он проходит**

Запуск: `node logic.test.js`  
Ожидается: PASS.

- [ ] **Step 5: Сделать git commit**

```bash
git add manifest.json icons/ index.html logic.test.js
git commit -m "feat(pwa): add web app manifest, mobile meta tags and app icons"
```

---

### Task 2: Service Worker (`sw.js`) и отдача PWA-файлов сервером

**Files:**
- Create: `sw.js`
- Modify: `server.js`
- Modify: `api.test.js`

**Interfaces:**
- Produces:
  - `sw.js`: скрипт Service Worker, реализующий кэширование статики (*Stale-While-Revalidate* для `/`, `index.html`, `style.css`, `app.js`, `logic.js`, `manifest.json`, иконок). Запросы `/api/*` не кэшируются (пропускаются в сеть).
  - `server.js`: эндпоинты статики для отдачи `manifest.json` (`application/manifest+json`), `sw.js` (`application/javascript` с заголовком `Service-Worker-Allowed: /`) и файлов из директории `icons/`.

- [ ] **Step 1: Написать падающий интеграционный тест в `api.test.js`**

```javascript
// Тест отдачи manifest.json, sw.js и иконок сервером
const manifestRes = await apiRequest('/manifest.json');
assert.strictEqual(manifestRes.status, 200);
assert(manifestRes.headers['content-type'].includes('application/manifest+json') || manifestRes.headers['content-type'].includes('application/json'));

const swRes = await apiRequest('/sw.js');
assert.strictEqual(swRes.status, 200);
assert.strictEqual(swRes.headers['service-worker-allowed'], '/');

const iconRes = await apiRequest('/icons/icon-192.png');
assert.strictEqual(iconRes.status, 200);
console.log('ok - server serves PWA manifest, service worker and icons');
```

- [ ] **Step 2: Запустить интеграционный тест и убедиться, что он падает**

Запуск: `node api.test.js`  
Ожидается: FAIL (404 на `/manifest.json` или `/sw.js`).

- [ ] **Step 3: Реализовать `sw.js` и обработчики статики в `server.js`**

1. Написать `sw.js` с версионированием кэша (`kow-cache-v1`), событиями `install` (кэширование оболочки), `activate` (очистка старых версий кэша, `clients.claim()`) и `fetch` (*Stale-While-Revalidate* для статики, *Network-Only* для `/api/*`).
2. В `server.js` зарегистрировать маршруты для `/manifest.json`, `/sw.js` (с заголовком `Service-Worker-Allowed: /`), а также поддержку отдачи файлов из каталога `/icons/`.

- [ ] **Step 4: Запустить тесты API и проверить результат**

Запуск: `node api.test.js`  
Ожидается: PASS.

- [ ] **Step 5: Сделать git commit**

```bash
git add sw.js server.js api.test.js
git commit -m "feat(pwa): add service worker static cache and server PWA static routes"
```

---

### Task 3: Модуль очереди Outbox и чистая логика синхронизации в `logic.js`

**Files:**
- Modify: `logic.js`
- Modify: `logic.test.js`

**Interfaces:**
- Produces:
  - `createOutboxItem({ endpoint, method, body })`: создает структуру элемента очереди с `id`, `timestamp`, `retryCount: 0`.
  - `isOfflineMutationAllowed({ endpoint, method })`: возвращает `true` только для разрешенных операций личного кабинета Р3 (`/api/my-profile`, `/api/events/:id/registrations`).
  - `addToOutboxQueue(queue, item)`: добавляет элемент в очередь с дедупликацией (если есть более ранний запрос к тому же единичному ресурсу, объединяет их).
  - `filterOutboxQueue(queue, completedId)`: удаляет завершенный элемент по `id`.

- [ ] **Step 1: Написать падающий юнит-тест в `logic.test.js`**

```javascript
const {
  createOutboxItem,
  isOfflineMutationAllowed,
  addToOutboxQueue,
  filterOutboxQueue
} = require('./logic');

// Тест валидации разрешенных оффлайн-мутаций
assert.strictEqual(isOfflineMutationAllowed({ endpoint: '/api/my-profile', method: 'PUT' }), true);
assert.strictEqual(isOfflineMutationAllowed({ endpoint: '/api/events/1/registrations', method: 'POST' }), true);
assert.strictEqual(isOfflineMutationAllowed({ endpoint: '/api/events/schedule-season', method: 'POST' }), false);
assert.strictEqual(isOfflineMutationAllowed({ endpoint: '/api/events/1/autopick', method: 'POST' }), false);

// Тест формирования элемента очереди и дедупликации
const item1 = createOutboxItem({ endpoint: '/api/my-profile', method: 'PUT', body: { sector: { power: 100 } } });
assert(item1.id && item1.timestamp);
let q = addToOutboxQueue([], item1);
assert.strictEqual(q.length, 1);

const item2 = createOutboxItem({ endpoint: '/api/my-profile', method: 'PUT', body: { sector: { power: 150 } } });
q = addToOutboxQueue(q, item2);
assert.strictEqual(q.length, 1, 'Same endpoint PUT mutation should update existing queue item');
assert.strictEqual(q[0].body.sector.power, 150);

q = filterOutboxQueue(q, q[0].id);
assert.strictEqual(q.length, 0);
console.log('ok - outbox queue logic functions and offline mutation validation');
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Запуск: `node logic.test.js`  
Ожидается: FAIL (`createOutboxItem is not defined`).

- [ ] **Step 3: Реализовать функции управления очередью в `logic.js`**

1. Добавить `isOfflineMutationAllowed({ endpoint, method })`.
2. Реализовать `createOutboxItem`, `addToOutboxQueue`, `filterOutboxQueue`.
3. Экспортировать функции в UMD-блоке.

- [ ] **Step 4: Запустить тесты и проверить результат**

Запуск: `node logic.test.js`  
Ожидается: PASS.

- [ ] **Step 5: Сделать git commit**

```bash
git add logic.js logic.test.js
git commit -m "feat(logic): add outbox queue management and offline mutation validation"
```

---

### Task 4: Интеграция Outbox Queue и оффлайн-сессий в `app.js`

**Files:**
- Modify: `app.js`

**Interfaces:**
- Produces:
  - Регистрация Service Worker (`navigator.serviceWorker.register('/sw.js')`).
  - Сохранение и гидратация сессии пользователя (`kow_user` в `localStorage`).
  - Перехват сетевых сбоев в `apiFetch`: проверка `isOfflineMutationAllowed`, добавление в `kow_outbox_queue`, оптимистичное сохранение в локальный `state`.
  - Функция `flushOutboxQueue()`: последовательное воспроизведение очереди при появлении сети (событие `online`, `focus`, таймер 30 сек).
  - При ошибках 4xx (не-401): вывод тоста, удаление сбойной операции из очереди, вызов `loadDataFromServer()`.

- [ ] **Step 1: Реализовать регистрацию Service Worker и оффлайн-сессию в `app.js`**

1. В `initApp()` добавить безопасную регистрацию `navigator.serviceWorker.register('/sw.js')`.
2. В `loginSubmit()` и `checkAuth()` сохранять `currentUser` в `localStorage.setItem('kow_user', JSON.stringify(user))`.
3. В `checkAuth()` при сетевой ошибке (`TypeError: Failed to fetch` или `!navigator.onLine`) восстанавливать `currentUser` из `localStorage` без удаления токена.

- [ ] **Step 2: Внедрить перехват мутаций и Outbox Queue в `apiFetch`**

1. Если `!navigator.onLine` или нативный `fetch()` выбросил ошибку сети:
   - Если метод `GET`: возвращать данные из локального кэша `state`.
   - Если метод мутирующий (`POST`, `PUT`, `DELETE`):
     - Проверить `logic.isOfflineMutationAllowed`: если запрещено, показать toast с ошибкой *«Это действие доступно только при подключении к сети»* и отклонить промис.
     - Если разрешено: создать элемент через `logic.createOutboxItem`, добавить в очередь `kow_outbox_queue`.
     - Применить оптимистичное изменение к `state` и вызвать `save()`.
     - Обновить плашку сетевого статуса.
     - Вернуть псевдо-успешный ответ `{ success: true, offline: true }`.

- [ ] **Step 3: Реализовать функцию сброса очереди `flushOutboxQueue()`**

1. Читать очередь из `localStorage`. Если очередь пуста, завершить работу.
2. Проверять `navigator.onLine === true`.
3. Для каждого элемента очереди выполнять запрос через нативный `fetch` с заголовком авторизации.
4. При успехе (2xx): удалять элемент из очереди.
5. При ошибке 401: приостанавливать очередь, показывать окно авторизации.
6. При ошибке 4xx/5xx: удалять элемент из очереди, показывать toast с предупреждением.
7. После очистки очереди вызывать `loadDataFromServer()` и обновлять статус в UI.
8. Навесить слушатели: `window.addEventListener('online', flushOutboxQueue)`, `window.addEventListener('focus', flushOutboxQueue)`, интервал 30 секунд.

- [ ] **Step 4: Проверить синтаксис скрипта**

Запуск: `node -c app.js`  
Ожидается: отсутствие синтаксических ошибок.

- [ ] **Step 5: Сделать git commit**

```bash
git add app.js
git commit -m "feat(pwa): integrate client outbox queue, offline auth hydration and flush sync"
```

---

### Task 5: UI индикатор сетевого статуса и баннер установки PWA

**Files:**
- Modify: `index.html`
- Modify: `style.css`
- Modify: `app.js`

**Interfaces:**
- UI components:
  - Индикатор сети `#network-status-badge` в шапке: отображает `🟢 Онлайн`, `🟡 Оффлайн (N в очереди)`, `🔄 Синхронизация...`. При клике на бейдж в оффлайне запускается `flushOutboxQueue()`.
  - Кнопка установки `#pwa-install-btn`: перехват события `beforeinstallprompt` на Android/Chrome.
  - Подсказка установки для iOS Safari в футере или сайдбаре: инструкция «Поделиться → На экран „Домой“».

- [ ] **Step 1: Добавить разметку бейджа сети и кнопки установки в `index.html`**

1. В шапку `<header class="topbar">` добавить контейнер `<div id="network-status-badge" class="network-badge online">...</div>`.
2. В сайдбар и шапку добавить кнопку `<button id="pwa-install-btn" class="btn-pwa-install" style="display:none">📲 Установить приложение</button>`.
3. Добавить модальное окно `#modal-ios-install` с подсказкой для пользователей iPhone.

- [ ] **Step 2: Добавить стили в `style.css`**

Стилизовать элементы: `.network-badge`, `.network-badge.online`, `.network-badge.offline`, `.network-badge.syncing`, `.btn-pwa-install`, `.ios-install-steps`.

- [ ] **Step 3: Связать UI со статусом сети и событиями PWA в `app.js`**

1. Реализовать `updateNetworkStatusUI()`: обновление текста, цвета индикатора и счетчика очереди.
2. Подключить слушатели `window.addEventListener('online', updateNetworkStatusUI)` и `offline`.
3. Добавить перехват события `window.addEventListener('beforeinstallprompt', (e) => { ... })`: сохранение `deferredPrompt`, отображение `#pwa-install-btn`, вызов нативного диалога установки при клике.
4. Для iOS Safari (`/iPhone|iPad|iPod/.test(navigator.userAgent) && !window.navigator.standalone`) добавить вызов `#modal-ios-install` при клике на установку.

- [ ] **Step 4: Проверить синтаксис и запустить тесты**

Запуск: `node -c app.js && node -c server.js`  
Ожидается: 0 ошибок.

- [ ] **Step 5: Сделать git commit**

```bash
git add index.html style.css app.js
git commit -m "feat(ui): add network status indicator and pwa install prompt components"
```

---

### Task 6: Финальная верификация, подготовка релиза v3.2.0 и GitFlow

**Files:**
- Modify: `package.json` (повышение версии до `3.2.0`)
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Запустить полный комплекс тестов**

```bash
npm test
node -c app.js && node -c server.js && node -c sw.js && node -c db.js && node -c logic.js
```
Ожидается: 0 failures, все тесты зеленые.

- [ ] **Step 2: Оформить релизную ветку по GitFlow**

1. Создать ветку релиза: `git checkout -b release/v3.2.0`.
2. Обновить версию в `package.json` до `3.2.0`.
3. Добавить подробное описание изменений в `CHANGELOG.md` по стандарту Keep a Changelog.
4. Закоммитить: `git commit -am "chore(release): prepare v3.2.0"`.

- [ ] **Step 3: Слить в master и поставить аннотированный тег**

```bash
git checkout master
git merge --no-ff release/v3.2.0 -m "Merge branch 'release/v3.2.0' into master"
git tag -a v3.2.0 -m "Release v3.2.0: PWA support, offline shell and outbox background sync"
git branch -d release/v3.2.0 feature/pwa-and-offline-sync
```

---

## Self-Review

1. **Spec coverage:** Все пункты утвержденного дизайн-документа (PWA Manifest, Service Worker, Client Outbox Queue, оффлайн-сессии, индикатор сети, кнопка установки) покрыты задачами.
2. **Step scan:** Каждый шаг содержит однозначное действие, команду запуска и критерий успеха (TDD).
3. **Type consistency:** Имена очередей (`kow_outbox_queue`), полей объектов очереди и функций согласованы между всеми файлами.
4. **GitFlow:** Строгое соблюдение методологии (ветка `feature/pwa-and-offline-sync`, релиз `release/v3.2.0`, слияние через `--no-ff` в `master` с тегом `v3.2.0`).
