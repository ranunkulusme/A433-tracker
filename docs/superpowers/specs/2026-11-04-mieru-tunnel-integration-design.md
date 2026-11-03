# Дизайн-спецификация: Интеграция туннеля Mieru и SOCKS5-проксирования для Telegram Bot

## 1. Контекст и цели
В условиях блокировки `api.telegram.org` у ряда хостинг-провайдеров и в РФ сервер KoW Tracker не может напрямую обмениваться данными с Telegram.
Пользователь использует протокол **Mieru** на внешнем удаленном сервере и хочет управлять параметрами клиентского туннеля непосредственно через веб-интерфейс KoW Tracker (раздел настроек бота под Р5).

### Цели:
1. Поддержка двух режимов ввода параметров Mieru:
   - **Поля формы:** Адрес сервера, диапазон портов, логин (User), пароль, протокол (TCP/UDP), локальный SOCKS5 порт.
   - **Raw JSON:** Вставка готового стандартного файла `client.json` от Mieru с валидацией структуры.
   - Двусторонняя синхронизация между полями формы и JSON-редактором.
2. Автономное управление клиентом Mieru на бэкенде:
   - Генерация защищенного конфигурационного файла `data/mieru-client.json`.
   - Запуск/перезапуск/остановка фонового процесса клиента Mieru при сохранении настроек или старте сервера.
   - Отслеживание статуса процесса и доступности локального SOCKS5-порта.
3. Нативный SOCKS5/HTTP прокси-клиент в `telegram.js`:
   - Полная реализация протокола SOCKS5 (RFC 1928) и HTTP CONNECT на чистых встроенных модулях Node.js (`node:net` и `node:tls`).
   - Нулевые внешние npm-зависимости (строгое соблюдение правил проекта).
4. Эндпоинт и кнопка интерактивной проверки:
   - `POST /api/mieru/test` отправляет проверочный запрос к Telegram Bot API через локальный прокси Mieru и замеряет пинг.
   - Отображение статуса в UI: `🟢 Подключено (ответ от Telegram: 95ms)` или `🔴 Ошибка подключения: ...`.
5. Полная интернационализация (100% i18n паритет ключей `ru`, `en`, `de`).
6. Обновление `Dockerfile` для включения бинарника `mieru` в образ контейнера.

---

## 2. Формат конфигурации Mieru

```json
{
  "profiles": [
    {
      "profileName": "default",
      "serverAddress": "194.87.123.45",
      "portRanges": ["10000-10050"],
      "user": "my_user",
      "password": "my_password",
      "transport": "TCP",
      "multiplexing": "MULTIPLEXING_MIDDLE"
    }
  ],
  "activeProfile": "default",
  "socks5Port": 1080,
  "httpPort": 1081,
  "logging": {
    "level": "INFO"
  }
}
```

---

## 3. Схема данных (`db.js`)
В таблице `app_settings` хранятся следующие ключи:
- `mieru_enabled`: `'true'` | `'false'` (по умолчанию `'false'`)
- `mieru_server`: string (IP или домен)
- `mieru_port_range`: string (например `"10000-10050"`)
- `mieru_user`: string
- `mieru_password`: string (хранится в открытом виде для генерации конфига Mieru, маскируется при отдаче в GET API)
- `mieru_transport`: string (`'TCP'` | `'UDP'`, по умолчанию `'TCP'`)
- `mieru_socks5_port`: string (по умолчанию `'1080'`)
- `mieru_config_json`: string (опциональный сырой JSON)

---

## 4. API Эндпоинты (`server.js`)
1. `GET /api/mieru/settings` (R4/R5):
   - Возвращает `{ enabled, server, portRange, user, passwordMasked, transport, socks5Port, configJson, isRunning, lastCheck }`.
2. `PUT /api/mieru/settings` (Р5):
   - Принимает `{ enabled, server, portRange, user, password, transport, socks5Port, configJson }`.
   - Сохраняет настройки в БД.
   - Если `enabled === true`, генерирует конфиг и перезапускает процесс `mieru`.
   - Если `enabled === false`, останавливает процесс `mieru`.
3. `POST /api/mieru/test` (R4/R5):
   - Выполняет запрос к `getTelegramMe` через SOCKS5-прокси на `127.0.0.1:socks5Port`.
   - Возвращает `{ ok, latencyMs, botUsername, error }`.

---

## 5. UI и Интернационализация
Новый блок в `#page-notifications`:
- Тумблер активации туннеля Mieru.
- Вкладки: «По полям» / «Код JSON» с автоматической двусторонней конвертацией.
- Кнопка проверки туннеля со спиннером и индикатором задержки.
- Все строки переведены в пространстве имен `mieru.*` в `i18n.js` для `ru`, `en`, `de`.
