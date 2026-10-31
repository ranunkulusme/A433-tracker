# План реализации: Делегирование прав доступа Р4/Р5 рядовым игрокам (Р3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Реализовать возможность лидеру альянса (Р5) выборочно делегировать права доступа к закрытым разделам и данным (секторы, склады, матрица гильдии, управление ивентами и автоподбор, каталог офицеров, одобрение новичков) конкретным пользователям через удобный интерфейс с чекбоксами категорий и быстрыми шаблонами пресетов.

**Architecture:** Добавление поля `permissions` в таблицу `users` SQLite с безопасной миграцией. Реализация чистых функций проверки прав и пресетов в `logic.js`. Серверная авторизация с Zero Trust маскированием складов в `server.js`. Фронтенд-интерфейс управления правами для Р5 и динамическая адаптация сайдбара и разделов для уполномоченных пользователей Р3 в `app.js`.

**Tech Stack:** Node.js (`node:http`, `node:sqlite`, `node:crypto`), Vanilla JS, HTML5, CSS3, TDD (`logic.test.js`, `db.test.js`, `api.test.js`).

**Spec:** `docs/superpowers/specs/2026-10-31-delegated-permissions-design.md`

## Global Constraints

- Zero external npm dependencies on server (нативные модули Node.js).
- База данных SQLite в `data/kow.db` (безопасная миграция `ALTER TABLE users ADD COLUMN permissions TEXT NOT NULL DEFAULT '[]'`).
- 100% обратная совместимость со старыми JSON-бэкапами (`kow_v2`).
- Полное соблюдение GitFlow и TDD (RED -> GREEN).
- Весь интерфейс и сообщения строго на русском языке.

## Review Focus

- Чужой склад в `GET /api/players` и `GET /api/players/:id` должен быть полностью замаскирован нулями для Р3 без `view_stocks`, даже если есть `view_sectors`.
- Р3 с `view_sectors` не должен иметь права изменять или удалять чужие секторы (`PUT`, `DELETE`).
- Р3 с `approve_users` не должен иметь права одобрять новичков в ранг Р4 (только Р3).
- Р4 и Р5 по умолчанию сохраняют все права без необходимости явной выдачи прав в базе.
- Импорт старого бэкапа без `userPermissions` не должен сбрасывать права существующих пользователей.

---

### Task 1: Слой чистой логики разрешений и пресетов (`logic.js`, `logic.test.js`)

**Files:**
- Modify: `logic.js`
- Test: `logic.test.js`

**Interfaces:**
- Produces:
  - `USER_PERMISSIONS`: константа категорий разрешений (`VIEW_SECTORS`, `VIEW_STOCKS`, `VIEW_MATRIX`, `MANAGE_EVENTS`, `MANAGE_CATALOG`, `APPROVE_USERS`).
  - `PERMISSION_PRESETS`: константа пресетов (`ALL`, `ANALYTICS`, `TACTICIAN`, `HR`, `RESET`).
  - `hasUserPermission(user, permission): boolean`: чистая функция проверки разрешения.
  - `applyPermissionPreset(presetId): string[]`: чистая функция возврата списка прав для выбранного пресета.

- [ ] **Step 1: Написать падающие тесты в `logic.test.js`**

Добавить тесты проверки:
- Р5 имеет все права независимо от содержимого `permissions`.
- Р4 имеет все права по умолчанию.
- Р3 без `permissions` возвращает `false` для любого права.
- Р3 с конкретным правом в массиве `permissions` возвращает `true` только для него.
- `applyPermissionPreset` корректно возвращает массив прав для 'all', 'analytics', 'tactician', 'hr', 'reset'.

- [ ] **Step 2: Запустить тест и убедиться в падении (RED)**

Run: `node logic.test.js`
Expected: FAIL (функции `hasUserPermission` и константы не определены).

- [ ] **Step 3: Реализовать константы и функции в `logic.js`**

Добавить экспорт `USER_PERMISSIONS`, `PERMISSION_PRESETS`, `hasUserPermission`, `applyPermissionPreset` в UMD/модульный экспорт `logic.js`.

- [ ] **Step 4: Запустить тест и убедиться в успешном прохождении (GREEN)**

Run: `node logic.test.js`
Expected: PASS (все тесты logic проходят).

