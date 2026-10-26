# Конструктор сезонов и настраиваемые правила циклов ивентов: План реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Реализовать комплексный конструктор сезонов альянса с гибкими правилами ритма (cadence rules) для событий «Король Войны», «Мощные Силы» и «Сила Времени», интерактивным предпросмотром расписания перед сохранением и полным удалением устаревшего шаблона «Сильнейший Командир».

**Architecture:** 
- Чистая логика в `logic.js` (`generateSeasonSchedule`, `EVENT_PRESETS` с параметрами `startDayOfWeek`, `durationDays`, `activeWeeks`, `breakWeeks`, `weekOffset`) рассчитывает даты событий от базового понедельника недели 0 по формуле активных недель с поддержкой чередования.
- Серверный REST API эндпоинт `POST /api/events/schedule-season` в `server.js` валидирует права R4/R5, обеспечивает наличие `event_types` в БД SQLite и пакетно сохраняет сгенерированные или отредактированные в UI события, сохраняя обратную совместимость с legacy-параметрами.
- Модальное окно `#modal-season-scheduler` в `index.html` и `app.js` предоставляет визуальный конструктор с карточками событий, быстрыми пресетами длительности (4, 8, 12 недель) и таблицей интерактивного предпросмотра с возможностью точечного удаления событий (✕) перед записью в календарь.

**Tech Stack:** Vanilla JavaScript (ES2022 / UMD), Node.js (нативные `node:http`, `node:sqlite`, `node:crypto`), HTML5, CSS3. Нулевые внешние npm-зависимости.

