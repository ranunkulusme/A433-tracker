# Секторы (1:N к Пользователям) и декомпозиция управления офицерами — План реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Реализовать модель владения несколькими секторами (базами) одним пользователем (1:N), переименовать сущность «Игрок» в «Сектор», декомпозировать тяжелое модальное окно карточки сектора с точечным управлением офицерами и поддержать регистрацию нескольких баз на ивенты.

**Architecture:** 
1. **База данных (`db.js`):** колонка `players.user_id REFERENCES users(id)` с автомиграцией существующих данных; колонка `users.player_id` сохраняется как указатель на текущий активный сектор пользователя.
2. **REST API (`server.js`):** `/api/my-profile` возвращает массив секторов пользователя с сохранением обратной совместимости полей активного сектора; унифицированный `PUT /api/players/:id` с RBAC-проверкой владения для Р3; точечные эндпоинты офицеров `/api/players/:id/officers`; мульти-регистрация на ивенты с `sectorId`; доступ к `GET /api/users` для `['r4', 'r5']`.
3. **UI (`app.js`, `index.html`, `style.css`):** переименование термина «Игрок» в «Сектор»; селектор активного сектора в «Моем кабинете»; компактное модальное окно добавления/редактирования офицеров прямо в карточке сектора; выбор сектора в модалке регистрации на ивенты.

**Tech Stack:** Node.js (нативные `node:http`, `node:sqlite`, `node:crypto`), Vanilla JavaScript (ES6+), HTML5, CSS3, TDD (node native test asserts). Нулевые внешние npm-зависимости.

