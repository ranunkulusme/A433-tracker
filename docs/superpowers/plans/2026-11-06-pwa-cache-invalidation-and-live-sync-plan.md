# План реализации: Инвалидация кэша, живая синхронизация данных и PWA-жизненный цикл (Live Sync & Cache Control)

- **Дата**: 2026-11-06
- **Ветка разработки**: `feature/pwa-live-sync-and-cache-control`
- **Спецификация**: [`docs/superpowers/specs/2026-11-06-pwa-cache-invalidation-and-live-sync-spec.md`](file:///Users/ranunkulus/Downloads/KOW/docs/superpowers/specs/2026-11-06-pwa-cache-invalidation-and-live-sync-spec.md)

---

## Задачи плана

### Задача 0: Актуализация названия проекта в `README.md`
- Заменить «Kingdom of Winners (KoW)» на «Kiss of War».

### Задача 1: Антикэширование динамических API (HTTP Cache Control) — TDD
1. В `api.test.js`:
   - Добавить тесты на проверку антикэш-заголовков (`Cache-Control: no-store...`, `Pragma: no-cache`, `Expires: 0`) во всех ответах `sendJson()`.
   - Добавить тест, подтверждающий иммутабельность кэша скриншотов (`/api/screenshots/:filename`).
   - Добавить тест на мутацию прав пользователя через `PATCH /api/users/:id` с немедленным чтением через `GET /api/users`.
2. В `server.js`:
   - Модифицировать `sendJson(res, statusCode, data)`: добавить `Cache-Control: no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0`, `Pragma: no-cache`, `Expires: 0`, `Surrogate-Control: no-store`.
3. В `app.js`:
   - В `apiFetch(url, options)` гарантировать передачу `{ cache: 'no-store' }` и заголовков `Pragma`, `Cache-Control`.
   - В `submitUserPermissions()`, `handleChangeUserRank()`, `handleToggleBlockUser()` обновить оптимистичное состояние и вызов `renderUsers()`.

### Задача 2: Словарь мультиязычности и паритет ключей (`i18n.js`, `i18n.test.js`) — TDD
1. В `i18n.test.js`:
   - Добавить тест проверки ключей `pwa.*` и `toasts.sync_success`, `common.sync` на паритет в `ru`, `en`, `de`.
2. В `i18n.js`:
   - Добавить переводы для баннера обновления PWA и кнопки синхронизации.
3. Прогнать `node i18n.test.js`.

### Задача 3: Жизненный цикл Service Worker и PWA-баннер обновления (`sw.js`, `app.js`, `index.html`, `style.css`)
1. В `sw.js`:
   - Обновить версию кэша `CACHE_NAME` до готовящегося релиза `kow-cache-v3.38.0`.
   - Проверить удаление старых кэшей в `activate`.
2. В `index.html`:
   - Добавить разметку плавающего баннера `#pwa-update-banner` с кнопкой обновления.
3. В `style.css`:
   - Добавить адаптивные стили для баннера обновления и анимацию появления.
4. В `app.js`:
   - Настроить отслеживание `updatefound`, `controllerchange`, функции `showPwaUpdatePrompt()`, `applyAppUpdate()`, `dismissAppUpdate()`.
   - Экспортировать функции в `window`.

### Задача 4: Инструменты синхронизации PWA (Кнопка в Topbar и фоновый Silent Sync)
1. В `index.html`:
   - Добавить кнопку `#btn-global-sync` в `.topbar-right` рядом с профилем и переключателем языков.
2. В `style.css`:
   - Добавить стили кнопки синхронизации и анимацию вращения `@keyframes spin`.
3. В `app.js`:
   - Реализовать функцию `handleGlobalSync()`:
     - Включает анимацию вращения.
     - Вызывает `await loadDataFromServer()`.
     - Перерисовывает текущий активный экран (`renderUsers()`, `renderMyCabinet()` или `navigate(currentPage, pageParams)`).
     - Выводит тост `t('toasts.sync_success')`.
     - Снимает анимацию вращения.
   - Реализовать фоновую тихую синхронизацию при возвращении в приложение:
     - Слушатель `document.addEventListener('visibilitychange')`.
     - Порог неактивности: 3 минуты.
     - При возвращении — вызов `loadDataFromServer()` и перерисовка экрана в тихом режиме.
   - Экспортировать `handleGlobalSync` в `window`.

### Задача 5: Полное тестирование, верификация и релизный процесс по GitFlow
1. Запуск всех тестов:
   - `node -c server.js sw.js app.js logic.js i18n.js`
   - `npm test` (все тесты logic, db, s3, telegram, api, deploy, i18n зеленые).
2. Подготовка релиза:
   - Создание ветки `release/v3.38.0`.
   - Повышение версии в `package.json` до `3.38.0`, в `app.js` (`APP_VERSION = 'v3.38.0'`), в `sw.js` (`CACHE_NAME = 'kow-cache-v3.38.0'`).
   - Заполнение `CHANGELOG.md` по стандарту Keep a Changelog.
3. Слияние в `main`:
   - `git checkout main`
   - `git merge --no-ff release/v3.38.0 -m "Merge branch 'release/v3.38.0' into main"`
   - Аннотированный тег `git tag -a v3.38.0 -m "Release v3.38.0: PWA live sync, cache control and update banner"`.
   - Удаление временных веток `feature/*` и `release/*`.