**Spec:** [`docs/superpowers/specs/2026-10-26-season-scheduler-and-cadence-rules-design.md`](file:///Users/ranunkulus/Downloads/KOW/docs/superpowers/specs/2026-10-26-season-scheduler-and-cadence-rules-design.md)

## Global Constraints

- **Язык общения:** Русский язык для всех ответов и сообщений пользователю (`RULE[user_global]`).
- **Методология GitFlow:** Ветка разработки `feature/season-scheduler-and-cadence-rules`, релиз через `release/v3.6.0`, слияние `--no-ff` в `master` с аннотированным тегом `v3.6.0` (`RULE[user_global]`, `AGENTS.md`).
- **TDD подход:** Сначала падающий тест (RED), затем реализация (GREEN), затем рефакторинг.
- **Внешние зависимости:** 0 новых npm-зависимостей на сервере и клиенте (нативные модули Node.js).
- **Ролевая модель:** Только лидеры (ранги `r4` и `r5`) имеют доступ к созданию сезонов. Для `r3` возвращается `403 Forbidden`.
- **Обратная совместимость:** Существующие тесты `api.test.js` и вызовы со старым телом `{ presetId, startDate, cyclesCount }` должны продолжать работать без ошибок. Ответ API должен содержать и `count`, и `createdCount`.

## Review Focus

1. **Неправильный расчет базового понедельника, если дата старта не понедельник:** Пользователь может выбрать среду в качестве даты старта сезона — базовый понедельник недели 0 должен корректно определиться как понедельник текущей недели, а не сместиться вперед/назад на неделю.
2. **События переходят через границу месяца/года:** Тест `generateSeasonSchedule` с датой старта 28 декабря должен корректно рассчитать даты в январе следующего года без падений и сдвигов временных зон.
3. **Обработка нулевых или отрицательных параметров цикла:** Если переданы `activeWeeks <= 0` или `durationDays <= 0`, алгоритм должен безопасно нормализовать их к значениям по умолчанию или пропускать правило без зацикливания (`while` / деления на 0).
4. **Удаление событий в UI предпросмотре сохраняется на бэкенде:** При отправке отредактированного массива `events` из таблицы предпросмотра бэкенд не должен повторно запускать генератор и восстанавливать удаленные строки.
5. **Создание отсутствующих типов событий с дефолтными наградами:** Если в базе данных еще нет типов «Мощные Силы» или «Сила Времени», они должны создаваться с сеткой наград (12500, 6500, 3500, 2750) и цветами `#10b981` и `#f59e0b`.

---

### Task 1: Пресеты и алгоритм генерации расписания по правилам ритма (`logic.js`, `logic.test.js`)

**Files:**
- Modify: `logic.js:1290-1340` (обновление `EVENT_PRESETS`, реализация расширенного `generateSeasonSchedule`)
- Test: `logic.test.js`

**Interfaces:**
- Consumes: существующие UMD экспорты в `logic.js`.
- Produces:
  - `EVENT_PRESETS`: массив объектов `[{ id: 'king-of-war', name: 'Король Войны', color: '#8b5cf6', startDayOfWeek: 2, durationDays: 2, activeWeeks: 1, breakWeeks: 1, weekOffset: 0 }, { id: 'mighty-forces', name: 'Мощные Силы', color: '#10b981', startDayOfWeek: 6, durationDays: 3, activeWeeks: 1, breakWeeks: 1, weekOffset: 0 }, { id: 'power-of-time', name: 'Сила Времени', color: '#f59e0b', startDayOfWeek: 2, durationDays: 3, activeWeeks: 1, breakWeeks: 1, weekOffset: 1 }]`.
  - `generateSeasonSchedule({ startDate, totalWeeks = 8, rules = [] }) -> Array<{ id: string, typeId: string, name: string, dateFrom: string, dateTo: string, note: string, dayFromStr: string, dayToStr: string }>`: возвращает хронологически отсортированный массив событий с сохранением обратной совместимости с legacy вызовом `{ startDate, cyclesCount, presetId }`.

- [ ] **Step 1: Написать падающие модульные тесты в `logic.test.js`**

Добавить тесты в `logic.test.js`:
```javascript
test('EVENT_PRESETS contains king-of-war, mighty-forces, power-of-time and no mightiest-commander', () => {
  const presets = logic.EVENT_PRESETS;
  assert.equal(presets.some(p => p.id === 'mightiest-commander'), false);
  const kow = presets.find(p => p.id === 'king-of-war');
  const mf = presets.find(p => p.id === 'mighty-forces');
  const pot = presets.find(p => p.id === 'power-of-time');
  assert(kow && mf && pot);
  assert.equal(kow.startDayOfWeek, 2); // Вт
  assert.equal(kow.durationDays, 2);   // 2 дня
  assert.equal(kow.weekOffset, 0);
  assert.equal(mf.startDayOfWeek, 6);  // Сб
  assert.equal(mf.durationDays, 3);    // 3 дня
  assert.equal(mf.weekOffset, 0);
  assert.equal(pot.startDayOfWeek, 2); // Вт
  assert.equal(pot.durationDays, 3);   // 3 дня
  assert.equal(pot.weekOffset, 1);     // Чередуется с King of War
});

test('generateSeasonSchedule generates alternating schedule for 8 weeks from Monday', () => {
  const items = logic.generateSeasonSchedule({
    startDate: '2026-11-02', // Понедельник
    totalWeeks: 8,
    rules: logic.EVENT_PRESETS
  });

  // 8 недель:
  // king-of-war (нед 0, 2, 4, 6) -> 4 события (Вт-Ср)
  // mighty-forces (нед 0, 2, 4, 6) -> 4 события (Сб-Пн)
  // power-of-time (нед 1, 3, 5, 7) -> 4 события (Вт-Чт)
  // Итого 12 событий
  assert.equal(items.length, 12);

  const kowEvents = items.filter(e => e.typeId === 'king-of-war');
  assert.equal(kowEvents.length, 4);
  assert.equal(kowEvents[0].dateFrom, '2026-11-03'); // Вт
  assert.equal(kowEvents[0].dateTo, '2026-11-04');   // Ср

  const mfEvents = items.filter(e => e.typeId === 'mighty-forces');
  assert.equal(mfEvents.length, 4);
  assert.equal(mfEvents[0].dateFrom, '2026-11-07'); // Сб
  assert.equal(mfEvents[0].dateTo, '2026-11-09');   // Пн

  const potEvents = items.filter(e => e.typeId === 'power-of-time');
  assert.equal(potEvents.length, 4);
  assert.equal(potEvents[0].dateFrom, '2026-11-10'); // Вт на неделе 1
  assert.equal(potEvents[0].dateTo, '2026-11-12');   // Чт
});

test('generateSeasonSchedule correctly computes base Monday if startDate is mid-week', () => {
  const items = logic.generateSeasonSchedule({
    startDate: '2026-11-05', // Четверг
    totalWeeks: 2,
    rules: [{ id: 'king-of-war', name: 'Король Войны', startDayOfWeek: 2, durationDays: 2, activeWeeks: 1, breakWeeks: 1, weekOffset: 0 }]
  });
  // Базовый понедельник недели 0 — 2026-11-02, событие во Вт 2026-11-03
  assert.equal(items.length, 1);
  assert.equal(items[0].dateFrom, '2026-11-03');
  assert.equal(items[0].dateTo, '2026-11-04');
});

test('generateSeasonSchedule supports custom cadence (2 active weeks, 1 break week)', () => {
  const items = logic.generateSeasonSchedule({
    startDate: '2026-11-02',
    totalWeeks: 6,
    rules: [{ id: 'custom', name: 'Тест', startDayOfWeek: 1, durationDays: 1, activeWeeks: 2, breakWeeks: 1, weekOffset: 0 }]
  });
  // Недели активности: 0, 1 (активны), 2 (перерыв), 3, 4 (активны), 5 (перерыв) -> 4 события
  assert.equal(items.length, 4);
  assert.equal(items[0].dateFrom, '2026-11-02');
  assert.equal(items[1].dateFrom, '2026-11-09');
  assert.equal(items[2].dateFrom, '2026-11-23');
  assert.equal(items[3].dateFrom, '2026-11-30');
});

test('generateSeasonSchedule preserves backward compatibility with legacy presetId and cyclesCount', () => {
  const items = logic.generateSeasonSchedule({
    startDate: '2026-12-01',
    presetId: 'king-of-war',
    cyclesCount: 2
  });
  assert(items.length >= 2);
  assert.equal(items[0].dateFrom, '2026-12-01');
});
```

- [ ] **Step 2: Запустить тесты и убедиться в падении (RED)**

Run: `node logic.test.js`  
Expected: FAIL (отсутствие новых пресетов или методов).

- [ ] **Step 3: Реализовать пресеты и `generateSeasonSchedule` в `logic.js`**

В `logic.js`:
1. Обновить константу `EVENT_PRESETS`:
```javascript
const EVENT_PRESETS = [
  { id: 'king-of-war', name: 'Король Войны', color: '#8b5cf6', startDayOfWeek: 2, durationDays: 2, activeWeeks: 1, breakWeeks: 1, weekOffset: 0 },
  { id: 'mighty-forces', name: 'Мощные Силы', color: '#10b981', startDayOfWeek: 6, durationDays: 3, activeWeeks: 1, breakWeeks: 1, weekOffset: 0 },
  { id: 'power-of-time', name: 'Сила Времени', color: '#f59e0b', startDayOfWeek: 2, durationDays: 3, activeWeeks: 1, breakWeeks: 1, weekOffset: 1 },
];
```
2. Реализовать `generateSeasonSchedule`:
- Проверить наличие legacy параметров (`presetId`, `cyclesCount`). Если они переданы без `rules` и `totalWeeks`, выполнить legacy логику либо сконвертировать их для совместимости.
- Найти базовый понедельник для `startDate`:
  ```javascript
  const d = new Date(`${startDate}T00:00:00Z`);
  const day = d.getUTCDay(); // 0 - Вс, 1 - Пн ... 6 - Сб
  const diffToMonday = (day === 0 ? -6 : 1 - day);
  const baseMonday = new Date(d);
  baseMonday.setUTCDate(baseMonday.getUTCDate() + diffToMonday);
  ```
- Для каждого правила `rule` из `rules` и каждой недели `w` от 0 до `totalWeeks - 1`:
  - `activeWeeks = Math.max(1, Number(rule.activeWeeks) || 1)`
  - `breakWeeks = Math.max(0, Number(rule.breakWeeks) || 0)`
  - `weekOffset = Math.max(0, Number(rule.weekOffset) || 0)`
  - `cycleLen = activeWeeks + breakWeeks`
  - Проверить условие активности: `if (w < weekOffset) continue; const relWeek = (w - weekOffset) % cycleLen; if (relWeek >= activeWeeks) continue;`
  - Рассчитать `dateFrom` и `dateTo` (`durationDays - 1`).
  - Добавить событие с человекочитаемыми днями недели (`dayFromStr`, `dayToStr`).
- Отсортировать результат по дате `dateFrom` ASC, затем `id`.

- [ ] **Step 4: Запустить тесты и убедиться в прохождении (GREEN)**

Run: `node logic.test.js`  
Expected: PASS (все тесты logic.test.js пройдены).

- [ ] **Step 5: Коммит изменений Task 1**

```bash
git add logic.js logic.test.js
git commit -m "feat(logic): add realistic event presets and flexible season schedule generator"
```

---

### Task 2: REST API эндпоинт пакетного создания сезона (`server.js`, `api.test.js`)

**Files:**
- Modify: `server.js:863-915` (обработчик `POST /api/events/schedule-season`)
- Test: `api.test.js`

**Interfaces:**
- Consumes: `logic.generateSeasonSchedule`, `logic.EVENT_PRESETS`, `db.getEventTypes`, `db.saveEventType`, `db.saveEvent`.
- Produces: `POST /api/events/schedule-season` принимающий `{ events: [...] }` или `{ startDate, totalWeeks, rules }` (а также legacy `{ presetId, startDate, cyclesCount }`), возвращающий `{ success: true, count: N, createdCount: N, events: [...] }` со статусом `201 Created`.

- [ ] **Step 1: Написать падающие интеграционные тесты в `api.test.js`**

Добавить тесты в `api.test.js`:
```javascript
test('API schedule-season supports complex multi-event season and batch events array with RBAC', async () => {
  const { startServer } = require('./server.js');
  const server = await startServer({ port: 0, dbPath: ':memory:' });
  const baseUrl = `http://127.0.0.1:${server.address().port}` ;

  try {
    const adminLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin123' })
    });
    const { token: adminToken } = await adminLoginRes.json();

    // 1. Пакетная отправка готового списка событий из UI предпросмотра
    const batchRes = await fetch(`${baseUrl}/api/events/schedule-season`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        events: [
          { typeName: 'Король Войны', dateFrom: '2026-11-03', dateTo: '2026-11-04', note: 'Неделя 1' },
          { typeName: 'Мощные Силы', dateFrom: '2026-11-07', dateTo: '2026-11-09', note: 'Неделя 1' },
          { typeName: 'Сила Времени', dateFrom: '2026-11-10', dateTo: '2026-11-12', note: 'Неделя 2' }
        ]
      })
    });
    assert.equal(batchRes.status, 201);
    const batchData = await batchRes.json();
    assert.equal(batchData.success, true);
    assert.equal(batchData.createdCount, 3);
    assert.equal(batchData.count, 3);
    assert.equal(batchData.events.length, 3);

    // 2. Проверка, что типы событий созданы с правильными цветами и наградами
    const etRes = await fetch(`${baseUrl}/api/event-types`);
    const eventTypes = await etRes.json();
    const mfType = eventTypes.find(t => t.name === 'Мощные Силы');
    const potType = eventTypes.find(t => t.name === 'Сила Времени');
    assert(mfType && potType);
    assert.equal(mfType.color, '#10b981');
    assert.equal(potType.color, '#f59e0b');
    assert.equal(mfType.places[0].coupons, 12500);

    // 3. Отправка правил расписания (startDate, totalWeeks, rules)
    const genRes = await fetch(`${baseUrl}/api/events/schedule-season`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        startDate: '2026-11-16',
        totalWeeks: 4,
        rules: [
          { id: 'king-of-war', name: 'Король Войны', startDayOfWeek: 2, durationDays: 2, activeWeeks: 1, breakWeeks: 1, weekOffset: 0 }
        ]
      })
    });
    assert.equal(genRes.status, 201);
    const genData = await genRes.json();
    assert.equal(genData.createdCount, 2);
  } finally {
    await server.close();
  }
});
```

- [ ] **Step 2: Запустить интеграционные тесты и убедиться в падении (RED)**

Run: `node api.test.js`  
Expected: FAIL.

- [ ] **Step 3: Реализовать обработку `POST /api/events/schedule-season` в `server.js`**

В `server.js` обновить блок `pathname === '/api/events/schedule-season'`:
1. Проверка роли лидерства `requireRole(['r4', 'r5'])`.
2. Подготовка вспомогательной функции поиска/создания `eventType` по имени или пресету:
   - Проверять наличие в `db.getEventTypes()` (case-insensitive trim).
   - Если отсутствует: создать через `db.saveEventType` с цветом из пресетов (`#8b5cf6`, `#10b981`, `#f59e0b`) и стандартной сеткой наград (12500, 6500, 3500, 2750).