**Spec:** [docs/superpowers/specs/2026-10-26-sectors-and-officer-management-design.md](file:///Users/ranunkulus/Downloads/KOW/docs/superpowers/specs/2026-10-26-sectors-and-officer-management-design.md)

## Global Constraints

- Zero external npm dependencies: бэкенд использует исключительно нативные возможности Node.js.
- GitFlow: разработка в ветке `feature/sectors-and-officer-management`, слияние в `master` исключительно через `release/v3.4.0` с флагом `--no-ff` и аннотированным тегом версии `v3.4.0`.
- TDD: сначала падающий тест (RED), затем минимальный код (GREEN) для каждого шага.
- 100% обратная совместимость структуры данных с бэкапами и локальным хранилищем (`kow_v2`).
- Язык общения и интерфейса — русский.

## Review Focus

1. **Регистрация без сектора («Сделать позже»):** пользователь создается с `player_id = NULL` и 0 секторов. Проверить, что вход, `/api/my-profile` и интерфейс показывают приветственный empty-state с кнопкой «Создать сектор», не выбрасывая ошибок `Cannot read properties of undefined`.
2. **RBAC безопасность при обновлении сектора:** проверить, что Р3 может обновлять только свой сектор через `PUT /api/players/:id`, попытка обновить чужой сектор возвращает `403 Forbidden`, а поля `rank`, `id`, `user_id` невозможно подделать через тело запроса.
3. **Мульти-регистрация на ивенты:** проверить, что пользователь с 2 секторами (мейн и ферма) может зарегистрировать обе базы на один и тот же ивент на разные места, и обе заявки возвращаются в `myRegistrations`.
4. **Персистентность активного сектора:** переключение активного сектора в кабинете через `POST /api/my-profile/active-sector` обновляет `users.player_id` в SQLite и сохраняется после перезагрузки страницы или оффлайн-гидратации.
5. **Декомпозиция карточки сектора:** добавление, редактирование уровня/купонов/навыков и удаление конкретного офицера через точечные эндпоинты корректно обновляет состояние без перезагрузки и не ломает подсчет дефицита и звезд.

---

### Task 1: Слой базы данных SQLite (`db.js`) и модульные тесты (`db.test.js`)

**Files:**
- Modify: `db.js:1020-1060`, `db.js:250-360`, `db.js:80-140`
- Modify: `db.test.js`

**Requirements:**
- Добавить в `migrateSchema(db)` добавление колонки `user_id INTEGER NULL REFERENCES users(id) ON DELETE SET NULL` в таблицу `players`.
- Добавить миграцию существующих связей: если у пользователя в таблице `users` указан `player_id`, проставить `UPDATE players SET user_id = u.id WHERE id = u.player_id AND user_id IS NULL`.
- Сохранить `users.player_id` как указатель на текущий активный сектор пользователя.
- В выборках `getPlayers()` и `getPlayerById(id)` делать `LEFT JOIN users u ON u.id = p.user_id`, возвращая `userId`, `username`, `userRank`.
- Добавить метод `getPlayersByUserId(userId)` (возвращает массив всех секторов пользователя).
- Добавить метод `setUserActiveSector(userId, sectorId)`: проверяет, что сектор принадлежит пользователю, и обновляет `users.player_id = sectorId`.
- Обновить `updatePlayer(id, updates)`: поддержать обновление `user_id` (привязка/отвязка владельца).
- Обновить `registerUser({ username, password, playerName, playerId })`:
  - Если `playerName` пустой и `playerId` не указан: создается только пользователь (`is_approved = 0` или `1` для первого), `player_id = NULL`.
  - Если `playerName` передан: сначала создается пользователь, затем создается сектор с `user_id = userId`, а `users.player_id` обновляется на ID созданного сектора.
- Экспорт функций: `getPlayersByUserId`, `setUserActiveSector`.

**Steps:**
- [ ] **Step 1 (RED):** Добавить тесты в `db.test.js`:
  - Проверка наличия колонки `user_id` в таблице `players` и миграции связей.
  - Проверка выборки `getPlayers()` и `getPlayerById()` с полями `userId`, `username`, `userRank`.
  - Проверка метода `getPlayersByUserId(userId)` для пользователя с 2 секторами.
  - Проверка `setUserActiveSector(userId, sectorId)`.
  - Проверка регистрации пользователя без сектора («Сделать позже») и с созданием сектора.
  - Проверка привязки владельца через `updatePlayer(id, { userId })`.
- [ ] **Step 2:** Запустить тесты `node db.test.js` и убедиться, что они падают (RED).
- [ ] **Step 3 (GREEN):** Реализовать миграцию, выборки секторов, методы `getPlayersByUserId`, `setUserActiveSector`, обновление владельца и регистрацию в `db.js`.
- [ ] **Step 4:** Запустить `node db.test.js && node logic.test.js`, убедиться в успешном прохождении всех тестов (0 failures).
- [ ] **Step 5:** Проверить синтаксис `node -c db.js`.
- [ ] **Step 6:** Закоммитить:
  `git add db.js db.test.js`
  `git commit -m "feat(db): add player user_id migration, sector ownership queries and active sector setter"`

---

### Task 2: REST API серверного слоя (`server.js`) и интеграционные тесты (`api.test.js`)

**Files:**
- Modify: `server.js:320-400`, `server.js:500-560`, `server.js:690-730`
- Modify: `api.test.js`

**Requirements:**
- **`/api/my-profile`:**
  - `GET`: возвращает `{ user, sectors: [...], activeSectorId, sector, stock, officers }`. Если у пользователя нет секторов, `sectors: []`, `activeSectorId: null`, `sector: null`.
  - `POST /api/my-profile/active-sector`: принимает `{ sectorId }`. Проверяет принадлежность сектора текущему пользователю (`sector.userId === req.user.id`). Обновляет активный сектор через `db.setUserActiveSector`.
- **`POST /api/my-sectors`:**
  - Создает новый сектор для текущего пользователя (`user_id = req.user.id`).
  - Принимает `{ name, realName, sector, stock }`.
  - Если у пользователя не было активного сектора, устанавливает созданный сектор активным.
- **Унифицированный `PUT /api/players/:id`:**
  - Разрешить доступ для:
    1) Р4/Р5 (полный доступ, включая изменение `userId`, `rank`).
    2) Р3 владельца сектора (`player.userId === req.user.id`).
  - Для Р3: санитизировать тело запроса, запретив изменение `userId`, `rank`, `id`.
  - Если Р3 пытается обновить чужой сектор — возвращать `403 FORBIDDEN`.
- **Точечный CRUD офицеров сектора:**
  - `POST /api/players/:id/officers`: добавление офицера. Разрешено владельцу сектора (Р3) и Р4/Р5.
  - `PUT /api/players/:id/officers/:offId`: обновление офицера (уровень, купоны, звезды, навыки). Разрешено владельцу и Р4/Р5.
  - `DELETE /api/players/:id/officers/:offId`: удаление офицера. Разрешено владельцу и Р4/Р5.