- [ ] **Step 5: Коммит**

Run:
```bash
git add logic.js logic.test.js
git commit -m "feat(logic): add user permissions constants, helper and preset resolver"
```

---

### Task 2: Слой базы данных SQLite (`db.js`, `db.test.js`)

**Files:**
- Modify: `db.js`
- Test: `db.test.js`

**Interfaces:**
- Consumes: `logic.USER_PERMISSIONS`
- Produces:
  - Миграция колонки `permissions` в `initDb()`.
  - `getUsers()`, `findUserById()`, `verifySession()` возвращают `permissions: string[]`.
  - `updateUser(userId, { permissions: string[] })` обновляет права в БД.
  - `exportKowJson()` экспортирует безопасную карту `userPermissions: { [username]: string[] }`.
  - `importKowJson(raw)` восстанавливает права пользователей по `userPermissions` без затрагивания паролей.

- [ ] **Step 1: Написать падающие тесты в `db.test.js`**

Добавить тесты:
- Миграция добавляет `permissions` со значением по умолчанию `[]`.
- `updateUser` сохраняет массив `permissions` и возвращает его распарсенным.
- `verifySession` возвращает `permissions` пользователя.
- `exportKowJson` включает `userPermissions`.
- `importKowJson` восстанавливает `permissions` для существующих пользователей и игнорирует отсутствующие без ошибок.

- [ ] **Step 2: Запустить тесты и убедиться в падении (RED)**

Run: `node db.test.js`
Expected: FAIL

- [ ] **Step 3: Реализовать миграцию и методы в `db.js`**

- В `initDb()` добавить проверку `PRAGMA table_info(users)` и `ALTER TABLE users ADD COLUMN permissions TEXT NOT NULL DEFAULT '[]';`.
- В запросах `findUserById`, `getUsers`, `getPendingUsers`, `verifySession` добавить `u.permissions` и парсинг `JSON.parse(row.permissions || '[]')`.
- В `updateUser` добавить обработку `updates.permissions`.
- В `exportKowJson` добавить `userPermissions`.
- В `importKowJson` добавить безопасное обновление прав существующих пользователей.

- [ ] **Step 4: Запустить тесты и убедиться в успешном прохождении (GREEN)**

Run: `node db.test.js && node logic.test.js`
Expected: PASS

- [ ] **Step 5: Коммит**

Run:
```bash
git add db.js db.test.js
git commit -m "feat(db): add permissions column migration, session lookup and safe backup roundtrip"
```

---

### Task 3: REST API серверного слоя и Zero Trust авторизация (`server.js`, `api.test.js`)

**Files:**
- Modify: `server.js`
- Test: `api.test.js`

**Interfaces:**
- Consumes: `logic.hasUserPermission`, `db.updateUser`, `db.getUsers`
- Produces:
  - Хелпер `requirePermission(req, res, perm)`.
  - Маскирование чужих складов в `GET /api/players` и `GET /api/players/:id`.
  - `checkSectorAccess`: чтение разрешено при `view_sectors`, запись строго закрыта.
  - Фильтрация чужих регистраций в `GET /api/events` при отсутствии `manage_events`.
  - Ограничение управления ивентами, каталогом, типами ивентов и одобрения новичков по соответствующим разрешениям.
  - Поддержка `PATCH /api/users/:id` с `{ permissions: [...] }` строго для Р5.

- [ ] **Step 1: Написать падающие интеграционные тесты в `api.test.js`**

Добавить тесты:
- Р3 без прав получает 403 на `GET /api/players`.
- Р3 с `view_sectors`, но без `view_stocks` получает список секторов с замаскированными складами чужих баз.
- Р3 с `view_sectors` может прочитать `GET /api/players/:id`, но не может сделать `PUT` чужого сектора (403).
- Р3 с `manage_events` может создавать ивенты и видит все регистрации сокланов.
- Р3 с `approve_users` может одобрять заявку новичка строго в ранг Р3 (попытка в Р4 дает 403).
- Р5 может обновлять permissions через `PATCH /api/users/:id`.

- [ ] **Step 2: Запустить интеграционные тесты и убедиться в падении (RED)**

Run: `node api.test.js`
Expected: FAIL

- [ ] **Step 3: Реализовать авторизацию и маскирование в `server.js`**