3. Определение входящих данных:
   - Если передан `Array.isArray(body.events)`:
     - Для каждого элемента разрешить `typeId` (по `item.typeId` или `item.typeName` / `item.name`).
     - Сохранить в `db.saveEvent({ typeId, dateFrom: item.dateFrom, dateTo: item.dateTo, note: item.note || '', assignments: [] })`.
   - Иначе если переданы `rules` или `totalWeeks`:
     - Вызвать `logic.generateSeasonSchedule({ startDate: body.startDate, totalWeeks: body.totalWeeks, rules: body.rules })`.
     - Сохранить полученные события в БД.
   - Иначе (legacy fallback):
     - Использовать `{ presetId, startDate, cyclesCount }` (как было ранее).
4. Вернуть `sendJson(res, 201, { success: true, count: createdEvents.length, createdCount: createdEvents.length, events: createdEvents })`.

- [ ] **Step 4: Запустить тесты API и проверить успешное прохождение (GREEN)**

Run: `node api.test.js && node db.test.js && node logic.test.js`  
Expected: PASS (все существующие и новые тесты пройдены).

- [ ] **Step 5: Коммит изменений Task 2**

```bash
git add server.js api.test.js
git commit -m "feat(api): support multi-event and preview batch payload in schedule-season endpoint"
```