- **Мульти-регистрация на ивенты:**
  - `POST /api/events/:id/register`: принимает `{ officerId, desiredPlace, sectorId }`. Если `sectorId` опущен, берется активный сектор пользователя. Проверка прав владения сектором.
  - `DELETE /api/events/:id/register`: принимает `sectorId` (через query или body). Удаляет регистрацию конкретного сектора.
  - `GET /api/events`: в дополнение к `myRegistration` активного сектора возвращает `myRegistrations: [...]` для всех секторов текущего пользователя.
- **Доступ к пользователям:**
  - `GET /api/users`: расширить проверку прав на `requireRole(['r4', 'r5'])`.

**Steps:**
- [ ] **Step 1 (RED):** Добавить интеграционные тесты в `api.test.js`:
  - `GET /api/my-profile` возвращает массив `sectors` и `activeSectorId`.
  - `POST /api/my-profile/active-sector` переключает активный сектор.
  - `POST /api/my-sectors` создает базу для пользователя и связывает с его `userId`.
  - `PUT /api/players/:id` позволяет владельцу (Р3) менять параметры сектора, но запрещает менять чужой сектор и блокирует смену `rank`/`userId`.
  - Точечные эндпоинты офицеров (`POST`, `PUT`, `DELETE /api/players/:id/officers/:offId`).
  - Мульти-регистрация двух секторов одного пользователя на ивент.
  - `GET /api/users` доступен для Р4.
- [ ] **Step 2:** Запустить `node api.test.js` и убедиться, что новые тесты падают (RED).
- [ ] **Step 3 (GREEN):** Реализовать обработчики эндпоинтов в `server.js`.
- [ ] **Step 4:** Запустить `node api.test.js && node db.test.js && node logic.test.js` (GREEN).
- [ ] **Step 5:** Проверить синтаксис `node -c server.js`.
- [ ] **Step 6:** Закоммитить:
  `git add server.js api.test.js`
  `git commit -m "feat(api): add multi-sector profile, sector officers crud and event multi-registration"`

---

### Task 3: Клиентская логика оффлайн-мутаций и outbox (`logic.js`, `logic.test.js`)

**Files:**
- Modify: `logic.js`
- Modify: `logic.test.js`

**Requirements:**
- Обновить `isOfflineMutationAllowed(method, pathname)`:
  - Разрешить мутации сектора: `PUT` на `/api/players/:id` (цифровой ID).
  - Разрешить точечные офицерские операции: `POST /api/players/:id/officers`, `PUT /api/players/:id/officers/:offId`, `DELETE /api/players/:id/officers/:offId`.
  - Разрешить переключение активного сектора: `POST /api/my-profile/active-sector`.
  - Разрешить создание сектора: `POST /api/my-sectors`.
- Добавить чистые вспомогательные функции:
  - `findActiveSector(sectors, activeSectorId)`: безопасно возвращает сектор по ID или первый из массива.
  - `formatSectorTitle(sector)`: форматирует строку сектора для селектора (например, `"[A433]ranu (VIP 12 · 157.6M)"`).
- Покрыть новыми тестами в `logic.test.js`.

**Steps:**
- [ ] **Step 1 (RED):** Написать падающие тесты в `logic.test.js` для оффлайн-разрешений новых эндпоинтов и хелперов секторов.
- [ ] **Step 2:** Запустить `node logic.test.js` (RED).
- [ ] **Step 3 (GREEN):** Реализовать логику в `logic.js`.
- [ ] **Step 4:** Запустить `node logic.test.js` (GREEN).
- [ ] **Step 5:** Проверить синтаксис `node -c logic.js`.
- [ ] **Step 6:** Закоммитить:
  `git add logic.js logic.test.js`
  `git commit -m "feat(logic): support sector and officer offline mutations and sector formatting helpers"`

---

### Task 4: UI терминология «Секторы», список баз и регистрация (`index.html`, `style.css`, `app.js`)

**Files:**
- Modify: `index.html`
- Modify: `style.css`
- Modify: `app.js:750-930`, `app.js:2700-2800`