- Добавить `requirePermission(req, res, perm)`.
- Обновить `checkSectorAccess` и маскирование чужих складов в `GET /api/players` и `GET /api/players/:id`.
- Обновить фильтрацию регистраций в `GET /api/events` и `GET /api/events/:id`.
- Защитить эндпоинты событий, каталога, типов ивентов и одобрения новичков.
- В `PATCH /api/users/:id` добавить обработку `body.permissions`.

- [ ] **Step 4: Запустить интеграционные тесты и убедиться в успехе (GREEN)**

Run: `node api.test.js && node db.test.js && node logic.test.js`
Expected: PASS

- [ ] **Step 5: Коммит**

Run:
```bash
git add server.js api.test.js
git commit -m "feat(api): enforce permission-based RBAC and zero-trust stock masking"
```

---

### Task 4: Пользовательский интерфейс: модальное окно прав для Р5, динамический сайдбар и отображение страниц (`app.js`, `index.html`, `style.css`)

**Files:**
- Modify: `index.html`
- Modify: `style.css`
- Modify: `app.js`

**Interfaces:**
- Consumes: `logic.hasUserPermission`, `logic.PERMISSION_PRESETS`, `logic.USER_PERMISSIONS`, `/api/users/:id`
- Produces:
  - Модалка `#modal-user-permissions` с 6 чекбоксами и кнопками быстрых пресетов.
  - Кнопка `🛡️ Права` и бейджи прав в таблице пользователей Р5.
  - Динамическое отображение пунктов меню сайдбара в `renderSidebarNav()`.
  - Отображение/маскирование чужих складов в `canSeeStock()`.
  - Отображение кнопок управления ивентами и вкладки матрицы гильдии в зависимости от прав.

- [ ] **Step 1: Добавить разметку модального окна в `index.html`**

Добавить структуру `#modal-user-permissions`:
- Заголовок с никнеймом и рангом целевого пользователя.
- Панель кнопок быстрых пресетов (`⚡ Все`, `📊 Аналитика`, `🎯 Тактик`, `👥 Кадры`, `✕ Сбросить`).
- 6 чекбоксов с иконками и понятным описанием.
- Кнопки «Отмена» и «Сохранить права».

- [ ] **Step 2: Добавить стили в `style.css`**

- Стили для бейджей разрешений в таблице пользователей (`.badge-perm`).
- Стили для сетки чекбоксов и кнопок пресетов в модалке.

- [ ] **Step 3: Реализовать логику интерфейса в `app.js`**

- Реализовать клиентский хелпер `hasPermission(permission)`.
- Реализовать `openUserPermissionsModal(userId)`, применение пресетов `applyModalPreset(presetId)` и сохранение `submitUserPermissions()`.
- Обновить `renderUsersTable()` для отображения бейджей прав и кнопки настройки.
- Обновить `renderSidebarNav()`: показывать «Секторы», «Офицеры», «Типы ивентов», «Заявки» при наличии соответствующих прав.
- Обновить `canSeeStock(playerId)`: учитывать `hasPermission('view_stocks')`.
- Обновить `renderCalculator()`: открывать вкладку «📊 Сводная матрица гильдии» при наличии `view_matrix`.
- Обновить `renderCalendar()` и `renderEventDetail()`: отображать кнопки управления и автоподбора при наличии `manage_events`.

- [ ] **Step 4: Проверить синтаксис и полный прогон тестов**

Run: `node -c app.js && npm test`
Expected: 0 syntax errors, 100% тестов проходят.

- [ ] **Step 5: Коммит**

Run:
```bash
git add index.html style.css app.js
git commit -m "feat(ui): add permissions modal for R5 and dynamic permissions-based navigation"
```

---

### Task 5: Релизный цикл по GitFlow (Release v3.22.0)

- [ ] **Step 1: Создание релизной ветки `release/v3.22.0`**
- [ ] **Step 2: Обновление версии в `package.json` до 3.22.0 и заполнение `CHANGELOG.md`**
- [ ] **Step 3: Прогон полного набора тестов (`npm test`)**
- [ ] **Step 4: Слияние `--no-ff` в `main` и установка аннотированного тега `v3.22.0`**
- [ ] **Step 5: Удаление временных веток**
