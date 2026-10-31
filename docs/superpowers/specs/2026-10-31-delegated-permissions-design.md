# Спецификация: Делегирование прав доступа Р4/Р5 рядовым игрокам (Р3)

## 1. Контекст и цели (Intent & Why)

В игре Kiss of War / Sea War: Raid и в приложении KoW Tracker существует разделение на офицеров (Р4/Р5) и рядовых бойцов (Р3). Рядовые бойцы имеют доступ только к личному кабинету, подаче заявок на ивенты и персональному симулятору. В то же время альянсу требуются доверенные помощники из числа бойцов Р3 (например, военный тактик, кадровик или аналитик), которым лидер (Р5) доверяет аналитические или организационные задачи, но не планирует повышать их игровой ранг до Р4/Р5.

### Цель
Предоставить лидеру альянса (Р5) возможность выборочно делегировать права доступа к закрытым разделам и данным (секторы, склады, сводная матрица гильдии, управление ивентами и автоподбором, каталог офицеров, одобрение новичков) конкретным пользователям (включая Р3) через удобный интерфейс с чекбоксами и быстрыми шаблонами пресетов.

---

## 2. Цели, не-цели и анти-цели

### Цели (Goals)
1. **Гранулярный контроль:** Лидер (Р5) может включать/выключать 6 категорий разрешений для любого пользователя.
2. **Быстрые пресеты:** В интерфейсе настройки прав есть кнопки быстрой установки типовых ролей («Аналитика», «Ивенты», «Кадры», «Выбрать всё», «Сбросить»).
3. **Безопасность на бэкенде (Zero Trust):** Права проверяются на сервере Node.js в каждом REST API эндпоинте, а не только скрытием кнопок в UI. Чужие склады маскируются, если у пользователя нет права `view_stocks`.
4. **Бесшовная адаптация UI:** Для бойца Р3 с выданными правами сайдбар и страницы автоматически открывают соответствующие разделы.
5. **Обратная совместимость:** Пользователи Р4 и Р5 по умолчанию сохраняют полный доступ без необходимости ручной выдачи прав. Существующие дампы базы импортируются и экспортируются без ошибок.

### Не-цели (Non-Goals)
1. Делегирование роли самого лидера (Р5) — управление учетными записями, смена паролей и импорт базы остаются строго прерогативой Р5.
2. Создание произвольных пользовательских ролей помимо Р3/Р4/Р5.

### Анти-цели (Anti-Goals)
1. Утечка данных склада при частичном доступе (боец с доступом к секторам `view_sectors`, но без `view_stocks`, ни при каких обстоятельствах не должен получать цифры чужих складов через API ни в общем списке, ни в детальной карточке сектора).
2. Утечка паролей или учетных записей при экспорте игрового дампа `kow_v2`.
3. Поломка оффлайн-режима и локального кэша `kow_v2`.

---

## 3. Ограничения (Constraints)
- **Node.js**: нулевые внешние npm-зависимости (использование `node:http`, `node:sqlite`, `node:crypto`).
- **База данных**: SQLite `data/kow.db`, безопасная миграция таблицы `users` без потери данных.
- **GitFlow**: разработка в `feature/delegated-permissions`, стабилизация в `release/vX.Y.Z`, слияние `--no-ff` в `main` с тегом.
- **TDD**: 100% прохождение тестов (`npm test`: `logic.test.js`, `db.test.js`, `api.test.js`).
- **Язык**: весь интерфейс и системные сообщения строго на русском языке.

---

## 4. Рассмотренные подходы (Approaches)

1. **Подход 1: Только гранулярные чекбоксы.**
   - *Плюсы:* Максимальная гибкость.
   - *Минусы:* Требует кликать каждый чекбокс отдельно при частой настройке.
2. **Подход 2: Жесткие роли-шаблоны без чекбоксов.**
   - *Плюсы:* Назначение в 1 клик.
   - *Минусы:* Нельзя дать доступ к матрице без складов или к ивентам без секторов.
3. **Подход 3: Гибридный (Чекбоксы + Быстрые пресеты) — ВЫБРАН.**
   - *Плюсы:* Идеальный баланс. Лидер может настроить любую комбинацию чекбоксов или применить готовый пресет за 1 клик.

---

## 5. Архитектура и спецификация реализации

