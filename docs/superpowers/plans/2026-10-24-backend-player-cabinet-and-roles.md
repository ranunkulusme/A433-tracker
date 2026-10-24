# Backend, Player Cabinet, Roles (R5/R4/R3), Event Registration, and Docker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Создать централизованный сервер на Node.js со встроенной базой SQLite в Docker-контейнере, изолированным личным кабинетом игрока (Р3), системой ролей (Р5, Р4, Р3), очередью подтверждения регистраций и подачей заявок на ивенты с умным автоподбором.

**Architecture:** Сервер на Node.js (`server.js`) раздаёт статический фронтенд и REST API. Данные хранятся в постоянном томе SQLite (`./data/kow.db`). Аутентификация работает через токены сессий и хэширование паролей (`node:crypto`). Ролевая модель разграничивает доступ к API и UI по рангам (`r5`, `r4`, `r3`). Ядро `logic.js` расширяется алгоритмом `smartAutoPickWithRegistrations` и переиспользуется как на бэкенде, так и на фронтенде.

**Tech Stack:** Node.js (v22+ with native `node:sqlite` and `node:crypto`), Express/Node HTTP, Vanilla HTML5/CSS3/ES6+, Docker, Docker Compose.

**Spec:** `docs/superpowers/specs/2026-10-24-backend-player-cabinet-and-roles-design.md`

## Global Constraints
- Сохранить обратную совместимость с экспортом/импортом формата `kow_v2`.
- Все 18 существующих модульных тестов в `logic.test.js` должны оставаться зелеными.
- Все данные базы должны храниться в директории `./data/kow.db` для монтирования в Docker volume.
- При первом запуске с пустой базой происходит автоматический бутстрап (демо-данные + аккаунт администратора Р5).
- Защита от перерасхода купонов: кандидат не назначается на место, если `deficitCoupons < placeCoupons`.
- Один игрок не может быть назначен на два места в рамках одного ивента.

## Review Focus
1. Игрок с дефицитом меньше награды за место не назначается на это место, даже если он явно указал его в заявке.
2. Пользователь со статусом `is_approved = 0` не может получить доступ к API или войти в личный кабинет до одобрения Р4/Р5.
3. Рядовой (Р3) получает 403 Forbidden при попытке запросить чужой профиль игрока, список игроков или изменить настройки ивента.
4. Конкуренция заявок: при наличии двух валидных заявок на 1-е место приоритет получает игрок с наибольшим дефицитом купонов.
5. Игрок, уступивший в борьбе за 1-е место, рассматривается алгоритмом на более низкие места (2-е, 3-е...), если его дефицит удовлетворяет условиям.

---

### Task 1: Алгоритм автоподбора с учетом заявок в `logic.js`

**Files:**
- Modify: `logic.js:330-410`
- Test: `logic.test.js`

**Interfaces:**
- Consumes: `calculateOfficerDeficit(officer, catalogItem, sector, includeStock)`
- Produces: `smartAutoPickWithRegistrations({ event, candidates, registrations }) -> { assignments: Array<{ slotIndex: number, place: number, playerId: number, officerId: string, coupons: number, deficit: number }>, unassignedCandidates: Array<any> }`

- [ ] **Step 1: Написать падающий тест для `smartAutoPickWithRegistrations` в `logic.test.js`**

