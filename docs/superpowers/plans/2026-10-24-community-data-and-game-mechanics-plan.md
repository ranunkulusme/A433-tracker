# Community Data and Game Mechanics Implementation Plan (v3.1.0 Architecture)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Интегрировать данные сообщества Kiss of War (реестр офицеров Gen 1–9, шкалу очков VIP, расчет навыков 5-5-5-5, генератор расписания сезонов, кулдауны Fair Play в автоподборе и мета-связки) в клиент-серверную архитектуру KoW Tracker с сохранением в SQLite и поддержкой через REST API.

**Architecture:** Полноценный full-stack проход:
1. Вычислительное ядро `logic.js`: чистые функции расчета VIP-дефицита, прогресса навыков, пресетов расписания, связок командиров и кулдауна автоподбора.
2. База данных `db.js`: расширение схемы SQLite новыми полями (`skills_json`, `vip_points`, `upgrade_type`), сидирование реальных офицеров, методы выборки недавних победителей.
3. Сервер `server.js`: новые REST-эндпоинты (`/api/events/schedule-season`), санитизация `skills` и `vipPoints` в кабинете игрока (`/api/my-profile`), передача недавних победителей в автоподбор.
4. Клиент `app.js` / `index.html` / `style.css`: интерактивные элементы управления навыками, виджет окупаемости VIP, модальное окно генератора сезонов, подсказки связок.

**Tech Stack:** Vanilla JavaScript (ES6+, UMD), Node.js HTTP (`node:http`), SQLite (`node:sqlite`), HTML5, CSS3, модульные тесты (`logic.test.js`, `db.test.js`, `api.test.js`).

