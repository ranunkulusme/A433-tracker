# Smart Scanner OCR Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Реализовать клиентский модуль OCR-распознавания скриншотов игры (Smart Scanner) для автоматического заполнения статистики игрока и запасов склада, привести названия склада к терминам из игры, добавить учет Легендарных звезд I, II, III с расчетом суммы очков.

**Architecture:**
1. **Математическое ядро (`logic.js`):** константы номиналов звезд (`STAR_ITEM_VALUES`), функция подсчета очков звезд `calculateTotalStarPoints`, функции парсинга сырого OCR-текста (`cleanOcrNumber`, `parseProfileScreenshotText`, `parseWarehouseScreenshotText`) и дедуплицирующего слияния результатов нескольких скриншотов (`mergeScanResults`).
2. **База данных (`db.js`):** безопасная миграция схемы таблицы `players` (`stock_star_coupons`, `stock_legendary_stars_1`, `stock_legendary_stars_2`, `stock_legendary_stars_3`), сохранение/чтение в CRUD и обратная совместимость экспорта/импорта.
3. **Бэкенд REST API (`server.js`):** санитизация расширенного объекта `stock` в `/api/my-profile` и `/api/players`, раздача MIME-типов `.wasm` для локального Web Worker.
4. **Клиентский OCR и Canvas (`ocr.js`, `app.js`):** Canvas-предобработка (бинаризация, деление 2-колоночной сетки инвентаря), фоновый Web Worker Tesseract.js, модальное окно `#modal-smart-scanner` (Drag-and-Drop, выбор файлов, вставка `Ctrl+V`), карточка предпросмотра и кнопка «Применить в профиль».
5. **Интерфейс склада (`index.html`, `style.css`):** актуализация названий запасов («Купон готовности офицера», «Медаль легендарного офицера», «Купон готовности звезды», «Легендарная звезда I/II/III») и виджет динамического расчета суммы очков звезд.

**Tech Stack:** Vanilla JavaScript (ES6+), HTML5 Canvas, Tesseract.js Web Worker, Node.js (`server.js`), SQLite (`db.js`), CSS3.