```javascript
test('smartAutoPickWithRegistrations assigns applicant to requested place and falls back on tie-break', () => {
  const event = {
    places: [
      { place: 1, label: '1 место', coupons: 12500 },
      { place: 2, label: '2 место', coupons: 6500 },
    ]
  };
  const candidates = [
    { playerId: 1, playerName: 'Игрок 1', officerId: 'o1', deficitCoupons: 15000, killPoints: 100 },
    { playerId: 2, playerName: 'Игрок 2', officerId: 'o2', deficitCoupons: 25000, killPoints: 50 },
    { playerId: 3, playerName: 'Игрок 3', officerId: 'o3', deficitCoupons: 20000, killPoints: 80 },
  ];
  // Игрок 1 и Игрок 2 оба хотят 1 место. У Игрока 2 дефицит 25 000 > 15 000, он должен занять 1 место.
  // Игрок 1 должен опуститься на 2 место (дефицит 15000 >= 6500).
  const registrations = [
    { playerId: 1, officerId: 'o1', desiredPlace: 1 },
    { playerId: 2, officerId: 'o2', desiredPlace: 1 },
  ];

  const result = smartAutoPickWithRegistrations({ event, candidates, registrations });
  assert.equal(result.assignments.length, 2);
  assert.equal(result.assignments[0].playerId, 2); // 1 место
  assert.equal(result.assignments[1].playerId, 1); // 2 место fallback
});
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Команда: `/opt/homebrew/bin/node logic.test.js`  
Ожидаемый результат: FAIL ("smartAutoPickWithRegistrations is not a function")

- [ ] **Step 3: Реализовать `smartAutoPickWithRegistrations` в `logic.js`**

Логика:
1. Создать карту заявок `regMap` по `playerId`.
2. Разделить кандидатов по группам приоритета для каждого слота:
   - Группа 1: заявившиеся на конкретное место (`desiredPlace === place.place`), отсортированные по дефициту убывающе (`deficitCoupons` DESC), затем по `killPoints` DESC.
   - Группа 2: заявившиеся на «Любое подходящее» (`desiredPlace === 0`), отсортированные по дефициту убывающе.
   - Группа 3: заявившиеся на более высокое место, не получившие его (fallback), если дефицит `>= place.coupons`.
   - Группа 4: незаявившиеся кандидаты с достаточным дефицитом (`deficitCoupons >= place.coupons`), отсортированные по дефициту убывающе.
3. Пройти по слотам и назначить кандидатов без повторения `playerId`.

- [ ] **Step 4: Запустить тесты и убедиться, что они проходят**

Команда: `/opt/homebrew/bin/node logic.test.js`  
Ожидаемый результат: Все 19 тестов проходят успешно (PASS).

- [ ] **Step 5: Закоммитить изменения**

```bash
git add logic.js logic.test.js
git commit -m "feat: add smartAutoPickWithRegistrations algorithm with priority and fallback"
```

---

### Task 2: Модуль базы данных SQLite и авторизации (`db.js`, `db.test.js`)

**Files:**
- Create: `db.js`
- Create: `db.test.js`
- Modify: `package.json`

**Interfaces:**
- Consumes: `node:sqlite`, `node:crypto`, `logic.js` (DEFAULT_OFFICERS)
- Produces:
  - `initDb(filePath)` -> DatabaseSync instance
  - `hashPassword(password)` -> string
  - `verifyPassword(password, hash)` -> boolean
  - `createSession(userId)` -> token
  - `verifySession(token)` -> user | null
  - `importKowJson(jsonData)` -> void
  - `exportKowJson()` -> object
  - User and Player CRUD methods

- [ ] **Step 1: Написать тесты для слоя базы данных в `db.test.js`**

```javascript
test('db initializes tables, seeds admin user and handles registration approval', () => {
  const dbModule = require('./db.js');
  const db = dbModule.initDb(':memory:');
  
  // Проверка авто-бутстрапа админа
  const admin = dbModule.findUserByUsername('admin');
  assert(admin);
  assert.equal(admin.rank, 'r5');
  assert.equal(admin.is_approved, 1);

  // Регистрация нового игрока
  const regResult = dbModule.registerUser({ username: 'shkiper', password: 'password123', playerName: 'Шкипер' });
  assert.equal(regResult.is_approved, 0);

  // Попытка входа до одобрения
  const loginBefore = dbModule.loginUser('shkiper', 'password123');
  assert.equal(loginBefore.error, 'PENDING_APPROVAL');

  // Одобрение чиновником
  dbModule.approveUser(regResult.userId, 'r3');
  const loginAfter = dbModule.loginUser('shkiper', 'password123');
  assert(loginAfter.token);
  assert.equal(loginAfter.user.rank, 'r3');
});
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Команда: `/opt/homebrew/bin/node db.test.js`  
Ожидаемый результат: FAIL ("Cannot find module './db.js'")

- [ ] **Step 3: Реализовать `db.js` с использованием `node:sqlite` и `node:crypto`**

Создать таблицы: `users`, `players`, `player_officers`, `officer_catalog`, `event_types`, `events`, `event_registrations`, `stock_history`, `sessions`.  
Реализовать функции бутстрапа, регистрации, проверки хэша паролей (scrypt), генерации токенов сессий, импорта и экспорта JSON `kow_v2`.

- [ ] **Step 4: Запустить тесты и убедиться, что они проходят**

Команда: `/opt/homebrew/bin/node db.test.js`  
Ожидаемый результат: PASS

- [ ] **Step 5: Закоммитить изменения**

```bash
git add db.js db.test.js
git commit -m "feat: add SQLite database layer, auth helpers and session management"
```

---

### Task 3: Серверный REST API и Middleware разграничения прав (`server.js`, `api.test.js`)

**Files:**
- Create: `server.js`
- Create: `api.test.js`
- Create: `package.json`

**Interfaces:**
- Consumes: `db.js`, `logic.js`, `node:http`
- Produces: HTTP API server serving static assets and JSON endpoints (`/api/*`)

- [ ] **Step 1: Написать интеграционные тесты для API в `api.test.js`**

