# План реализации: Архитектурное углубление кодовой базы KoW Tracker

> **Для агентов-исполнителей:** ОБЯЗАТЕЛЬНЫЙ НАВЫК: Используйте `superpowers:executing-plans` для пошаговой реализации задач. Шаги используют синтаксис чекбоксов (`- [ ]`) для отслеживания прогресса.

**Цель:** Реализовать все 4 архитектурных углубления (EventOperations, TelegramBotController, OfficerProgression, Decouple TMA), превратив поверхностные модули и монолитные блоки кода в глубокие модули с чистыми швами и атомарной надежностью.

**Архитектура:** 
1. Создание глубокого модуля `event-ops.js` для устранения дублирования логики ивентов между HTTP и Telegram.
2. Создание глубокого модуля `bot-controller.js` для выноса 1800 строк диспетчеризации Telegram из `server.js`.
3. Создание глубокого модуля `officer-progression.js` для объединения расчета стоимости, списания склада и аудита в атомарную транзакцию.
4. Разделение клиентского монолита `app.js` с выносом логики мобильного Telegram Mini App в `tma.js`.

**Стек технологий:** Node.js (нативные модули `node:http`, `node:sqlite`, `node:crypto`), vanilla JavaScript (ES6+), UMD-шаблоны для совместимости браузера и сервера. Нулевые внешние npm-зависимости.

---

## Глобальные ограничения

1. Строгое следование методологии **GitFlow** (разработка в ветке `feature/architecture-deepening`, запрет прямых коммитов в `main`).
2. TDD-подход: написание тестов перед реализацией или параллельно с ней.
3. Нулевые внешние зависимости сервера (`server.js`, `db.js`, новые модули) — только встроенные модули Node.js.
4. Сохранение 100% обратной совместимости с базой данных `data/kow.db`, экспортом/импортом `kow_v2` и существующими API-контрактами.
5. Зеленый прогон полного набора тестов (`npm test`) с 0 падений (0 failures).

---

## Задачи реализации

### Задача 1: Глубокий модуль EventOperations (Кандидат №1)

**Файлы:**
- Создать: `event-ops.js`
- Создать: `event-ops.test.js`
- Изменить: `server.js` (маршруты `/api/events/:id/rsvp`, `/api/events/:id/submit-result`, `/api/events/:id/register`, `/api/events`)

- [ ] **Шаг 1.1:** Написать падающие модульные тесты в `event-ops.test.js`:
  - `rsvpEvent`: успешное подтверждение ('confirmed') и отказ ('declined') с корректной проверкой владельца/офицера.
  - `submitEventResult`: начисление купонов на склад, создание записи аудита, пометка `accrued = true`.
  - Запрет повторного начисления, если `accrued = true`.
  - `registerForEvent` и `unregisterFromEvent`: валидация слотов и секторов.
- [ ] **Шаг 1.2:** Запустить `PATH="/opt/homebrew/bin:$PATH" node event-ops.test.js` и убедиться в фазе RED.
- [ ] **Шаг 1.3:** Реализовать `event-ops.js`:
  - Интерфейс: `createEventOperations({ db, logic, dispatchNotification, telegram })`
  - Методы: `rsvpEvent`, `submitEventResult`, `registerForEvent`, `unregisterFromEvent`, `notifyAssignedPlayers`.
- [ ] **Шаг 1.4:** Запустить `event-ops.test.js` и убедиться в фазе GREEN.
- [ ] **Шаг 1.5:** Переключить вызовы в `server.js` (в HTTP-маршрутах и Telegram update-хэндлерах) на `eventOps`.
- [ ] **Шаг 1.6:** Запустить интеграционные тесты `api.test.js` и `logic.test.js`.
- [ ] **Шаг 1.7:** Зафиксировать коммит `refactor(events): consolidate event operations and rsvp into deep module`.

---

### Задача 2: Глубокий контроллер Telegram-бота (Кандидат №2)

**Файлы:**
- Создать: `bot-controller.js`
- Создать: `bot-controller.test.js`
- Изменить: `server.js` (удаление 1800 строк из `handleTelegramUpdate` и делегирование в `botController`)

- [ ] **Шаг 2.1:** Написать модульные тесты в `bot-controller.test.js`:
  - Обработка команды `/start` с bind-токеном и без него.
  - Обработка команды `/bind <login> <password>`.
  - Диспетчеризация кнопок главного меню (`cmd_me`, `cmd_deficit`, `cmd_events`).
  - Маршрутизация RSVP-кнопок через `eventOps`.
  - Обработка команды `/stock` и фото со складом.