**Spec:** [`docs/superpowers/specs/2026-10-25-smart-scanner-ocr-design.md`](file:///Users/ranunkulus/Downloads/KOW/docs/superpowers/specs/2026-10-25-smart-scanner-ocr-design.md)

## Global Constraints

- **Строгое соблюдение GitFlow:** разработка ведется в ветке `feature/smart-scanner-ocr`, ответвленной от актуального `master` (v3.2.0). Прямые коммиты в `master` запрещены.
- **Нулевые внешние зависимости сервера:** бэкенд использует исключительно нативные модули Node.js (`node:http`, `node:sqlite`, `node:crypto`). OCR выполняется на клиенте.
- **Точные названия склада со скриншотов:** «Купон готовности офицера», «Медаль легендарного офицера», «Купон готовности звезды», «Легендарная звезда I» (110), «Легендарная звезда II» (420), «Легендарная звезда III» (960), «Сундук выбора».
- **Игнорирование VIP при сканировании:** сканер не перезаписывает VIP игрока (игрок указывает VIP вручную).
- **Точные очки за убийства:** из таблицы извлекается полное значение (`7,588,164,323`), а не сокращенное `7.6B`.
- **Сохранение сундуков:** если сундуки отсутствуют на скриншоте, текущее значение `stock.chests` игрока сохраняется без затирания.
- Все тесты запускаются через команду `node logic.test.js && node db.test.js && node api.test.js`.

## Review Focus

1. **Многостраничное слияние без задвоения:** загрузка скриншотов 1, 2 (профиль), 3 и 4 (склад) объединяется в единую карточку без перезаписи или задвоения мощи и запасов.
2. **Точность формулы суммы очков звезд:** $$(N_1 \times 110) + (N_2 \times 420) + (N_3 \times 960)$$ строго соответствует спецификации (для 1097, 95, 22 итого $181\,690$).
3. **Безопасность никнейма:** при несовпадении никнейма со скриншота с текущим игроком ник не перезаписывается молча без подтверждения пользователя.
4. **Миграция БД без потерь:** базы данных версий v3.0–v3.2 с тремя полями склада корректно мигрируют, добавляя новые колонки со значением по умолчанию `0`.
5. **Очистка OCR-чисел (`cleanOcrNumber`):** устойчивость к пробелам, запятым, точкам, замене `O`/`o` на `0`, `l`/`I` на `1` в числовых позициях.

---

### Task 1: Математическое ядро склада и парсер OCR в `logic.js`

**Files:**
- Modify: `logic.js`
- Modify: `logic.test.js`

**Interfaces:**
- Produces:
  - `STAR_ITEM_VALUES`: `{ legendaryStars1: 110, legendaryStars2: 420, legendaryStars3: 960 }`.
  - `calculateTotalStarPoints(stock)`: расчет суммы очков звезд.
  - `cleanOcrNumber(str)`: очистка строки числа от артефактов OCR и форматирования.
  - `parseProfileScreenshotText(text)`: извлечение `{ name, allianceTag, power, kills, killPoints }`.
  - `parseWarehouseScreenshotText(text)`: извлечение `{ coupons, puzzles, starCoupons, legendaryStars1, legendaryStars2, legendaryStars3 }`.
  - `mergeScanResults(accumulated, nextScan)`: объединение результатов сканов без задвоения и потери данных.
  - Обновление `normalizeStock(stock)` для поддержки новых полей.

- [ ] **Step 1: Написать падающие юнит-тесты в `logic.test.js`**
  - Тест `calculateTotalStarPoints` на тестовых данных со скриншота (1097, 95, 22 = 181,690).
  - Тест `cleanOcrNumber` на строках `157,660,593`, `7 588 164 323`, `419.202`, `2,077`, `l,097`, `95o`.
  - Тест `parseProfileScreenshotText` на тексте скриншотов 1 и 2 (проверка извлечения `157660593`, `84778517`, `7588164323`, `ranu`, `A433`; проверка отсутствия поля `vip`).
  - Тест `parseWarehouseScreenshotText` на тексте скриншотов 3 и 4 (проверка купонов `419202`, медалей `2077`, купонов звезд `244712`, звезд I `1097`, звезд II `95`, звезд III `22`).
  - Тест `mergeScanResults` при последовательном слиянии профиля (скрины 1, 2) и склада (скрины 3, 4).

- [ ] **Step 2: Запустить тесты и убедиться, что они падают (RED)**
  - Запуск: `node logic.test.js`.

- [ ] **Step 3: Реализовать функции и константы в `logic.js` (GREEN)**
  - Добавить `STAR_ITEM_VALUES`, `calculateTotalStarPoints`, `cleanOcrNumber`.
  - Добавить регулярные выражения и логику парсинга `parseProfileScreenshotText`, `parseWarehouseScreenshotText`.
  - Добавить чистую функцию `mergeScanResults`.
  - Обновить `normalizeStock`.
  - Экспортировать новые функции в UMD-блоке.

- [ ] **Step 4: Запустить тесты и проверить результат**
  - Запуск: `node logic.test.js`. Ожидается: PASS (все тесты зеленые).

- [ ] **Step 5: Сделать git commit**
  ```bash
  git add logic.js logic.test.js
  git commit -m "feat(logic): add ocr parsers, star points calculation and stock item constants"
  ```

---

### Task 2: Обновление схемы базы данных SQLite и CRUD в `db.js`

**Files:**
- Modify: `db.js`
- Modify: `db.test.js`

**Interfaces:**
- Produces:
  - Миграция таблицы `players`: колонки `stock_star_coupons`, `stock_legendary_stars_1`, `stock_legendary_stars_2`, `stock_legendary_stars_3`.
  - Обновление маппинга игрока в `db.getPlayers`, `db.getPlayerById`, `db.createPlayer`, `db.savePlayer`: сохранение и выдача расширенного объекта `stock`.
  - Обновление `exportKowJson` и `importKowJson` для сохранения новых полей запасов.

- [ ] **Step 1: Написать падающий тест в `db.test.js`**
  - Проверка сохранения и чтения новых полей склада (`starCoupons`, `legendaryStars1`, `legendaryStars2`, `legendaryStars3`).
  - Проверка сохранения значений при импорте/экспорте.
  - Проверка автомиграции существующей базы без этих колонок.

- [ ] **Step 2: Запустить тест и убедиться, что он падает (RED)**
  - Запуск: `node db.test.js`.

- [ ] **Step 3: Реализовать миграцию колонок и обновить методы в `db.js` (GREEN)**
  - В `initDb()` добавить проверку `PRAGMA table_info(players)` и добавление отсутствующих колонок.
  - Обновить `INSERT`/`UPDATE` запросы в `createPlayer` и `savePlayer`.
  - Обновить сериализацию в `exportKowJson` и `importKowJson`.

- [ ] **Step 4: Запустить тесты базы данных**
  - Запуск: `node db.test.js && node logic.test.js`. Ожидается: PASS.

- [ ] **Step 5: Сделать git commit**
  ```bash
  git add db.js db.test.js
  git commit -m "feat(db): add star coupons and legendary stars 1-3 columns with safe migrations"
  ```

---

### Task 3: Серверный слой, REST API и поддержка WASM в `server.js`

**Files:**
- Modify: `server.js`
- Modify: `api.test.js`

**Interfaces:**
- Produces:
  - Поддержка MIME-типа `application/wasm` для расширения `.wasm` в отдаче статических файлов.
  - Санитизация новых полей склада в `PUT /api/my-profile` и `PUT/POST /api/players`.
  - Тесты в `api.test.js` для обновления новых полей склада через API.

- [ ] **Step 1: Написать падающий интеграционный тест в `api.test.js`**
  - Тест обновления профиля `PUT /api/my-profile` с новыми полями запасов звезд.
  - Тест отдачи `.wasm` файлов с корректным заголовком `Content-Type: application/wasm`.

- [ ] **Step 2: Запустить тест и убедиться, что он падает (RED)**
  - Запуск: `node api.test.js`.

- [ ] **Step 3: Реализовать обработку в `server.js` (GREEN)**
  - Добавить `.wasm: 'application/wasm'` в `MIME_TYPES`.
  - Обновить санитизацию `body.stock` в маршрутах `/api/my-profile` и `/api/players/:id`.

- [ ] **Step 4: Запустить тесты API**
  - Запуск: `node api.test.js`. Ожидается: PASS.

- [ ] **Step 5: Сделать git commit**
  ```bash
  git add server.js api.test.js
  git commit -m "feat(api): support wasm mime type and sanitize star stock fields in profile"
  ```

---

### Task 4: Клиентский модуль распознавания и предобработки изображений (`ocr.js`)

**Files:**
- Create: `ocr.js`
- Modify: `sw.js` (кэширование OCR ассетов)

**Interfaces:**
- Produces:
  - `preprocessImageForOcr(imageElementOrCanvas)`: Canvas-предобработка (бинаризация, контрастирование, разделение 2 колонок склада при необходимости).
  - `runSmartOcr(imageFiles, onProgress)`: оркестрация Web Worker Tesseract.js, предобработка каждого файла, извлечение текста, вызов `logic.parseProfileScreenshotText`, `logic.parseWarehouseScreenshotText` и агрегация через `logic.mergeScanResults`.
  - Поддержка offline-кэша в Service Worker.

- [ ] **Step 1: Реализовать модуль `ocr.js`**
  - Функция создания Canvas и фильтрации пикселей (Grayscale + Threshold).
  - Метод распознавания одного изображения через Web Worker Tesseract.js.
  - Цикл обработки пачки скриншотов с вызовом коллбэка прогресса `(current, total, stage)`.
  - Классификация скриншота (профиль vs склад) и передача в соответствующий парсер `logic.js`.
  - Слияние результатов пачки скриншотов в единый итоговый объект данных.

- [ ] **Step 2: Обновить `sw.js`**
  - Добавить `/ocr.js` в `STATIC_ASSETS` сервисного воркера.

- [ ] **Step 3: Проверить синтаксис скрипта**
  - Запуск: `node -c ocr.js && node -c sw.js`.

- [ ] **Step 4: Сделать git commit**
  ```bash
  git add ocr.js sw.js
  git commit -m "feat(ocr): add client-side canvas preprocessor and tesseract worker pipeline"
  ```

---

### Task 5: Пользовательский интерфейс Smart Scanner и обновление названий склада

**Files:**
- Modify: `index.html`
- Modify: `style.css`
- Modify: `app.js`

**Interfaces:**
- UI components:
  - Переименование полей склада в личном кабинете:
    - «Новые купоны» ➔ «Купон готовности офицера»
    - «Новые пазлы» ➔ «Медаль легендарного офицера»
    - «Новые сундуки» ➔ «Сундук выбора»
  - Новые поля в карточке склада: «Купон готовности звезды», «Легендарная звезда I (110)», «Легендарная звезда II (420)», «Легендарная звезда III (960)».
  - Виджет динамического подсчета суммы очков звезд: `#total-star-points-badge` с отображением формулы и итогового числа.
  - Кнопка вызова сканера: `📷 Smart Scanner` в личном кабинете и окне редактирования игрока.
  - Модальное окно `#modal-smart-scanner`:
    - Dropzone для файлов с поддержкой Drag-and-Drop, мультивыбора и `Ctrl+V`.
    - Прогресс-бар сканирования.
    - Карточка результатов предпросмотра (статистика игрока + запасы склада + итого очков звезд).
    - Защита от случайной перезаписи никнейма (чекбокс).
    - Кнопка «✓ Применить в профиль» (заполняет поля и сохраняет через API).

- [ ] **Step 1: Обновить разметку в `index.html`**
  - Актуализировать названия полей в `my_cabinet`.
  - Добавить блок легендарных звезд и бейдж суммы очков.
  - Добавить разметку модального окна `#modal-smart-scanner`.
  - Подключить скрипт `ocr.js`.

- [ ] **Step 2: Добавить стили в `style.css`**
  - Стили для Dropzone, прогресс-бара OCR, сетки звезд и бейджа `total-star-points-badge`.

- [ ] **Step 3: Связать интерфейс с логикой в `app.js`**
  - Обработчики изменения полей звезд с пересчетом очков через `logic.calculateTotalStarPoints`.
  - Обработчики перетаскивания и вставки из буфера обмена (`paste` event).
  - Функция запуска сканера `handleStartOcrScan(files)`.
  - Отображение карточки предпросмотра и применение результатов `applyScanResultsToProfile()`.

- [ ] **Step 4: Проверить синтаксис и запустить тесты**
  - Запуск: `node -c app.js && npm test`.

- [ ] **Step 5: Сделать git commit**
  ```bash
  git add index.html style.css app.js
  git commit -m "feat(ui): add smart scanner modal, update stock labels and star points calculator"
  ```

---

### Task 6: Финальная верификация, подготовка релиза v3.3.0 и GitFlow

**Files:**
- Modify: `package.json` (повышение версии до `3.3.0`)
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Запустить полный комплекс тестов**
  ```bash
  npm test
  node -c app.js && node -c server.js && node -c sw.js && node -c logic.js && node -c db.js && node -c ocr.js
  ```
  Ожидается: 0 failures, все тесты зеленые.

- [ ] **Step 2: Оформить релизную ветку по GitFlow**
  1. Создать ветку релиза: `git checkout -b release/v3.3.0`.
  2. Обновить версию в `package.json` до `3.3.0`.
  3. Добавить подробное описание изменений в `CHANGELOG.md` по стандарту Keep a Changelog.
  4. Закоммитить: `git commit -am "chore(release): prepare v3.3.0"`.

- [ ] **Step 3: Слить в master и поставить аннотированный тег**
  ```bash
  git checkout master
  git merge --no-ff release/v3.3.0 -m "Merge branch 'release/v3.3.0' into master"
  git tag -a v3.3.0 -m "Release v3.3.0: Smart Scanner OCR, updated stock labels and legendary star points"
  git branch -d release/v3.3.0 feature/smart-scanner-ocr
  ```