**Requirements:**
- **Терминология:**
  - В боковом меню: «👥 Игроки» ➔ «🏰 Секторы» (`nav-sectors`).
  - Заголовки экранов и фильтров обновлены на «Секторы».
- **Таблица секторов (`renderPlayers` / `renderSectors`):**
  - Добавить колонку «Владелец»:
    - Если привязан пользователь: кликабельный бейдж `👤 @username`.
    - Если сектор свободен: неяркий бейдж `Без владельца`.
- **Регистрация нового пользователя (`#modal-auth`):**
  - Убрать выпадающий список чужих персонажей (`#auth-reg-player-select`).
  - Сделать поле «Название сектора (базы в игре)» опциональным.
  - Добавить подсказку: *«Опционально. Вы можете указать игровой ник сейчас или создать базу позже в личном кабинете»*.
  - Если поле пустое, отправлять регистрацию без `playerName` и `playerId`.
- **Стилизация:**
  - Добавить CSS-классы для бейджей владельца (`.badge-owner`, `.badge-no-owner`) и разметки секторов в `style.css`.

**Steps:**
- [ ] **Step 1:** Обновить верстку навигации и модального окна регистрации в `index.html`.
- [ ] **Step 2:** Добавить стили в `style.css`.
- [ ] **Step 3:** Обновить логику отправки формы регистрации и рендеринга таблицы секторов в `app.js`.
- [ ] **Step 4:** Проверить синтаксис `node -c app.js` и отсутствие регрессий `npm test`.
- [ ] **Step 5:** Закоммитить:
  `git add index.html style.css app.js`
  `git commit -m "feat(ui): rename players to sectors, add owner column and optional sector on registration"`

---

### Task 5: UI Личного кабинета со свитчером секторов и ивенты (`app.js`, `index.html`, `style.css`)

**Files:**
- Modify: `index.html`
- Modify: `style.css`
- Modify: `app.js:1250-1750`, `app.js:2350-2690`

**Requirements:**
- **Личный кабинет (`renderMyCabinet`):**
  - В шапке кабинета рендерить плашку свитчера секторов:
    - Выпадающий список всех баз пользователя с названием и силой.
    - Кнопка `+ Добавить сектор` (открывает `#modal-add-sector`).
  - При переключении селектора: вызывать `POST /api/my-profile/active-sector` и перезагружать данные кабинета под выбранный сектор.
  - Если у пользователя нет ни одного сектора (регистрация «Сделать позже»):
    - Отображать информативный приветственный блок: *«У вас пока нет добавленных секторов. Добавьте свою первую базу для отслеживания прокачки и участия в ивентах!»* и кнопку `🏰 Создать первый сектор`.
  - Модальное окно создания сектора `#modal-add-sector`: форма с полями Название базы, реальное имя, VIP, мощь, киллы. Отправляет `POST /api/my-sectors`.
- **Регистрация на ивенты (`#modal-event-register`):**
  - Если у пользователя > 1 сектора, показывать выпадающий список: `🏰 Сектор для участия`.
  - Список офицеров фильтровать по выбранному сектору.
  - В карточке ивента и календаре рендерить плашки всех поданных заявок пользователя (`myRegistrations`).

**Steps:**
- [ ] **Step 1:** Добавить разметку модального окна `#modal-add-sector` в `index.html`.
- [ ] **Step 2:** Добавить CSS-стили для свитчера секторов и селектора баз в `style.css`.
- [ ] **Step 3:** Реализовать логику переключения секторов, создание сектора и мульти-регистрацию на ивенты в `app.js`.
- [ ] **Step 4:** Проверить синтаксис `node -c app.js` и запустить `npm test`.
- [ ] **Step 5:** Закоммитить:
  `git add index.html style.css app.js`
  `git commit -m "feat(ui): add sector switcher in cabinet and multi-sector event registrations"`

---

### Task 6: Декомпозиция карточки сектора и точечное управление офицерами (`app.js`, `index.html`, `style.css`)

**Files:**
- Modify: `index.html`
- Modify: `style.css`
- Modify: `app.js:2780-2950`, `app.js:3460-3670`