**Spec:** [`docs/superpowers/specs/2026-10-24-community-data-and-game-mechanics-spec.md`](file:///Users/ranunkulus/Downloads/KOW/docs/superpowers/specs/2026-10-24-community-data-and-game-mechanics-spec.md)

## Global Constraints

- **Строгое соблюдение GitFlow:** разработка ведется в ветке `feature/community-data-integration`, созданной от актуального `master` (v3.0.0). Прямые коммиты в `master` запрещены.
- **Нулевые внешние зависимости сервера:** бэкенд использует исключительно нативные возможности Node.js (`node:http`, `node:sqlite`, `node:crypto`).
- **Обратная совместимость SQLite:** существующая база данных `data/kow.db` должна мигрировать прозрачно при вызове `initDb()`.
- **RBAC:** рядовой игрок (Р3) может изменять навыки и очки VIP только в своем личном кабинете; генерация сезонов и редактирование каталога доступны только Р4/Р5.
- Все команды верификации должны выполняться локально: `node logic.test.js && node db.test.js && node api.test.js`.

## Review Focus

- Миграция БД: при запуске на существующей БД v3.0.0 таблицы `players`, `player_officers`, `officer_catalog` корректно дополняются новыми колонками без потери существующих данных.
- Санитизация навыков: массив `skills` строго валидируется на бэкенде (ровно 4 целых числа от 1 до 5); попытка передать невалидные значения корректируется дефолтом `[1, 1, 1, 1]`.
- VIP-дефицит: при достижении максимального уровня (VIP 30) или превышении порога функция не выбрасывает ошибок переполнения массива и возвращает `pointsNeeded: 0`.
- Кулдаун автоподбора: если абсолютно все кандидаты имеют кулдаун, автоподбор не оставляет призовые места пустыми, а распределяет их по стандартному скорингу.
- Импорт/Экспорт JSON: файл бэкапа содержит `skills`, `vipPoints` и `upgradeType`, а импорт старых версий (v2/v3) корректно проставляет значения по умолчанию.

---

### Task 1: Математическое ядро в `logic.js` (Реестр офицеров, VIP, Навыки 5-5-5-5, Связки и Пресеты)

**Files:**
- Modify: `logic.js`
- Modify: `logic.test.js`

**Interfaces:**
- Produces:
  - `COMMUNITY_OFFICERS`: массив легендарных командиров Gen 1–9.
  - `VIP_TIERS_DATA` и `calculateVipDeficit({ currentLevel, currentPoints, targetLevel })`.
  - `SKILL_UPGRADE_COSTS` и `calculateSkillMedalsProgress(skills)`.
  - `OFFICER_PAIRINGS` и `getRecommendedPairings(officerId)`.
  - `EVENT_PRESETS` и `generateSeasonSchedule({ startDate, cyclesCount, presetId, startId })`.

- [ ] **Step 1: Написать падающие тесты в `logic.test.js`**

Добавить тесты проверки новых чистых функций в `logic.test.js`:
```javascript
const {
  COMMUNITY_OFFICERS,
  calculateVipDeficit,
  calculateSkillMedalsProgress,
  getRecommendedPairings,
  generateSeasonSchedule
} = require('./logic');

// Тест каталога
assert(Array.isArray(COMMUNITY_OFFICERS) && COMMUNITY_OFFICERS.length >= 10);
const rex = COMMUNITY_OFFICERS.find(o => o.id === 'general-rex');
assert.strictEqual(rex.type, 'Танк');

// Тест VIP дефицита
const vipRes = calculateVipDeficit({ currentLevel: 10, currentPoints: 350000, targetLevel: 12 });
assert.strictEqual(vipRes.pointsNeeded, 400000);
assert.strictEqual(vipRes.dailyPuzzlesIncrease, 2);

// Тест навыков 5-5-5-5 (690 медалей)
const skillsZero = calculateSkillMedalsProgress([1, 1, 1, 1]);
assert.strictEqual(skillsZero.spentMedals, 0);
assert.strictEqual(skillsZero.remainingMedals, 690);

const skillsMax = calculateSkillMedalsProgress([5, 5, 5, 5]);
assert.strictEqual(skillsMax.spentMedals, 690);
assert.strictEqual(skillsMax.remainingMedals, 0);
assert.strictEqual(skillsMax.isMaxSkills, true);

// Тест связок
const pairings = getRecommendedPairings('general-rex');
assert(pairings.length > 0 && pairings[0].partnerName);

// Тест генератора расписания
const schedule = generateSeasonSchedule({ startDate: '2026-11-01', cyclesCount: 2, presetId: 'king-of-war' });
assert.strictEqual(schedule.length, 2);
assert.strictEqual(schedule[1].dateFrom, '2026-11-15');
console.log('ok - logic community mechanics and pure calculations');
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Запуск: `node logic.test.js`  
Ожидается: FAIL (`calculateVipDeficit is not defined`).

- [ ] **Step 3: Реализовать константы и функции в `logic.js`**

1. Добавить `COMMUNITY_OFFICERS` и объединить с базовым списком.
2. Реализовать `calculateVipDeficit`, `calculateSkillMedalsProgress`, `getRecommendedPairings`, `generateSeasonSchedule`.
3. Экспортировать все функции и константы через модуль.

- [ ] **Step 4: Запустить тесты и убедиться, что они проходят**

Запуск: `node logic.test.js`  
Ожидается: PASS.

- [ ] **Step 5: Сделать git commit**

```bash
git add logic.js logic.test.js
git commit -m "feat(logic): add community officers roster, vip deficit, skills and pairings"
```

---

### Task 2: Автоподбор с правилом справедливости (Fair Play Cooldown) в `logic.js`

**Files:**
- Modify: `logic.js`
- Modify: `logic.test.js`

**Interfaces:**
- Modifies: `smartAutoPickWithRegistrations({ event, players, registrations, officerCatalog, eventDate, recentWinners = [] })`.
- Produces: штраф к приоритету для кандидатов, занимавших 1-е место в недавних ивентах (`recentWinners.includes(player.id)`).

- [ ] **Step 1: Написать падающий тест в `logic.test.js`**

```javascript
const { smartAutoPickWithRegistrations } = require('./logic');

const catalog = [{ id: 'rex', name: 'Рекс', generation: 7, couponPerPuzzle: 500 }];
const event = { places: [{ place: 1, coupons: 12500 }] };
const players = [
  { id: 1, name: 'Победитель', sector: { killPoints: 100 }, stock: { coupons: 0, puzzles: 0 }, officers: [{ id: 'o1', catalogId: 'rex', level: 0, coupons: 0 }] },
  { id: 2, name: 'Претендент', sector: { killPoints: 95 }, stock: { coupons: 0, puzzles: 0 }, officers: [{ id: 'o2', catalogId: 'rex', level: 0, coupons: 0 }] }
];

// Без кулдауна место получает Игрок 1
const resWithoutCooldown = smartAutoPickWithRegistrations({ event, players, officerCatalog: catalog });
assert.strictEqual(resWithoutCooldown.assignments[0].playerId, 1);

// С кулдауном место получает Игрок 2
const resWithCooldown = smartAutoPickWithRegistrations({
  event,
  players,
  officerCatalog: catalog,
  recentWinners: [1]
});
assert.strictEqual(resWithCooldown.assignments[0].playerId, 2, 'Candidate in cooldown should yield place to eligible competitor');
console.log('ok - smartAutoPickWithRegistrations respects fair play cooldown');
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Запуск: `node logic.test.js`  
Ожидается: FAIL (без кулдауна назначается игрок 1).

- [ ] **Step 3: Реализовать кулдаун скоринга в `smartAutoPickWithRegistrations`**

В скоринге кандидатов добавить пенальти к приоритету, если `recentWinners.includes(p.id)`, при наличии других подходящих кандидатов без дефицитного перерасхода.

- [ ] **Step 4: Запустить тесты и убедиться, что они проходят**

Запуск: `node logic.test.js`  
Ожидается: PASS.

- [ ] **Step 5: Сделать git commit**

```bash
git add logic.js logic.test.js
git commit -m "feat(logic): support fair play recent winners cooldown in auto-pick"
```

---

### Task 3: Обновление схемы базы данных SQLite и CRUD в `db.js`

**Files:**
- Modify: `db.js`
- Modify: `db.test.js`

**Interfaces:**
- Produces:
  - Миграция таблицы `players` (колонка `vip_points INTEGER DEFAULT 0`).
  - Миграция таблицы `player_officers` (колонка `skills_json TEXT DEFAULT '[1,1,1,1]'`).
  - Миграция таблицы `officer_catalog` (колонка `upgrade_type TEXT DEFAULT 'standard'`).
  - Метод `getRecentWinners(eventTypeId, limit = 2)`: возвращает ID игроков, побеждавших в недавних ивентах этого типа.
  - Поддержка новых полей в `exportKowJson` / `importKowJson`.

- [ ] **Step 1: Написать падающий тест в `db.test.js`**

Добавить тесты сохранения и чтения `vip_points`, `skills_json` и выборки недавних победителей:
```javascript
// Проверка сохранения vipPoints и навыков офицера
const player = db.createPlayer({
  name: 'Командор VIP',
  sector: { vipLevel: 12, vipPoints: 450000 },
  officers: [{ id: 'o-vip', catalogId: 'general-rex', level: 10, skills: [5, 5, 1, 1] }]
});

const fetched = db.getPlayerById(player.id);
assert.strictEqual(fetched.sector.vipPoints, 450000);
assert.deepStrictEqual(fetched.officers[0].skills, [5, 5, 1, 1]);

// Проверка метода getRecentWinners
assert(typeof db.getRecentWinners === 'function');
console.log('ok - db stores skills, vip_points and retrieves recent winners');
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Запуск: `node db.test.js`  
Ожидается: FAIL.

- [ ] **Step 3: Реализовать изменения в `db.js`**

1. В `initDb()` добавить функции безопасного добавления колонок `ALTER TABLE ... ADD COLUMN ...` через `PRAGMA table_info`.
2. Обновить маппинг в `getPlayerById`, `updatePlayer`, `addPlayerOfficer`, `updatePlayerOfficer`.
3. Добавить реализацию `getRecentWinners(eventTypeId, limit)`.
4. Обновить начальное сидирование каталога реальными командирами `COMMUNITY_OFFICERS`.
5. Обновить функции `exportKowJson` и `importKowJson`.

- [ ] **Step 4: Запустить тесты и убедиться, что они проходят**

Запуск: `node db.test.js`  
Ожидается: PASS.

- [ ] **Step 5: Сделать git commit**

```bash
git add db.js db.test.js
git commit -m "feat(db): add skills_json, vip_points, upgrade_type and getRecentWinners"
```

---

### Task 4: Бэкенд REST API и интеграция в `server.js`

**Files:**
- Modify: `server.js`
- Modify: `api.test.js`

**Interfaces:**
- Produces:
  - `POST /api/events/schedule-season`: генерация пачки ивентов по пресету (доступно R4/R5).
  - Обновленный `POST /api/events/:id/autopick`: автоматическая передача `recentWinners` из `db.getRecentWinners`.
  - Поддержка `skills` и `vipPoints` в `/api/my-profile`.

- [ ] **Step 1: Написать падающий интеграционный тест в `api.test.js`**

```javascript
// Тест генерации расписания сезона
const seasonRes = await apiRequest('/api/events/schedule-season', {
  method: 'POST',
  headers: { cookie: `token=${r5Token}` },
  body: { presetId: 'king-of-war', startDate: '2026-12-01', cyclesCount: 2 }
});
assert.strictEqual(seasonRes.status, 201);
assert.strictEqual(seasonRes.data.createdCount, 2);

// Тест сохранения навыков через личный кабинет R3
const profileRes = await apiRequest('/api/my-profile', {
  method: 'PUT',
  headers: { cookie: `token=${r3Token}` },
  body: {
    sector: { vipLevel: 11, vipPoints: 220000 },
    officers: [{ id: r3OfficerId, catalogId: 'general-rex', level: 20, skills: [5, 3, 1, 1] }]
  }
});
assert.strictEqual(profileRes.status, 200);
assert.deepStrictEqual(profileRes.data.officers[0].skills, [5, 3, 1, 1]);
console.log('ok - API schedule-season and profile skills endpoints');
```

- [ ] **Step 2: Запустить интеграционный тест и убедиться, что он падает**

Запуск: `node api.test.js`  
Ожидается: FAIL (эндпоинт 404).

- [ ] **Step 3: Реализовать обработчики в `server.js`**

1. В роутер `/api/events/schedule-season` добавить проверку прав (R4/R5), вызов `logic.generateSeasonSchedule`, создание ивентов в БД через транзакцию и возврат результата.
2. В `/api/events/:id/autopick` подключить `db.getRecentWinners(event.type_id)` и передавать в автоподбор.
3. В обработчиках `/api/my-profile` добавить сохранение `vipPoints` и массива `skills`.

- [ ] **Step 4: Запустить тесты API и убедиться, что они проходят**

Запуск: `node api.test.js` (с правами на сокеты)  
Ожидается: PASS.

- [ ] **Step 5: Сделать git commit**

```bash
git add server.js api.test.js
git commit -m "feat(api): add season schedule endpoint and integrate fair play autopick"
```

---

### Task 5: Клиентский интерфейс (`app.js`, `index.html`, `style.css`)

**Files:**
- Modify: `index.html`
- Modify: `style.css`
- Modify: `app.js`

**Interfaces:**
- UI components:
  - Селекторы 4 навыков офицера `[1..5, 1..5, 1..5, 1..5]` в личном кабинете и формах редактирования.
  - Поле ввода очков VIP с калькулятором дефицита.
  - Кнопка «⚡ Создать сезон» в календаре.
  - Блок рекомендованных связок командиров.

- [ ] **Step 1: Добавить разметку модального окна сезона и полей в `index.html`**

1. Добавить модальное окно `#modal-season-scheduler` с селектором пресетов («Король Войны», «Сильнейший Командир»), выбором даты старта и количества циклов.
2. В форму редактирования офицеров добавить блок кнопок навыков `.skill-level-group`.
3. В форму сектора игрока добавить поле `#fp-vip-points` и блок подсказки `#vip-progress-hint`.

- [ ] **Step 2: Добавить стили в `style.css`**

Стилизовать элементы: `.skill-selector`, `.skill-btn.active`, `.vip-badge-card`, `.pairings-grid`, `.cooldown-badge`.

- [ ] **Step 3: Связать интерфейс с логикой и API в `app.js`**

1. Обновить `renderOfficerRows()` для рендеринга интерактивных кнопок навыков и расчета затраченных медалей через `calculateSkillMedalsProgress`.
2. Добавить обработчик ввода очков VIP с вызовом `calculateVipDeficit` и выводом очков/дней до следующего уровня.
3. Добавить функцию `openSeasonSchedulerModal()` и отправку запроса на `/api/events/schedule-season`.
4. В карточке офицера выводить результат `getRecommendedPairings`.

- [ ] **Step 4: Проверить синтаксис и локальный запуск**

Запуск: `node -c app.js && node -c server.js`  
Ожидается: отсутствие синтаксических ошибок.

- [ ] **Step 5: Сделать git commit**

```bash
git add app.js index.html style.css
git commit -m "feat(ui): add skills selectors, vip calculator, season generator and pairings"
```

---

### Task 6: Финальная верификация, подготовка релиза и GitFlow

**Files:**
- Modify: `package.json` (повышение версии до `3.1.0`)
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Запустить полный комплекс тестов**

```bash
npm test
node -c app.js && node -c server.js
```
Ожидается: 0 failures, все тесты зеленые.

- [ ] **Step 2: Оформить релизную ветку по GitFlow**

1. Создать ветку релиза: `git checkout -b release/v3.1.0`.
2. Обновить версию в `package.json` до `3.1.0`.
3. Добавить подробное описание изменений в `CHANGELOG.md` по стандарту Keep a Changelog.
4. Закоммитить: `git commit -am "chore(release): prepare v3.1.0"`.

- [ ] **Step 3: Слить в master и поставить аннотированный тег**

```bash
git checkout master
git merge --no-ff release/v3.1.0 -m "Merge branch 'release/v3.1.0' into master"
git tag -a v3.1.0 -m "Release v3.1.0: Community data, skills 5-5-5-5, VIP calculator and season scheduler"
git branch -d release/v3.1.0 feature/community-data-integration
```

---

## Self-Review

1. **Spec coverage:** Все пункты скорректированного ТЗ (SQLite-миграции, серверные роуты, UMD-логика, UI, Fair Play) покрыты конкретными шагами.
2. **Step scan:** Каждый шаг содержит однозначную команду, ожидаемый результат и TDD-цикл.
3. **Type consistency:** Имена полей (`skills_json`, `vip_points`, `upgrade_type`) строго согласованы между `db.js`, `server.js`, `logic.js` и `app.js`.
4. **GitFlow:** План полностью соблюдает требования правил проекта (никаких прямых коммитов в `master`, ветки `feature/*` и `release/*`, аннотированные теги).