### 5.1. Реестр разрешений (Permissions Registry)

В `logic.js` фиксируется константа доступных разрешений:

```javascript
const USER_PERMISSIONS = {
  VIEW_SECTORS: 'view_sectors',     // Просмотр всех секторов и командиров альянса
  VIEW_STOCKS: 'view_stocks',       // Просмотр точных остатков складов других игроков
  VIEW_MATRIX: 'view_matrix',       // Доступ к сводной матрице гильдии в калькуляторе
  MANAGE_EVENTS: 'manage_events',   // Создание ивентов, конструктор сезонов, Smart AutoPick, все заявки
  MANAGE_CATALOG: 'manage_catalog', // Редактирование каталога офицеров, типов ивентов, VIP-тиров
  APPROVE_USERS: 'approve_users'    // Одобрение и отклонение заявок новичков на регистрацию
};

const PERMISSION_PRESETS = {
  ALL: {
    id: 'all',
    label: '⚡ Все права',
    permissions: ['view_sectors', 'view_stocks', 'view_matrix', 'manage_events', 'manage_catalog', 'approve_users']
  },
  ANALYTICS: {
    id: 'analytics',
    label: '📊 Аналитика',
    permissions: ['view_sectors', 'view_stocks', 'view_matrix']
  },
  TACTICIAN: {
    id: 'tactician',
    label: '🎯 Военный тактик',
    permissions: ['view_sectors', 'manage_events']
  },
  HR: {
    id: 'hr',
    label: '👥 Кадровик',
    permissions: ['view_sectors', 'approve_users']
  },
  RESET: {
    id: 'reset',
    label: '✕ Сбросить',
    permissions: []
  }
};
```

Чистая функция проверки прав в `logic.js`:
```javascript
function hasUserPermission(user, permission) {
  if (!user) return false;
  if (user.rank === 'r5') return true;
  if (user.rank === 'r4') return true;
  if (!Array.isArray(user.permissions)) return false;
  return user.permissions.includes(permission);
}
```

---

### 5.2. Слой базы данных (`db.js`)

1. **Миграция таблицы `users`:**
   В `initDb()` проверяется наличие колонки `permissions` через `PRAGMA table_info(users);`:
   ```sql
   ALTER TABLE users ADD COLUMN permissions TEXT NOT NULL DEFAULT '[]';
   ```
2. **Сессии и пользователи:**
   - В `findUserById`, `findUserByUsername`, `getUsers`, `getPendingUsers`, `verifySession`:
     Поле `permissions` считывается из БД и парсится через `JSON.parse(row.permissions || '[]')`.
   - В `updateUser(userId, updates)`:
     Если передан `updates.permissions` (массив строк), он сериализуется через `JSON.stringify(Array.isArray(updates.permissions) ? updates.permissions : [])` и обновляется в колонке `permissions`.
3. **Безопасность экспорта и импорта:**
   - Учетные записи (`users`) и хеши паролей (`password_hash`) **не выгружаются** в открытый JSON-бэкап игрового состояния во избежание компрометации доступа.
   - В `exportKowJson` добавляется безопасный информационный словарь:
     `userPermissions: { [username]: permissions }` (только связка логина и разрешений).
   - В `importKowJson` поле `userPermissions` строго опционально. Если оно передано, система обновляет права только у существующих в БД пользователей с соответствующим `username`. Новые пользователи не создаются, существующие аккаунты и пароли не перезаписываются. Полная 100% совместимость со старыми бэкапами (kow_v2).

---

### 5.3. Серверный слой REST API (`server.js`)

1. **Вспомогательная функция проверки прав:**
   ```javascript
   function requirePermission(req, res, permission) {
     if (!authenticate(req, res)) return false;
     if (logic.hasUserPermission(req.user, permission)) {
       return true;
     }
     sendError(res, 403, 'FORBIDDEN', `Недостаточно прав: требуется разрешение ${permission}`);
     return false;
   }
   ```