---

### Task 3: Пользовательский интерфейс: Конструктор сезонов и интерактивный предпросмотр (`index.html`, `style.css`, `app.js`)

**Files:**
- Modify: `index.html:750-785` (разметка модального окна конструктора сезонов `#modal-season-scheduler`)
- Modify: `style.css` (стили карточек ивентов, сетки параметров и таблицы предпросмотра)
- Modify: `app.js:2300-2450` (обработчики открытия модального окна, пересчета предпросмотра, удаления строк и отправки на бэкенд)

**Interfaces:**
- Consumes: `logic.EVENT_PRESETS`, `logic.generateSeasonSchedule`, `POST /api/events/schedule-season`.
- Produces: интерактивное модальное окно `#modal-season-scheduler` с мгновенным откликом предпросмотра и пакетным созданием сезона в календаре.

- [ ] **Step 1: Разметка модального окна `#modal-season-scheduler` в `index.html`**

Заменить старую форму модалки `#modal-season-scheduler` на новую:
1. Заголовок: «📅 Конструктор сезонов альянса».
2. Блок параметров сезона:
   - Поле выбора даты старта сезона `#season-start-date` (input type="date").
   - Кнопки быстрого выбора длительности сезона: `4 недели`, `8 недель` (активна по умолчанию), `12 недель`.