```javascript
test('API enforces RBAC and registration flow', async () => {
  const { startServer } = require('./server.js');
  const server = await startServer({ port: 0, dbPath: ':memory:' });
  const baseUrl = `http://localhost:${server.address().port}`;

  // 1. Логин под admin (R5)
  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' })
  });
  const { token: adminToken } = await loginRes.json();
  assert(adminToken);

  // 2. Регистрация нового участника
  const regRes = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'soldier', password: 'pass', playerName: 'Солдат' })
  });
  const regData = await regRes.json();
  assert.equal(regData.pendingApproval, true);

  // 3. R5 видит заявку в pending и утверждает её
  const pendingRes = await fetch(`${baseUrl}/api/users/pending`, {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  const pendingList = await pendingRes.json();
  assert(pendingList.some(u => u.username === 'soldier'));

  await server.close();
});
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Команда: `/opt/homebrew/bin/node api.test.js`  
Ожидаемый результат: FAIL ("Cannot find module './server.js'")

- [ ] **Step 3: Реализовать `server.js`**

1. Роутер и парсер JSON/URL-параметров.
2. Middleware аутентификации `authenticate`: проверка Bearer-токена, прикрепление `req.user` к запросу.
3. Middleware авторизации `requireRole(['r4', 'r5'])`.
4. Реализация эндпоинтов:
   - `/api/auth/register`, `/api/auth/login`, `/api/auth/logout`, `/api/auth/me`
   - `/api/users/pending`, `/api/users/:id/approve`, `/api/users/:id/reject`
   - `/api/my-profile`, `/api/my-profile/officers`
   - `/api/events`, `/api/events/:id/register`, `/api/events/:id/autopick`
   - `/api/players`, `/api/catalog`, `/api/admin/import`, `/api/admin/export`
5. Раздача статических файлов (`index.html`, `app.js`, `style.css`, `logic.js`).

- [ ] **Step 4: Запустить тесты API**

Команда: `/opt/homebrew/bin/node api.test.js`  
Ожидаемый результат: PASS

- [ ] **Step 5: Закоммитить изменения**

```bash
git add server.js api.test.js package.json
git commit -m "feat: add REST API server with RBAC authentication and endpoints"
```

---

### Task 4: Фронтенд — Авторизация, Сессии и Адаптивная навигация (`index.html`, `app.js`, `style.css`)

**Files:**
- Modify: `index.html:15-80`
- Modify: `app.js:1-250`
- Modify: `style.css:1-120`

**Interfaces:**
- Consumes: `/api/auth/*`, `/api/users/pending`
- Produces:
  - Auth Modal / Screen (Вход / Регистрация)
  - Profile indicator в Topbar (`[Р5] Ник` + Выход)
  - Динамическое боковое меню под текущую роль (`r5`, `r4`, `r3`)
  - Экран «Заявки на регистрацию» для Р4/Р5 с кнопками «Одобрить» / «Отклонить»

- [ ] **Step 1: Добавить верстку модального окна входа/регистрации и бейджа пользователя в `index.html`**

Добавить модальное окно авторизации с переключением табов «Вход» и «Регистрация» (с выбором персонажа из списка гильдии или вводом нового). В topbar добавить контейнер профиля пользователя с кнопкой «Выйти».

- [ ] **Step 2: Добавить стили для экрана авторизации и бейджа профиля в `style.css`**

Стилизовать формы входа/регистрации, бейджи статуса ожидания (`badge-pending`), плашку профиля и счетчик уведомлений о новых заявках (`badge-alert`).

- [ ] **Step 3: Интегрировать логику авторизации и смены роли в `app.js`**

1. Хранение токена сессии в `localStorage.getItem('kow_token')`.
2. Функция `apiFetch(url, options)` для автоматической подстановки `Authorization: Bearer <token>` и перехвата 401 (вызов окна входа).
3. При загрузке страницы: запрос `/api/auth/me`. Если не авторизован — открыть форму входа.
4. При авторизации: отрисовать пункты меню в соответствии с ролью:
   - Р3 видит: «Мой кабинет», «Календарь ивентов», «Персональный калькулятор».
   - Р4/Р5 видят: «Календарь», «Игроки», «Офицеры», «Типы ивентов», «Калькулятор», «Заявки на регистрацию» (колокольчик), «Пользователи» (Р5).
5. Экран «Заявки на регистрацию»: список заявок со статусом `pending` и кнопками «Одобрить (Р3)», «Одобрить (Р4)», «Отклонить».

- [ ] **Step 4: Проверить синтаксис и запуск приложения**

Команда: `/opt/homebrew/bin/node -c app.js`  
Ожидаемый результат: Без синтаксических ошибок.

- [ ] **Step 5: Закоммитить изменения**

```bash
git add index.html app.js style.css
git commit -m "feat: add frontend auth screen, session handling and role-based navigation"
```

---