2. **Безопасность сессий и Zero Trust:**
   - `db.verifySession(token)` выполняет запрос к `users` на каждом запросе, поэтому любые изменения прав вступают в силу немедленно на бэкенде без сброса активной сессии пользователя.
   - Функция `checkSectorAccess(targetPlayerId)` обновляется:
     - **Чтение (`GET /api/players/:id`):** разрешено владельцу сектора (`player.userId === req.user.id`) ИЛИ при наличии разрешения `view_sectors` (включая Р4/Р5). Если у запрашивающего нет права `view_stocks` и он не является владельцем, склад маскируется:
       `stock = { coupons: 0, puzzles: 0, chests: 0, starCoupons: 0, legendaryStars1: 0, legendaryStars2: 0, legendaryStars3: 0, masked: true }`.
     - **Запись/редактирование (`PUT /api/players/:id`, `DELETE`, управление офицерами сектора):** строго остаётся доступным только владельцу сектора или офицерам Р4/Р5. Право `view_sectors` даёт доступ исключительно на чтение.
   - `GET /api/players`:
     Доступ разрешен, если `logic.hasUserPermission(req.user, 'view_sectors')`.
     Если `!logic.hasUserPermission(req.user, 'view_stocks')`:
     Для чужих секторов поля склада маскируются аналогичным образом.
   - `GET /api/events` и `GET /api/events/:id`:
     Поле `item.registrations` (все заявки участников) отдается, если `logic.hasUserPermission(req.user, 'manage_events')`.
   - `POST /api/events`, `PUT /api/events/:id`, `DELETE /api/events/:id`:
     Проверка `requirePermission(req, res, 'manage_events')`.
   - `POST /api/events/schedule-season`:
     Проверка `requirePermission(req, res, 'manage_events')`.
   - `POST /api/events/:id/autopick`:
     Проверка `requirePermission(req, res, 'manage_events')`.
   - `POST/PUT/DELETE /api/catalog` и `/api/catalog/batch`:
     Проверка `requirePermission(req, res, 'manage_catalog')`.
   - `POST/PUT/DELETE /api/event-types` и `/api/event-types/bulk-rewards`:
     Проверка `requirePermission(req, res, 'manage_catalog')`.
   - `PUT /api/vip-tiers`:
     Проверка `requirePermission(req, res, 'manage_catalog')`.
   - `GET /api/users/pending`, `/approve`, `/reject`:
     Проверка `requirePermission(req, res, 'approve_users')`. При этом пользователи Р3 с правом `approve_users` могут одобрять новичков только в ранг Р3.
   - `GET /api/auth/me` и `GET /api/my-profile`:
     Возвращает актуальный массив `permissions` текущего пользователя.
   - `PATCH /api/users/:id`:
     Строго доступен только Р5 (`requireRole(['r5'])`). Принимает `{ permissions: [...] }` и обновляет права пользователя.

---

### 5.4. Пользовательский интерфейс (`app.js`, `index.html`, `style.css`)

1. **Раздел «Пользователи» (для Р5):**
   - В таблице пользователей добавляется колонка «Права доступа» с бейджами выданных прав и кнопкой `🛡️ Права`.
   - Модальное окно `#modal-user-permissions`:
     - Имя пользователя и текущий ранг: `@username [Р3]`.
     - Панель быстрых пресетов: кнопки «Все», «Аналитика», «Тактик», «Кадры», «Сбросить».
     - 6 чекбоксов с иконками и описанием.
     - Кнопка «Сохранить права».
2. **Динамический сайдбар `renderSidebarNav()`:**
   - Пункт **«Секторы»** отображается, если `hasPermission('view_sectors')`.
   - Пункт **«Офицеры»** и **«Типы ивентов»** — если `hasPermission('manage_catalog')`.
   - Пункт **«Заявки на регистрацию»** с бейджем колокольчика — если `hasPermission('approve_users')`.
   - Пункт **«Калькулятор и Аналитика»** открывает вкладку «📊 Сводная матрица гильдии», если `hasPermission('view_matrix')`.
   - В **«Календаре»** кнопки создания ивента, редактирования, конструктора сезонов и Smart AutoPick отображаются, если `hasPermission('manage_events')`.
3. **Отображение складов (`canSeeStock`):**
   - `canSeeStock(playerId)` возвращает `true`, если игрок является владельцем сектора ИЛИ `hasPermission('view_stocks')`.
   - Если права нет — аккуратная надпись «Скрыто» с сохранением разметки.

---

## 6. Что оставлено на усмотрение разработчика (Left to Builder)
- Точная визуальная расцветка бейджей пресетов в таблице пользователей.
- Порядок вызова валидаций во фронтенд-модалке.