3. Контейнер карточек событий `#season-event-cards`:
   - 3 карточки с акцентными цветными полосками (`--kow-purple`, `--kow-green`, `--kow-amber`).
   - Чекбокс включения события (`#season-enable-kow`, `#season-enable-mf`, `#season-enable-pot`).
   - Селектор дня старта (Пн–Вс), селектор длительности (дни), поля активности (недель подряд) и перерыва (недель).
   - Чекбокс / селектор смещения недели (для Силы времени по умолчанию `weekOffset = 1`).
4. Блок интерактивного предпросмотра:
   - Заголовок с бейджем количества: «Предпросмотр расписания (<span id="season-preview-count">0</span> событий)».
   - Таблица `#season-preview-table` со столбцами: «Дата», «День недели», «Событие», «Длительность», «Действие».
   - Кнопка точечного удаления (✕) у каждой строки для кастомизации расписания перед сохранением.
5. Кнопка сохранения: «⚡ Создать сезон в календаре (<span id="season-submit-count">0</span> событий)» (`#btn-submit-season`).

- [ ] **Step 2: Добавить стили конструктора в `style.css`**

Добавить стили:
- `.season-config-grid` — адаптивная сетка карточек ивентов (1 колонка на мобильных, 3 колонки на экранах от 900px).
- `.season-event-card` — стильная карточка с темным фоном `#1e293b`, бордером и цветным индикатором.
- `.season-preview-table-wrap` — контейнер с вертикальной прокруткой (`max-height: 260px`).
- `.badge-event-tag` — бейджи типов ивентов с соответствующими оттенками.
- Кнопки удаления `.btn-remove-row` (красный hover/active, компактный размер).