### Task 5: Фронтенд — Личный кабинет (Р3) и Регистрация на ивенты (`app.js`, `index.html`, `style.css`)

**Files:**
- Modify: `index.html`
- Modify: `app.js`
- Modify: `style.css`

**Interfaces:**
- Consumes: `/api/my-profile`, `/api/events/:id/register`, `/api/events/:id/autopick`
- Produces:
  - Раздел «Мой кабинет» (`renderMyCabinet`): карточки офицеров, уровни, звёзды, запасы, симулятор.
  - Кнопка и модальное окно «Зарегистрироваться на ивент» в календаре.
  - Блок поданных заявок и кнопка «Автоподбор с учетом заявок» в модальном окне редактирования ивента у Р4/Р5.

- [ ] **Step 1: Реализовать рендеринг страницы «Мой кабинет» в `app.js`**

1. Загрузка данных через `/api/my-profile`.
2. Блок редактирования сектора (VIP, Секретность, Мощь, Киллы) с сохранением через `PUT /api/my-profile`.
3. Блок запасов (купоны, золотые пазлы, сундуки выбора) с кнопками быстрого обновления.
4. Список офицеров игрока: интерактивные звёзды (с подсказкой недостающих звёзд), уровень, купоны на уровне, оставшийся дефицит.
5. Кнопка «Добавить офицера» (выбор из каталога).
6. Персональный симулятор прокачки до 180 уровня для текущего игрока.

- [ ] **Step 2: Реализовать регистрацию на ивент для рядовых игроков (Р3)**

1. В карточке предстоящего ивента отображать кнопку «Зарегистрироваться на ивент» (или «Изменить заявку», если заявка уже подана).
2. Модальное окно заявки: выбор своего офицера и желаемого места (`🥇 1 место`, `🥈 2 место`, `🥉 3 место`, `🎖️ 4–10 место` или `Любое подходящее`).
3. Подсказка о возможном перерасходе: если дефицит выбранного офицера меньше награды за место, показывать предупреждение.
4. Отправка на бэкенд через `POST /api/events/:id/register`.

- [ ] **Step 3: Интегрировать учет заявок и автоподбор в модальное окно ивента для Р4/Р5**

1. В модальном окне редактирования ивента добавить блок «Поданные заявки (X)».
2. Кнопка «Автоподбор с учетом заявок» вызывает `POST /api/events/:id/autopick`.
3. Заполненные назначения подсвечивают бейджем: `Заявка учтена` (если игрок подавал заявку на это место).

- [ ] **Step 4: Проверить синтаксис и запустить тесты логики**

Команда: `/opt/homebrew/bin/node -c app.js && /opt/homebrew/bin/node logic.test.js`  
Ожидаемый результат: Все тесты проходят успешно.

- [ ] **Step 5: Закоммитить изменения**

```bash
git add app.js index.html style.css
git commit -m "feat: add player cabinet UI, event registration modal and auto-pick integration"
```

---

### Task 6: Dockerfile, Docker Compose и Финальная верификация

**Files:**
- Create: `Dockerfile`
- Create: `docker-compose.yml`
- Create: `.dockerignore`
- Modify: `readme.md`

**Interfaces:**
- Consumes: `server.js`, `db.js`, `logic.js`, `./data`
- Produces: Ready-to-run Docker container exposing port 3000 with volume persistence.

- [ ] **Step 1: Создать `Dockerfile`**

```dockerfile
FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev || npm install --omit=dev

COPY . .

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

VOLUME ["/app/data"]

CMD ["node", "server.js"]
```

- [ ] **Step 2: Создать `docker-compose.yml` и `.dockerignore`**

```yaml
version: '3.8'

services:
  kow-tracker:
    build: .
    container_name: kow_tracker
    restart: unless-stopped
    ports:
      - "3000:3000"
    volumes:
      - ./data:/app/data
    environment:
      - NODE_ENV=production
      - PORT=3000
```

- [ ] **Step 3: Обновить документацию в `readme.md`**

Добавить разделы:
1. Запуск через Docker Compose (`docker compose up -d`).
2. Локальный запуск без Docker (`node server.js`).
3. Начальный доступ (логин `admin`, пароль `admin123`).
4. Инструкция по саморегистрации игроков и подтверждению чиновниками (Р4/Р5).

- [ ] **Step 4: Провести комплексную проверку всех тестов**

Команда: `/opt/homebrew/bin/node logic.test.js && /opt/homebrew/bin/node db.test.js && /opt/homebrew/bin/node api.test.js`  
Ожидаемый результат: Все unit- и integration-тесты успешно пройдены.

- [ ] **Step 5: Закоммитить изменения**

```bash
git add Dockerfile docker-compose.yml .dockerignore readme.md
git commit -m "feat: add Docker and docker-compose deployment configuration and instructions"
```