**Requirements:**
- **Декомпозиция карточки сектора (`renderPlayerDetail` / `renderSectorDetail`):**
  - Шапка: название сектора, реальное имя, статы, кликабельный бейдж владельца. Для Р4/Р5 кнопка `Изменить владельца` (вызывает модалку смены владельца с выпадающим списком из `GET /api/users`).
  - Кнопка «Редактировать сектор» открывает `#modal-sector`, содержащий **только** общие статы базы (Ник, реальное имя, ранг, VIP, Конф, Сила, Киллы, Очки) и кнопку Smart Scanner. Блоки офицеров и склада из этого окна удалены.
  - Сохранение модалки сектора отправляет `PUT /api/players/:id`.
- **Управление офицерами в карточке сектора:**
  - В заголовке блока «Офицеры сектора»: кнопка `+ Добавить офицера` (открывает `#modal-add-sector-officer`).
  - В строке каждого офицера:
    - Интерактивные звёзды (клик обновляет звезды офицера через `PUT /api/players/:id/officers/:offId`).
    - Кнопка `✏️` — открывает компактное модальное окно `#modal-sector-officer` (редактирование уровня, купонов, навыков 1–4 конкретного офицера).
    - Кнопка `🗑️` — подтверждение и удаление офицера через `DELETE /api/players/:id/officers/:offId`.
- **Стилизация:**
  - Компактные модальные окна, аккуратные инлайн-кнопки управления.

**Steps:**
- [ ] **Step 1:** Добавить разметку модальных окон `#modal-sector-officer` и `#modal-add-sector-officer` в `index.html`. Очистить `#modal-player` от тяжелых блоков, переименовать в `#modal-sector`.
- [ ] **Step 2:** Добавить стили в `style.css`.
- [ ] **Step 3:** Реализовать точечные обработчики добавления, редактирования и удаления офицеров в `app.js`.
- [ ] **Step 4:** Проверить синтаксис `node -c app.js` и запустить все тесты `npm test`.
- [ ] **Step 5:** Закоммитить:
  `git add index.html style.css app.js`
  `git commit -m "feat(ui): decompose sector detail card with inline and point officer management"`

---

### Task 7: Финальная интеграция, Whole-Branch Review и релиз `v3.4.0` по GitFlow

**Files:**
- Modify: `package.json`
- Modify: `CHANGELOG.md`

**Requirements:**
- Полный прогон тестового набора (`npm test`).
- Запуск независимого субагента Whole-Branch Reviewer для инспекции полного дифа ветки `feature/sectors-and-officer-management`.
- Устранение найденных замечаний (если возникнут).
- Подготовка релиза по GitFlow:
  - Создание ветки `release/v3.4.0`.
  - Повышение версии в `package.json` до `3.4.0`.
  - Заполнение `CHANGELOG.md` по стандарту Keep a Changelog.
  - Прогон тестов на релизной ветке.
  - Слияние в `master` с флагом `--no-ff`.
  - Аннотированный тег `v3.4.0`.
  - Удаление временных веток.

**Steps:**
- [ ] **Step 1:** Запустить полный набор тестов: `npm test` и синтаксическую проверку всех файлов.
- [ ] **Step 2:** Запустить субагента Whole-Branch Reviewer для проверки ветки от базы `master`.
- [ ] **Step 3:** Если найдены замечания — исправить их, прогнать тесты и закоммитить.
- [ ] **Step 4:** Создать релизную ветку: `git checkout -b release/v3.4.0`.
- [ ] **Step 5:** Обновить версию в `package.json` на `3.4.0` и внести секцию `[3.4.0] - 2026-10-26` в `CHANGELOG.md`.
- [ ] **Step 6:** Закоммитить изменения релиза: `git commit -am "chore(release): prepare v3.4.0"`.
- [ ] **Step 7:** Прогнать тесты: `npm test`.
- [ ] **Step 8:** Влить в `master`:
  `git checkout master && git merge --no-ff release/v3.4.0 -m "Merge branch 'release/v3.4.0' into master"`
- [ ] **Step 9:** Поставить аннотированный тег:
  `git tag -a v3.4.0 -m "Release v3.4.0: Sectors 1:N multi-account support and decomposed officer management"`
- [ ] **Step 10:** Удалить временные ветки `feature/sectors-and-officer-management` и `release/v3.4.0`.
