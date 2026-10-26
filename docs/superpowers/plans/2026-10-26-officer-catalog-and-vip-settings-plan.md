# План реализации: Каталог офицеров, параметры подготовки, OCR магазина обмена и настройка шкалы VIP

**Спецификация:** `docs/superpowers/specs/2026-10-26-officer-catalog-and-vip-settings-design.md`  
**Ветка:** `feature/officer-catalog-and-vip-settings`  
**Целевой релиз:** `v3.5.0`

---

## Задачи плана

### Task 1: База данных SQLite (`db.js`, `db.test.js`)
- [ ] Добавить таблицу `vip_tiers` с полями `level`, `points`, `daily_puzzles`, `daily_chests`.
- [ ] Инициализировать по умолчанию 30 уровней VIP с точным значением VIP 14 = 750 000 очков.
- [ ] Реализовать функции `getVipTiers()` и `setVipTiers(tiers)`.
- [ ] Обновить таблицу `officer_catalog`: колонка `star_coupon_cost`, базовые значения `medals_before_training = 480`, `medals_training = 900`, `medals_total = 1380`.
- [ ] Удалить принудительный авто-сидинг `COMMUNITY_OFFICERS` в `initDb()`.
- [ ] Очистить устаревшие записи из `officer_catalog`.
- [ ] Добавить модульные TDD тесты в `db.test.js`.

### Task 2: REST API серверного слоя (`server.js`, `api.test.js`)
- [ ] Эндпоинты `GET /api/vip-tiers` (для всех) и `PUT /api/vip-tiers` (только `['r4', 'r5']`).
- [ ] Обновить CRUD `/api/catalog` для поддержки новых полей (`starCouponCost`, `medalsBeforeTraining`, `medalsTraining`, `medalsTotal`).
- [ ] Добавить `POST /api/catalog/batch` для пакетного добавления/обновления офицеров из OCR магазина.
- [ ] Добавить интеграционные TDD тесты в `api.test.js`.

### Task 3: Клиентская логика и парсер магазина обмена (`logic.js`, `logic.test.js`)
- [ ] Константа `OFFICER_TYPES = ['Танк', 'Пехота', 'ПТ-Сау', 'Горнизон', 'Осада']`.
- [ ] Чистая функция `calculateTotalMedals(beforeTraining, training)`.
- [ ] Функция `parseExchangeShopScreenshotText(text)` для парсинга магазина обмена (сезон, имена, купоны на пазл, купоны на звёзды).
- [ ] Обновить `calculateVipDeficit` и `dailyRewards` для поддержки динамической шкалы `vipTiers`.
- [ ] Добавить модульные TDD тесты в `logic.test.js`.

### Task 4: UI Навигация, экран каталога и модалка офицера (`index.html`, `style.css`, `app.js`)
- [ ] Добавить пункт «🎖️ Каталог офицеров» в боковое меню.
- [ ] Создать экран `#page-catalog` с адаптивной таблицей офицеров, empty-state и кнопками действий.
- [ ] Создать модальное окно `#modal-catalog-officer` с динамическим интерактивным расчетом `medalsTotal`.
- [ ] Стили в `style.css` (бейджи типов войск, кнопки, адаптивность).

### Task 5: UI Модальное окно настройки шкалы VIP (`index.html`, `style.css`, `app.js`)
- [ ] Создать модальное окно `#modal-vip-tiers` с таблицей 1..30, инпутами очков и ежедневных пазлов.
- [ ] Подсветка уровня VIP 14 (750 000).
- [ ] Обработчик сохранения через `PUT /api/vip-tiers` с мгновенным обновлением кэша и пересчетом подсказок.

### Task 6: UI OCR-сканер магазина обмена (`index.html`, `style.css`, `ocr.js`, `app.js`)
- [ ] Создать модальное окно `#modal-exchange-ocr` с Drag & Drop, выбором файлов и вставкой из буфера (`Ctrl+V`).
- [ ] Процесс сканирования через Tesseract.js и `logic.parseExchangeShopScreenshotText`.
- [ ] Карточка предпросмотра со списком офицеров, селектором типа войск (`['Танк', 'Пехота', 'ПТ-Сау', 'Горнизон', 'Осада']`) и кнопкой «Добавить всех в каталог».

### Task 7: Комплексное тестирование, ревью и релиз `v3.5.0` по GitFlow
- [ ] Прогнать полный тестовый набор (`npm test`).
- [ ] Провести Whole-Branch Review.
- [ ] Создать релизную ветку `release/v3.5.0`, обновить `package.json` и `CHANGELOG.md`.
- [ ] Влить в `master` с флагом `--no-ff` и аннотированным тегом `v3.5.0`.
- [ ] Удалить временные ветки.