- [ ] **Шаг 2.2:** Запустить `PATH="/opt/homebrew/bin:$PATH" node bot-controller.test.js` (фаза RED).
- [ ] **Шаг 2.3:** Реализовать `bot-controller.js`:
  - Экспорт функции `createTelegramBotController({ db, logic, telegram, eventOps, ocr, getAppBaseUrl })`.
  - Метод `handleUpdate(update)` с инкапсуляцией всех сообщений и callback-кверей.
- [ ] **Шаг 2.4:** Запустить `bot-controller.test.js` (фаза GREEN).
- [ ] **Шаг 2.5:** Рефакторинг `server.js`: заменить тело `handleTelegramUpdate` на вызов `botController.handleUpdate(update)`.
- [ ] **Шаг 2.6:** Запустить `telegram.test.js` и `api.test.js`.
- [ ] **Шаг 2.7:** Зафиксировать коммит `refactor(telegram): extract deep telegram bot controller from server monolith`.

---

### Задача 3: Атомарная прокачка офицеров и списание склада (Кандидат №3)

**Файлы:**
- Создать: `officer-progression.js`
- Создать: `officer-progression.test.js`
- Изменить: `server.js` (эндпоинты `/api/my-profile/officers`, `/api/my-profile/officers/:id`)
- Изменить: `app.js` (замена двухшагового PUT на один запрос)

- [ ] **Шаг 3.1:** Написать тесты в `officer-progression.test.js`:
  - Повышение звезд офицера с автоматическим и атомарным списанием звездных купонов и звезд со склада игрока.
  - Ошибка при нехватке ресурсов со склада без изменения состояния офицера (атомарность).
  - Поддержка ретро-режима (обновление без списания ресурсов).
  - Запись аудита изменений склада с детализированным `diffSummary`.
  - Создание нового офицера в режиме прокачки с первоначальным списанием материалов.
- [ ] **Шаг 3.2:** Запустить `PATH="/opt/homebrew/bin:$PATH" node officer-progression.test.js` (фаза RED).
- [ ] **Шаг 3.3:** Реализовать `officer-progression.js`:
  - Функция `createOfficerProgression({ db, logic })`.
  - Методы: `addOfficer`, `updateOfficer`, `deleteOfficer`.
- [ ] **Шаг 3.4:** Запустить `officer-progression.test.js` (фаза GREEN).
- [ ] **Шаг 3.5:** Интегрировать `officerProgression` в `server.js`: возвращать обновленный `stock` вместе с офицером.
- [ ] **Шаг 3.6:** Обновить `app.js`: устранить второй вызов `PUT /api/my-profile` в пользу ответа сервера.
- [ ] **Шаг 3.7:** Зафиксировать коммит `feat(officers): atomic officer progression and warehouse deduction`.

---

### Задача 4: Выделение Telegram Mini App (TMA) клиента (Кандидат №4)

**Файлы:**
- Создать: `tma.js`
- Изменить: `index.html` (подключение `tma.js`)
- Изменить: `app.js` (вынесение TMA контроллера и вьюшек)

- [ ] **Шаг 4.1:** Перенести функции TMA из `app.js` (строки 13076-16130) в специализированный модуль `tma.js`:
  - Управление окружением Telegram WebApp: `isTmaMode()`, `enableTmaView()`, `setupTmaEnvironment()`, `tmaHaptic()`.
  - Контроллеры экранов: `renderTmaCabinet()`, `renderTmaEvents()`, `renderTmaMatrix()`.
  - Редакторы и модалки TMA: `openTmaEventEditor()`, `openTmaSectorDossier()`.
- [ ] **Шаг 4.2:** Добавить подключение `<script src="tma.js"></script>` в `index.html`.
- [ ] **Шаг 4.3:** Проверить работоспособность синтаксиса: `PATH="/opt/homebrew/bin:$PATH" node -c app.js && node -c tma.js`.
- [ ] **Шаг 4.4:** Проверить инициализацию TMA и десктопного режима в браузере.
- [ ] **Шаг 4.5:** Зафиксировать коммит `refactor(frontend): decouple telegram mini app client into dedicated tma.js module`.

---

### Задача 5: Полная верификация всех тестов и слияние по GitFlow

- [ ] **Шаг 5.1:** Добавить новые тесты в `package.json` в команду `npm test`.
- [ ] **Шаг 5.2:** Запустить полный набор тестов:
  `PATH="/opt/homebrew/bin:$PATH" npm test`
- [ ] **Шаг 5.3:** Проверить синтаксис всех файлов:
  `PATH="/opt/homebrew/bin:$PATH" node -c server.js && node -c app.js && node -c tma.js && node -c event-ops.js && node -c bot-controller.js && node -c officer-progression.js`
- [ ] **Шаг 5.4:** Подготовить релизную ветку или отчет для пользователя.