- [ ] **Step 3: Реализовать клиентскую логику в `app.js`**

В `app.js`:
1. Функция `openSeasonSchedulerModal()`:
   - Находит ближайший понедельник от текущей даты и устанавливает в `#season-start-date`.
   - Инициализирует значения карточек из `logic.EVENT_PRESETS`.
   - Вызывает `updateSeasonSchedulePreview()`.
   - Открывает модальное окно.
2. Функция `updateSeasonSchedulePreview()`:
   - Считывает текущие значения даты, длительности и активных карточек.
   - Вызывает `logic.generateSeasonSchedule({ startDate, totalWeeks, rules })`.
   - Сохраняет полученный список во внутреннее состояние `state.seasonPreviewEvents`.
   - Отрисовывает строки таблицы предпросмотра с кнопками удаления.
   - Обновляет счетчики событий.
3. Функция `removeSeasonPreviewEvent(index)`:
   - Удаляет событие из `state.seasonPreviewEvents` по индексу.
   - Перерисовывает таблицу предпросмотра и счетчик.
4. Функция `submitSeasonSchedule()`:
   - Проверяет, что `state.seasonPreviewEvents.length > 0`.
   - Отправляет `POST /api/events/schedule-season` с телом `{ events: state.seasonPreviewEvents }`.
   - Показывает уведомление об успешном создании $N$ событий.
   - Закрывает модальное окно и перезагружает события календаря (`loadEvents()`).

- [ ] **Step 4: Проверить синтаксис и выполнить проверку тестов**

Run: `node -c app.js && node -c server.js && node -c logic.js`  
Run: `npm test`  
Expected: Все тесты проходят (0 failures).

- [ ] **Step 5: Коммит изменений Task 3**

```bash
git add index.html style.css app.js
git commit -m "feat(ui): add season scheduler modal with cadence rules and interactive schedule preview"
```

---

### Task 4: Регрессионная верификация, аудит кода и релиз `v3.6.0` по GitFlow

**Files:**
- Modify: `package.json` (версия 3.6.0)
- Modify: `CHANGELOG.md` (запись релиза v3.6.0)

**Interfaces:**
- Consumes: завершенные ветка и все модули приложения.
- Produces: чистый релизный мерж `--no-ff` в `master` с аннотированным тегом `v3.6.0`.

- [ ] **Step 1: Запустить полный набор тестов проекта**

Run: `npm test`  
Expected: Все модульные (`logic.test.js`), базы данных (`db.test.js`) и интеграционные (`api.test.js`) тесты зеленые (0 failures).

- [ ] **Step 2: Провести ревью изменений всей ветки (Whole-Branch Review)**

Проверить `git diff master...HEAD`:
- Отсутствие отладочных `console.log`.
- Соблюдение чистоты архитектуры (0 внешних npm-зависимостей).
- Соблюдение ролевой модели безопасности RBAC.

- [ ] **Step 3: Создать релизную ветку `release/v3.6.0` и зафиксировать версию**

1. `git checkout -b release/v3.6.0`
2. Повысить версию в `package.json` до `"3.6.0"`.
3. Добавить описание релиза в `CHANGELOG.md` (Keep a Changelog):
   - Добавлен комплексный конструктор сезонов альянса (4, 8, 12 недель).
   - Внедрены правила ритма событий («Король Войны» Вт–Ср, «Мощные Силы» Сб–Пн, «Сила Времени» Вт–Чт с чередованием).
   - Интерактивный предпросмотр расписания с возможностью удаления строк.
   - Удален несуществующий шаблон «Сильнейший Командир».
4. Закоммитить: `git commit -am "chore(release): prepare v3.6.0"`

- [ ] **Step 4: Выполнить слияние в `master` и тегирование по GitFlow**

```bash
git checkout master
git merge --no-ff release/v3.6.0 -m "Merge branch 'release/v3.6.0' into master"
git tag -a v3.6.0 -m "Release v3.6.0: Season scheduler with cadence rules and schedule preview"
git branch -d feature/season-scheduler-and-cadence-rules release/v3.6.0
```

- [ ] **Step 5: Финальная верификация на `master`**

Run: `npm test`  
Expected: Все тесты зеленые, рабочее дерево чистое.
