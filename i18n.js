/**
 * KoW Tracker - i18n Multilingual Support (RU, EN, DE)
 * Built on top of i18next (v23.x).
 * Supports browser environment (window.i18next) and Node.js runtime.
 */

const I18N_RESOURCES = {
  "ru": {
    "translation": {
      "common": {
        "save": "Сохранить",
        "cancel": "Отмена",
        "delete": "Удалить",
        "edit": "Редактировать",
        "close": "Закрыть",
        "online": "Онлайн",
        "offline": "Офлайн",
        "loading": "Загрузка...",
        "search": "Поиск...",
        "all": "Все",
        "actions": "Действия",
        "back": "Назад",
        "confirm": "Подтвердить",
        "yes": "Да",
        "no": "Нет",
        "status": "Статус",
        "date": "Дата",
        "version": "Версия",
        "in_queue": "В очереди: {{count}}",
        "syncing": "Синхронизация...",
        "syncing_title": "Отправка сохраненных оффлайн-изменений на сервер",
        "offline_mode": "Оффлайн-режим",
        "sync_queue": "В очереди на синхронизацию",
        "connected_title": "Подключено к серверу, все данные сохранены",
        "install_pwa": "Установить",
        "install_pwa_title": "Установить приложение на устройство",
        "logout": "Выйти",
        "logout_title": "Выйти из аккаунта",
        "pending_approval": "Ожидают одобрения",
        "requests_one": "заявка",
        "requests_few": "заявки",
        "requests_many": "заявок",
        "requests_other": "заявок",
        "user": "Пользователь",
        "refresh": "Обновить",
        "sync": "Синхронизировать",
        "change_password": "Сменить пароль",
        "active_now": "Идут сейчас",
        "upcoming": "Предстоящие",
        "past": "Прошедшие",
        "none": "Нет",
        "not_found": "Не найдено",
        "generation_short": "Ген. {{gen}}"
      },
      "auth": {
        "login": "Вход",
        "register": "Регистрация",
        "account_blocked": "Доступ к аккаунту заблокирован руководством гильдии"
      },
      "nav": {
        "calendar": "Календарь",
        "sectors": "Секторы",
        "officers": "Каталог офицеров",
        "event_types": "Типы ивентов",
        "event_detail": "Ивент",
        "pending_registrations": "Заявки на регистрацию",
        "calculator": "Калькулятор",
        "users_rights": "Пользователи и права",
        "my_cabinet": "Личный кабинет",
        "export_excel": "Экспорт Excel",
        "export_json": "Экспорт JSON",
        "import_json": "Импорт JSON"
      },
      "roles": {
        "r5": "Р5 — Лидер",
        "r4": "Р4 — Офицер",
        "r3": "Р3 — Рядовой",
        "owner": "Владелец",
        "no_owner": "Без владельца",
        "change_owner": "Сменить владельца"
      },
      "game": {
        "officer_types": {
          "tank": "Танк",
          "infantry": "Пехота",
          "tank_destroyer": "ПТ-САУ",
          "garrison": "Гарнизон",
          "siege": "Осада"
        },
        "awards": {
          "place_1": "1 место",
          "place_2": "2 место",
          "place_3": "3 место",
          "place_4": "4 место",
          "top_1": "ТОП-1",
          "top_2": "ТОП-2",
          "top_3": "ТОП-3",
          "top_4": "ТОП-4"
        },
        "resources": {
          "coupons": "Купоны",
          "puzzles": "Пазлы",
          "chests": "Сундуки",
          "stars": "Звезды",
          "star_coupons": "Звездные купоны",
          "legendary_stars": "Легендарные звезды"
        },
        "items": {
          "coupons": "Купоны",
          "puzzles": "Пазлы",
          "chests": "Сундуки",
          "stars": "Звезды",
          "star_coupons": "Звездные купоны",
          "legendary_stars": "Легендарные звезды"
        },
        "sim": {
          "guaranteed_mode": "Гарантированный режим",
          "optimistic_mode": "Оптимистичный режим",
          "manual_mode": "Ручной ввод",
          "target_level": "Целевой уровень",
          "daily_income": "Ежедневный доход",
          "savings_badge": "⚡ Экономия: {{days}} дн.!",
          "timeline_title": "График прогресса",
          "finish_reached": "Цель достигнута",
          "deficit": "Дефицит",
          "current_progress": "Текущий прогресс",
          "without_events": "Без учета ивентов",
          "with_events": "С учетом ивентов",
          "no_events_guaranteed": "Без ивентов (гарант.)",
          "no_events_optimistic": "Без ивентов (оптим.)"
        }
      },
      "toasts": {
        "saved_success": "Изменения успешно сохранены",
        "saved_successfully": "Изменения успешно сохранены",
        "sync_success": "Данные успешно синхронизированы",
        "error_occurred": "Произошла ошибка: {{error}}",
        "access_denied": "Доступ ограничен правами ранга",
        "import_success": "Импортировано {{count}} записей",
        "export_success": "Данные успешно экспортированы"
      },
      "pwa": {
        "update_available": "Доступно обновление приложения",
        "btn_refresh": "Обновить"
      },
      "audit": {
        "freshness_fresh": "Свежие данные",
        "freshness_warning": "Требует обновления",
        "freshness_stale": "Склад устарел",
        "history_title": "История изменений склада",
        "source_manual": "Ручная правка",
        "source_ocr": "Скриншот (OCR)",
        "archived_screenshot_notice": "Архив: скриншот удален по истечении 30 дней",
        "view_screenshot": "Посмотреть скриншот",
        "btn_history": "История склада",
        "empty_history": "История изменений пока пуста",
        "zoom_title": "Оригинальный скриншот",
        "zoom_in": "Увеличить",
        "zoom_out": "Уменьшить",
        "zoom_reset": "Сброс",
        "diff_coupons": "куп.",
        "diff_puzzles": "пазл.",
        "diff_stars": "зв.",
        "author": "Автор",
        "source": "Источник",
        "unknown_author": "Владелец сектора",
        "today": "сегодня",
        "days_ago": "{{days}} дн. назад",
        "no_data": "нет данных"
      },
      "telegram": {
        "card_title": "Интеграция с Telegram",
        "status_connected": "Подключен",
        "status_not_connected": "Не привязан",
        "btn_connect": "📱 Подключить Telegram",
        "btn_disconnect": "Отключить",
        "notifications_enabled": "Уведомления в Telegram",
        "admin_nav_title": "Уведомления и шаблоны",
        "bot_settings_title": "Настройки Telegram-бота",
        "bot_token": "Токен бота (BotFather)",
        "staff_chat_id": "ID чата штаба",
        "btn_generate_staff_pin": "🔑 Сгенерировать код привязки штаба",
        "staff_pin_modal_title": "Код привязки чата штаба",
        "staff_pin_hint": "Добавьте бота в чат штаба и отправьте команду:",
        "bot_username": "Имя бота (@username)",
        "save_settings": "Сохранить настройки бота",
        "settings_saved": "Настройки бота успешно сохранены",
        "pin_copied": "Команда скопирована в буфер обмена",
        "link_copied": "Ссылка скопирована в буфер обмена",
        "connected_as": "Привязан как @{{username}}",
        "connected_id": "Привязан (Chat ID: {{chatId}})",
        "disconnect_confirm": "Вы действительно хотите отключить Telegram-уведомления?",
        "open_telegram": "Открыть Telegram",
        "pin_expires": "Код действителен 15 минут",
        "staff_chat_hint": "Или укажите отрицательный ID супергруппы вручную",
        "btn_check_status": "🔄 Проверить статус",
        "checking_status": "Проверка привязки...",
        "not_connected_hint": "Привязка ещё не завершена. Отправьте боту /start в Telegram"
      },
      "officers": {
        "stock_mode_title": "Режим склада:",
        "mode_label": "Режим:",
        "mode_retro": "📜 Ретро-режим",
        "mode_retro_short": "📜 Ретро",
        "mode_retro_hint": "Без списания со склада трекера",
        "mode_normal": "⚡ Прокачка",
        "mode_normal_short": "⚡ Прокачка",
        "mode_normal_hint": "Списание ресурсов со склада трекера",
        "mode_officer_retro_toast": "📜 Ретро-режим для офицера (без списания со склада)",
        "mode_officer_normal_toast": "⚡ Режим прокачки для офицера (списание со склада)",
        "toast_retro_updated": "Параметры обновлены (Ретро: без списания)",
        "toast_retro_stars_updated": "Звёзды обновлены (Ретро: без списания со склада)",
        "toast_retro_skills_updated": "Навык обновлен (Ретро: без списания со склада)",
        "stars_label": "Звёзды (0-5★)",
        "btn_reset_stock": "↩️ Сбросить в сток",
        "toast_reset_success": "Офицер сброшен в стоковое состояние, ресурсы возвращены на склад",
        "reset_modal_title": "Сбросить офицера в стоковое состояние"
      },
      "mieru": {
        "card_title": "Туннель Mieru (обход блокировок Telegram)",
        "toggle_enable": "Использовать туннель Mieru для Telegram",
        "tab_form": "📝 По полям",
        "tab_json": "📋 Код JSON",
        "server_address": "Адрес сервера (IP или домен)",
        "port_range": "Порт или диапазон портов",
        "port_range_hint": "Например: 10000-10050 или 443",
        "username": "Пользователь (User / UUID)",
        "password": "Пароль (Password)",
        "transport": "Протокол передачи",
        "socks5_port": "Локальный SOCKS5 порт",
        "socks5_port_hint": "(на этом сервере, обычно 1080, не путайте с портами VPS)",
        "json_label": "Конфигурация Mieru (JSON)",
        "json_placeholder": "Вставьте сюда JSON-конфигурацию клиента Mieru...",
        "btn_save": "💾 Сохранить настройки Mieru",
        "btn_test": "⚡ Проверить туннель Mieru",
        "status_running": "🟢 Туннель активен",
        "status_stopped": "⚪ Туннель выключен",
        "status_error": "🔴 Ошибка туннеля",
        "settings_saved": "Настройки Mieru успешно сохранены",
        "test_success": "Туннель Mieru работает! Telegram ответил за {{ms}}мс",
        "test_error": "Ошибка проверки Mieru: {{error}}"
      },
      "templates": {
        "editor_title": "Редактор шаблонов сообщений",
        "select_template": "Выберите событие",
        "available_placeholders": "Доступные переменные (кликните для вставки)",
        "template_text": "Текст шаблона (HTML)",
        "live_preview": "Предпросмотр (стиль Telegram)",
        "btn_save": "💾 Сохранить шаблон",
        "btn_reset": "↩️ Сбросить к базовому",
        "btn_test": "🚀 Отправить тест в Telegram",
        "save_success": "Шаблон успешно сохранен",
        "reset_success": "Шаблон сброшен к базовому",
        "test_success": "Тестовое сообщение отправлено в Telegram",
        "reset_confirm": "Вы уверены, что хотите сбросить этот шаблон к базовому?",
        "channel_personal": "👤 Личное",
        "channel_staff": "💬 Штаб",
        "empty_text_error": "Текст шаблона не может быть пустым"
      },
      "cabinet": {
        "title": "Личный кабинет",
        "login_required_desc": "Для доступа в личный кабинет войдите в свой аккаунт.",
        "login_btn": "Войти в систему",
        "loading": "Загрузка данных личного кабинета...",
        "no_sectors_title": "У вас пока нет секторов",
        "no_sectors_desc": "Добавьте свою первую базу для отслеживания прокачки офицеров, запасов и участия в ивентах альянса!",
        "btn_create_first_sector": "+ Создать свой первый сектор",
        "btn_add_sector": "+ Добавить сектор",
        "active_sector": "Активный сектор:",
        "stats_line": "VIP {{vip}} · Секретность {{conf}} · Сила {{power}} · Киллы {{kills}} · Очки {{points}}",
        "sector_params": "Параметры сектора",
        "puzzles_per_day": "+{{count}} пазл/день",
        "vip_level_label": "Уровень VIP (0-17)",
        "vip_points_label": "Очки VIP",
        "hq_level": "Ур. штаба",
        "hq_level_label": "Ур. штаба",
        "hq_level_placeholder": "не указан",
        "hq_badge": "Штаб {{level}}",
        "confidentiality_label": "Конфиденциальность",
        "power_label": "Мощь / Сила",
        "kills_label": "Убито",
        "kill_points_label": "Очки за убийство",
        "daily_income_hint": "Ежедневный доход: +{{count}} пазлов/день (VIP: {{vip}}, Секретность: {{conf}}) + 1 сундук/день.",
        "btn_save_sector": "💾 Сохранить параметры сектора",
        "stocks_title": "Запасы гильдейца",
        "stocks_click_hint": "Кликните на плашку для быстрого изменения",
        "officer_coupon": "Купон офицера",
        "officer_medal": "Медаль офицера",
        "choice_chest": "Сундук выбора",
        "star_coupon": "Купон звезды",
        "stars_123": "Звезды I / II / III",
        "stars_123_rates": "Звезды I (110) / II (420) / III (960)",
        "star_points": "Очки звезд",
        "my_officers": "Мои офицеры",
        "btn_add_officer": "+ Добавить офицера",
        "no_officers_desc": "У вас пока нет офицеров в профиле. Нажмите «+ Добавить офицера», чтобы добавить первого офицера!",
        "gen_short": "Ген. {{gen}}",
        "only_personal": "Только личные",
        "stars_label": "Звёзды:",
        "star_ready": "5★ Готово",
        "star_needed": "Нужно 5★",
        "star_max": "5★ Максимум (98 000 звёзд)",
        "star_to_next": "До {{next}}★: {{cost}} звёзд",
        "level_label": "Уровень:",
        "puzzles_label": "Пазлы:",
        "coupons_label": "Купоны:",
        "deficit_to_180": "Дефицит до 180:",
        "forecast_without_events": "Прогноз без ивентов:",
        "only_personal_medals": "Только личные медали",
        "simulator_title": "Персональный симулятор прокачки до 180 уровня",
        "officer_for_calc": "Офицер для расчета",
        "target_level_label": "Целевой уровень прокачки",
        "timeline_header": "Хронология прокачки по событиям календаря:",
        "btn_open_calendar": "📅 Открыть календарь событий",
        "forecast_goal": "Прогноз достижения цели:",
        "unreachable": "Не достижимо",
        "in_days": "через {{days}} дн.",
        "available_in_stock": "Доступно на складе для Ген. {{gen}}:"
      },
      "events": {
        "title": "Ивенты",
        "btn_create_season": "⚡ Создать сезон",
        "btn_create_event": "+ Создать ивент",
        "active_now": "● Идут сейчас",
        "upcoming": "◎ Предстоящие",
        "past": "◌ Прошедшие",
        "empty_events": "Ивентов нет. Создайте первый!",
        "status_active": "● Идёт",
        "status_upcoming": "◎ Скоро",
        "status_past": "◌ Завершён",
        "assignments_count": "{{count}} назначений",
        "coupons_count": "{{count}} купонов",
        "more_assignments": "+ ещё {{count}} назначений",
        "no_assignments": "Назначений нет",
        "btn_register": "📝 Зарегистрироваться на ивент",
        "btn_register_sector": "+ Зарегистрировать сектор",
        "edit_registration": "Изменить",
        "cancel_registration": "Отменить",
        "any_place": "Любое",
        "place_num": "Место {{place}}",
        "event_detail": "Детали ивента"
      },
      "sectors": {
        "title": "Секторы альянса",
        "btn_add_sector": "+ Добавить сектор",
        "filter_officers_title": "Фильтр по офицерам (связки и пары):",
        "clear_filter": "✕ Очистить фильтр",
        "officer_1": "Офицер 1:",
        "officer_2": "Офицер 2 (в пару):",
        "any_officer": "— Любой офицер —",
        "any_pair": "— Любой в пару —",
        "found_count": "Найдено: {{count}} из {{total}}",
        "total_sectors": "Всего секторов: {{count}}",
        "combo_search": "Связка для поиска:",
        "th_sector": "Сектор (База)",
        "th_owner": "Владелец",
        "th_rank": "Ранг",
        "th_stats": "Сектор (Статы)",
        "th_officers": "Офицеры",
        "th_stocks": "Запасы"
      },
      "catalog": {
        "title": "Каталог офицеров",
        "subtitle": "Реестр командиров альянса, параметры доподготовки, подготовки и курсы обмена",
        "btn_add_officer": "+ Добавить офицера",
        "btn_ocr_store": "📷 Распознать из магазина",
        "btn_vip_scale": "⭐ Настройка шкалы VIP",
        "empty_catalog": "Каталог офицеров пуст",
        "th_officer": "Офицер",
        "th_type": "Тип войск",
        "th_season": "Сезон",
        "th_coupons_per_puzzle": "Купонов на медаль",
        "th_star_cost": "Купонов за 110★",
        "th_before_training": "До подготовки",
        "th_training": "Подготовка",
        "th_total_medals": "Всего медалей",
        "hint_auto_cost": "💡 Авторасчёт: {{cost}} купонов на основе S{{gen}} {{type}} ({{baseCost}}) с округлением вверх (+{{pct}}%). Можно изменить вручную.",
        "hint_auto_cost_manual": "💡 Рекомендация для S{{gen}} {{type}}: {{cost}} купонов.",
        "btn_reset_auto_cost": "Вернуть авторасчёт"
      },
      "event_types": {
        "title": "Типы ивентов",
        "btn_create_type": "+ Создать тип ивента",
        "empty_types": "Типы ивентов пока не настроены"
      },
      "calc": {
        "tab_personal": "🎯 Персональный симулятор",
        "tab_matrix": "📊 Сводная матрица гильдии",
        "player_label": "Игрок",
        "no_officers_player": "У игрока нет офицеров для симулятора купонов"
      },
      "pending": {
        "title": "Заявки на регистрацию участников",
        "loading": "Загрузка заявок...",
        "empty": "Нет активных заявок на регистрацию",
        "empty_desc": "Все поступившие заявки обработаны руководствами гильдии.",
        "th_id": "ID",
        "th_login": "Логин",
        "th_character": "Персонаж в гильдии",
        "th_date": "Дата заявки",
        "th_status": "Статус",
        "new_character": "Новый персонаж",
        "status_pending": "⏳ Ожидает",
        "btn_approve_r3": "Одобрить (Р3)",
        "btn_approve_r4": "Одобрить (Р4)",
        "btn_reject": "Отклонить"
      },
      "users": {
        "title": "Управление пользователями гильдии",
        "loading": "Загрузка пользователей...",
        "empty": "Пользователей не найдено",
        "th_login": "Логин",
        "th_character": "Персонаж",
        "th_rank": "Ранг",
        "th_permissions": "Права доступа",
        "th_status": "Статус",
        "th_registered": "Регистрация",
        "full_access": "⚡ Полный доступ",
        "btn_rights": "🛡️ Права",
        "btn_password": "🔑 Пароль",
        "basic_r3": "Базовые (Р3)",
        "active": "✓ Активен",
        "pending": "⏳ Ожидает",
        "rank_r3": "Р3 (Боец)",
        "rank_r4": "Р4 (Чиновник)",
        "rank_r5": "Р5 (Глава)",
        "btn_block": "⛔ Заблокировать",
        "btn_unblock": "✅ Разблокировать",
        "btn_delete": "🗑️ Удалить",
        "status_blocked": "⛔ Заблокирован",
        "confirm_block": "Заблокировать доступ пользователю {{username}}? Все активные сессии будут немедленно прекращены.",
        "confirm_unblock": "Разблокировать доступ пользователю {{username}}?",
        "confirm_delete_title": "Удаление пользователя",
        "confirm_delete_desc": "Вы собираетесь удалить пользователя @{{username}}.",
        "delete_remove_sector": "Удалить сектор игрока вместе с аккаунтом",
        "delete_remove_sector_hint": "Если не ставить галочку, сектор останется в гильдии как свободный (без владельца).",
        "stat_total": "Всего",
        "stat_online": "В сети",
        "stat_blocked": "Заблокировано",
        "tooltip_online": "В сети (онлайн)",
        "tooltip_offline": "Не был в сети",
        "tooltip_last_seen": "Был в сети: {{time}}"
      }
    }
  },
  "en": {
    "translation": {
      "common": {
        "save": "Save",
        "cancel": "Cancel",
        "delete": "Delete",
        "edit": "Edit",
        "close": "Close",
        "online": "Online",
        "offline": "Offline",
        "loading": "Loading...",
        "search": "Search...",
        "all": "All",
        "actions": "Actions",
        "back": "Back",
        "confirm": "Confirm",
        "yes": "Yes",
        "no": "No",
        "status": "Status",
        "date": "Date",
        "version": "Version",
        "in_queue": "In queue: {{count}}",
        "syncing": "Syncing...",
        "syncing_title": "Sending saved offline changes to server",
        "offline_mode": "Offline mode",
        "sync_queue": "In synchronization queue",
        "connected_title": "Connected to server, all data saved",
        "install_pwa": "Install",
        "install_pwa_title": "Install app on device",
        "logout": "Logout",
        "logout_title": "Logout from account",
        "pending_approval": "Pending approval",
        "requests_one": "request",
        "requests_few": "requests",
        "requests_many": "requests",
        "requests_other": "requests",
        "user": "User",
        "refresh": "Refresh",
        "sync": "Synchronize",
        "change_password": "Change Password",
        "active_now": "Active Now",
        "upcoming": "Upcoming",
        "past": "Past",
        "none": "None",
        "not_found": "Not found",
        "generation_short": "Gen. {{gen}}"
      },
      "auth": {
        "login": "Login",
        "register": "Register",
        "account_blocked": "Account access has been blocked by guild leadership"
      },
      "nav": {
        "calendar": "Calendar",
        "sectors": "Sectors",
        "officers": "Officer Catalog",
        "event_types": "Event Types",
        "event_detail": "Event Details",
        "pending_registrations": "Pending Registrations",
        "calculator": "Calculator",
        "users_rights": "Users & Rights",
        "my_cabinet": "My Cabinet",
        "export_excel": "Export Excel",
        "export_json": "Export JSON",
        "import_json": "Import JSON"
      },
      "roles": {
        "r5": "R5 — Leader",
        "r4": "R4 — Officer",
        "r3": "R3 — Member",
        "owner": "Owner",
        "no_owner": "No Owner",
        "change_owner": "Change Owner"
      },
      "game": {
        "officer_types": {
          "tank": "Tank",
          "infantry": "Infantry",
          "tank_destroyer": "Tank Destroyer",
          "garrison": "Garrison",
          "siege": "Siege"
        },
        "awards": {
          "place_1": "1st Place",
          "place_2": "2nd Place",
          "place_3": "3rd Place",
          "place_4": "4th Place",
          "top_1": "TOP-1",
          "top_2": "TOP-2",
          "top_3": "TOP-3",
          "top_4": "TOP-4"
        },
        "resources": {
          "coupons": "Coupons",
          "puzzles": "Puzzles",
          "chests": "Chests",
          "stars": "Stars",
          "star_coupons": "Star Coupons",
          "legendary_stars": "Legendary Stars"
        },
        "items": {
          "coupons": "Coupons",
          "puzzles": "Puzzles",
          "chests": "Chests",
          "stars": "Stars",
          "star_coupons": "Star Coupons",
          "legendary_stars": "Legendary Stars"
        },
        "sim": {
          "guaranteed_mode": "Guaranteed Mode",
          "optimistic_mode": "Optimistic Mode",
          "manual_mode": "Manual Mode",
          "target_level": "Target Level",
          "daily_income": "Daily Income",
          "savings_badge": "⚡ Savings: {{days}} days!",
          "timeline_title": "Progress Timeline",
          "finish_reached": "Goal Reached",
          "deficit": "Deficit",
          "current_progress": "Current Progress",
          "without_events": "Without Events",
          "with_events": "With Events",
          "no_events_guaranteed": "No Events (Guaranteed)",
          "no_events_optimistic": "No Events (Optimistic)"
        }
      },
      "toasts": {
        "saved_success": "Changes saved successfully",
        "saved_successfully": "Changes saved successfully",
        "sync_success": "Data successfully synchronized",
        "error_occurred": "An error occurred: {{error}}",
        "access_denied": "Access denied by rank permissions",
        "import_success": "Imported {{count}} records",
        "export_success": "Data exported successfully"
      },
      "pwa": {
        "update_available": "An application update is available",
        "btn_refresh": "Update"
      },
      "audit": {
        "freshness_fresh": "Fresh data",
        "freshness_warning": "Needs update",
        "freshness_stale": "Stock is stale",
        "history_title": "Warehouse Audit History",
        "source_manual": "Manual edit",
        "source_ocr": "Screenshot (OCR)",
        "archived_screenshot_notice": "Archive: screenshot removed after 30 days",
        "view_screenshot": "View screenshot",
        "btn_history": "Stock History",
        "empty_history": "No history recorded yet",
        "zoom_title": "Original Screenshot",
        "zoom_in": "Zoom In",
        "zoom_out": "Zoom Out",
        "zoom_reset": "Reset",
        "diff_coupons": "cpn.",
        "diff_puzzles": "pzl.",
        "diff_stars": "stars",
        "author": "Author",
        "source": "Source",
        "unknown_author": "Sector Owner",
        "today": "today",
        "days_ago": "{{days}} d. ago",
        "no_data": "no data"
      },
      "telegram": {
        "card_title": "Telegram Integration",
        "status_connected": "Connected",
        "status_not_connected": "Not connected",
        "btn_connect": "📱 Connect Telegram",
        "btn_disconnect": "Disconnect",
        "notifications_enabled": "Telegram notifications",
        "admin_nav_title": "Notifications & Templates",
        "bot_settings_title": "Telegram Bot Settings",
        "bot_token": "Bot Token (BotFather)",
        "staff_chat_id": "Staff Chat ID",
        "btn_generate_staff_pin": "🔑 Generate Staff Link PIN",
        "staff_pin_modal_title": "Staff Chat Link PIN",
        "staff_pin_hint": "Add the bot to the staff chat and send the command:",
        "bot_username": "Bot Username (@username)",
        "save_settings": "Save Bot Settings",
        "settings_saved": "Bot settings saved successfully",
        "pin_copied": "Command copied to clipboard",
        "link_copied": "Link copied to clipboard",
        "connected_as": "Connected as @{{username}}",
        "connected_id": "Connected (Chat ID: {{chatId}})",
        "disconnect_confirm": "Are you sure you want to disconnect Telegram notifications?",
        "open_telegram": "Open Telegram",
        "pin_expires": "Code valid for 15 minutes",
        "staff_chat_hint": "Or enter negative supergroup ID manually",
        "btn_check_status": "🔄 Check status",
        "checking_status": "Checking connection...",
        "not_connected_hint": "Binding not completed. Send /start in Telegram"
      },
      "officers": {
        "stock_mode_title": "Stock mode:",
        "mode_label": "Mode:",
        "mode_retro": "📜 Retrospective",
        "mode_retro_short": "📜 Retro",
        "mode_retro_hint": "No stock deduction",
        "mode_normal": "⚡ Leveling",
        "mode_normal_short": "⚡ Leveling",
        "mode_normal_hint": "Deduct resources from stock",
        "mode_officer_retro_toast": "📜 Retrospective mode for officer (no warehouse deduction)",
        "mode_officer_normal_toast": "⚡ Leveling mode for officer (warehouse deduction)",
        "toast_retro_updated": "Updated (Retro: no stock deduction)",
        "toast_retro_stars_updated": "Stars updated (Retro: no stock deduction)",
        "toast_retro_skills_updated": "Skill updated (Retro: no stock deduction)",
        "stars_label": "Stars (0-5★)",
        "btn_reset_stock": "↩️ Reset to stock",
        "toast_reset_success": "Officer reset to stock state, resources refunded to warehouse",
        "reset_modal_title": "Reset Officer to Stock State"
      },
      "mieru": {
        "card_title": "Mieru Tunnel (Telegram Anti-Censorship)",
        "toggle_enable": "Use Mieru tunnel for Telegram",
        "tab_form": "📝 Form Fields",
        "tab_json": "📋 Raw JSON",
        "server_address": "Server Address (IP or Domain)",
        "port_range": "Port or Port Range",
        "port_range_hint": "e.g. 10000-10050 or 443",
        "username": "Username (User / UUID)",
        "password": "Password",
        "transport": "Transport Protocol",
        "socks5_port": "Local SOCKS5 Port",
        "socks5_port_hint": "(on this server, usually 1080, do not confuse with VPS ports)",
        "json_label": "Mieru Configuration (JSON)",
        "json_placeholder": "Paste Mieru client JSON configuration here...",
        "btn_save": "💾 Save Mieru Settings",
        "btn_test": "⚡ Test Mieru Tunnel",
        "status_running": "🟢 Tunnel Active",
        "status_stopped": "⚪ Tunnel Disabled",
        "status_error": "🔴 Tunnel Error",
        "settings_saved": "Mieru settings saved successfully",
        "test_success": "Mieru tunnel works! Telegram responded in {{ms}}ms",
        "test_error": "Mieru test failed: {{error}}"
      },
      "templates": {
        "editor_title": "Notification Template Editor",
        "select_template": "Select Event",
        "available_placeholders": "Available Variables (click to insert)",
        "template_text": "Template Text (HTML)",
        "live_preview": "Live Preview (Telegram Style)",
        "btn_save": "💾 Save Template",
        "btn_reset": "↩️ Reset to Default",
        "btn_test": "🚀 Send Test to Telegram",
        "save_success": "Template saved successfully",
        "reset_success": "Template reset to default",
        "test_success": "Test message sent to Telegram",
        "reset_confirm": "Are you sure you want to reset this template to default?",
        "channel_personal": "👤 Personal",
        "channel_staff": "💬 Staff",
        "empty_text_error": "Template text cannot be empty"
      },
      "cabinet": {
        "title": "My Cabinet",
        "login_required_desc": "To access your cabinet, please log in to your account.",
        "login_btn": "Login to system",
        "loading": "Loading cabinet data...",
        "no_sectors_title": "You don't have any sectors yet",
        "no_sectors_desc": "Add your first base to track officer upgrades, stocks and participate in alliance events!",
        "btn_create_first_sector": "+ Create your first sector",
        "btn_add_sector": "+ Add Sector",
        "active_sector": "Active Sector:",
        "stats_line": "VIP {{vip}} · Secrecy {{conf}} · Power {{power}} · Kills {{kills}} · Points {{points}}",
        "sector_params": "Sector Parameters",
        "puzzles_per_day": "+{{count}} puzzle/day",
        "vip_level_label": "VIP Level (0-17)",
        "vip_points_label": "VIP Points",
        "hq_level": "HQ Level",
        "hq_level_label": "HQ Level",
        "hq_level_placeholder": "not specified",
        "hq_badge": "HQ {{level}}",
        "confidentiality_label": "Secrecy Level",
        "power_label": "Power",
        "kills_label": "Kills",
        "kill_points_label": "Kill Points",
        "daily_income_hint": "Daily Income: +{{count}} puzzles/day (VIP: {{vip}}, Secrecy: {{conf}}) + 1 chest/day.",
        "btn_save_sector": "💾 Save Sector Parameters",
        "stocks_title": "Member Stocks",
        "stocks_click_hint": "Click on card for quick edit",
        "officer_coupon": "Officer Coupon",
        "officer_medal": "Officer Medal",
        "choice_chest": "Choice Chest",
        "star_coupon": "Star Coupon",
        "stars_123": "Stars I / II / III",
        "stars_123_rates": "Stars I (110) / II (420) / III (960)",
        "star_points": "Star Points",
        "my_officers": "My Officers",
        "btn_add_officer": "+ Add Officer",
        "no_officers_desc": "You don't have any officers in your profile yet. Click \"+ Add Officer\" to add your first officer!",
        "gen_short": "Gen. {{gen}}",
        "only_personal": "Personal Only",
        "stars_label": "Stars:",
        "star_ready": "5★ Ready",
        "star_needed": "Need 5★",
        "star_max": "5★ Maximum (98,000 stars)",
        "star_to_next": "To {{next}}★: {{cost}} stars",
        "level_label": "Level:",
        "puzzles_label": "Puzzles:",
        "coupons_label": "Coupons:",
        "deficit_to_180": "Deficit to 180:",
        "forecast_without_events": "Forecast without events:",
        "only_personal_medals": "Personal medals only",
        "simulator_title": "Personal Leveling Simulator to Level 180",
        "officer_for_calc": "Officer for calculation",
        "target_level_label": "Target Level",
        "timeline_header": "Calendar events leveling timeline:",
        "btn_open_calendar": "📅 Open events calendar",
        "forecast_goal": "Goal forecast:",
        "unreachable": "Unreachable",
        "in_days": "in {{days}} days",
        "available_in_stock": "Available in stock for Gen. {{gen}}:"
      },
      "events": {
        "title": "Events",
        "btn_create_season": "⚡ Create Season",
        "btn_create_event": "+ Create Event",
        "active_now": "● Active Now",
        "upcoming": "◎ Upcoming",
        "past": "◌ Past",
        "empty_events": "No events yet. Create the first one!",
        "status_active": "● Active",
        "status_upcoming": "◎ Soon",
        "status_past": "◌ Completed",
        "assignments_count": "{{count}} assignments",
        "coupons_count": "{{count}} coupons",
        "more_assignments": "+ {{count}} more assignments",
        "no_assignments": "No assignments",
        "btn_register": "📝 Register for event",
        "btn_register_sector": "+ Register sector",
        "edit_registration": "Edit",
        "cancel_registration": "Cancel",
        "any_place": "Any",
        "place_num": "Place {{place}}",
        "event_detail": "Event Details"
      },
      "sectors": {
        "title": "Alliance Sectors",
        "btn_add_sector": "+ Add Sector",
        "filter_officers_title": "Officer filter (pairings & combos):",
        "clear_filter": "✕ Clear filter",
        "officer_1": "Officer 1:",
        "officer_2": "Officer 2 (pair):",
        "any_officer": "— Any officer —",
        "any_pair": "— Any in pair —",
        "found_count": "Found: {{count}} of {{total}}",
        "total_sectors": "Total sectors: {{count}}",
        "combo_search": "Combo to search:",
        "th_sector": "Sector (Base)",
        "th_owner": "Owner",
        "th_rank": "Rank",
        "th_stats": "Sector (Stats)",
        "th_officers": "Officers",
        "th_stocks": "Stocks"
      },
      "catalog": {
        "title": "Officer Catalog",
        "subtitle": "Alliance commanders registry, pre-training, training params and exchange rates",
        "btn_add_officer": "+ Add Officer",
        "btn_ocr_store": "📷 OCR from Store",
        "btn_vip_scale": "⭐ VIP Scale Settings",
        "empty_catalog": "Officer catalog is empty",
        "th_officer": "Officer",
        "th_type": "Troop Type",
        "th_season": "Season",
        "th_coupons_per_puzzle": "Coupons per medal",
        "th_star_cost": "Coupons for 110★",
        "th_before_training": "Pre-training",
        "th_training": "Training",
        "th_total_medals": "Total Medals",
        "hint_auto_cost": "💡 Auto-calculated: {{cost}} coupons based on S{{gen}} {{type}} ({{baseCost}}) with upward rounding (+{{pct}}%). Editable.",
        "hint_auto_cost_manual": "💡 Recommended for S{{gen}} {{type}}: {{cost}} coupons.",
        "btn_reset_auto_cost": "Reset to auto-cost"
      },
      "event_types": {
        "title": "Event Types",
        "btn_create_type": "+ Create Event Type",
        "empty_types": "No event types configured yet"
      },
      "calc": {
        "tab_personal": "🎯 Personal Simulator",
        "tab_matrix": "📊 Alliance Summary Matrix",
        "player_label": "Player",
        "no_officers_player": "Player has no officers for coupon simulator"
      },
      "pending": {
        "title": "Member Registration Requests",
        "loading": "Loading requests...",
        "empty": "No active registration requests",
        "empty_desc": "All incoming requests have been processed by guild leadership.",
        "th_id": "ID",
        "th_login": "Login",
        "th_character": "Character in Guild",
        "th_date": "Request Date",
        "th_status": "Status",
        "new_character": "New Character",
        "status_pending": "⏳ Pending",
        "btn_approve_r3": "Approve (R3)",
        "btn_approve_r4": "Approve (R4)",
        "btn_reject": "Reject"
      },
      "users": {
        "title": "Guild User Management",
        "loading": "Loading users...",
        "empty": "No users found",
        "th_login": "Login",
        "th_character": "Character",
        "th_rank": "Rank",
        "th_permissions": "Permissions",
        "th_status": "Status",
        "th_registered": "Registration",
        "full_access": "⚡ Full Access",
        "btn_rights": "🛡️ Rights",
        "btn_password": "🔑 Password",
        "basic_r3": "Basic (R3)",
        "active": "✓ Active",
        "pending": "⏳ Pending",
        "rank_r3": "R3 (Member)",
        "rank_r4": "R4 (Officer)",
        "rank_r5": "R5 (Leader)",
        "btn_block": "⛔ Block",
        "btn_unblock": "✅ Unblock",
        "btn_delete": "🗑️ Delete",
        "status_blocked": "⛔ Blocked",
        "confirm_block": "Block user {{username}}? All active sessions will be terminated immediately.",
        "confirm_unblock": "Unblock user {{username}}?",
        "confirm_delete_title": "Delete User",
        "confirm_delete_desc": "You are about to delete user @{{username}}.",
        "delete_remove_sector": "Delete player sector along with account",
        "delete_remove_sector_hint": "If unchecked, the sector will remain in the guild as unassigned (without an owner).",
        "stat_total": "Total",
        "stat_online": "Online",
        "stat_blocked": "Blocked",
        "tooltip_online": "Online",
        "tooltip_offline": "Never seen online",
        "tooltip_last_seen": "Last seen: {{time}}"
      }
    }
  },
  "de": {
    "translation": {
      "common": {
        "save": "Speichern",
        "cancel": "Abbrechen",
        "delete": "Löschen",
        "edit": "Bearbeiten",
        "close": "Schließen",
        "online": "Online",
        "offline": "Offline",
        "loading": "Wird geladen...",
        "search": "Suchen...",
        "all": "Alle",
        "actions": "Aktionen",
        "back": "Zurück",
        "confirm": "Bestätigen",
        "yes": "Ja",
        "no": "Nein",
        "status": "Status",
        "date": "Datum",
        "version": "Version",
        "in_queue": "In Warteschlange: {{count}}",
        "syncing": "Synchronisierung...",
        "syncing_title": "Gespeicherte Offline-Änderungen an den Server senden",
        "offline_mode": "Offline-Modus",
        "sync_queue": "In der Synchronisations-Warteschlange",
        "connected_title": "Mit dem Server verbunden, alle Daten gespeichert",
        "install_pwa": "Installieren",
        "install_pwa_title": "App auf Gerät installieren",
        "logout": "Abmelden",
        "logout_title": "Vom Konto abmelden",
        "pending_approval": "Warten auf Genehmigung",
        "requests_one": "Antrag",
        "requests_few": "Anträge",
        "requests_many": "Anträge",
        "requests_other": "Anträge",
        "user": "Benutzer",
        "refresh": "Aktualisieren",
        "sync": "Synchronisieren",
        "change_password": "Passwort ändern",
        "active_now": "Läuft gerade",
        "upcoming": "Bevorstehend",
        "past": "Vergangen",
        "none": "Keine",
        "not_found": "Nicht gefunden",
        "generation_short": "Gen. {{gen}}"
      },
      "auth": {
        "login": "Anmelden",
        "register": "Registrieren",
        "account_blocked": "Der Kontozugriff wurde von der Gildenleitung gesperrt"
      },
      "nav": {
        "calendar": "Kalender",
        "sectors": "Sektoren",
        "officers": "Offizierskatalog",
        "event_types": "Event-Typen",
        "event_detail": "Event-Details",
        "pending_registrations": "Ausstehende Anmeldungen",
        "calculator": "Rechner",
        "users_rights": "Benutzer & Rechte",
        "my_cabinet": "Mein Kabinett",
        "export_excel": "Excel-Export",
        "export_json": "JSON-Export",
        "import_json": "JSON-Import"
      },
      "roles": {
        "r5": "R5 — Anführer",
        "r4": "R4 — Offizier",
        "r3": "R3 — Mitglied",
        "owner": "Besitzer",
        "no_owner": "Kein Besitzer",
        "change_owner": "Besitzer wechseln"
      },
      "game": {
        "officer_types": {
          "tank": "Panzer",
          "infantry": "Infanterie",
          "tank_destroyer": "Jagdpanzer",
          "garrison": "Garnison",
          "siege": "Belagerung"
        },
        "awards": {
          "place_1": "1. Platz",
          "place_2": "2. Platz",
          "place_3": "3. Platz",
          "place_4": "4. Platz",
          "top_1": "TOP-1",
          "top_2": "TOP-2",
          "top_3": "TOP-3",
          "top_4": "TOP-4"
        },
        "resources": {
          "coupons": "Coupons",
          "puzzles": "Puzzles",
          "chests": "Kisten",
          "stars": "Sterne",
          "star_coupons": "Stern-Coupons",
          "legendary_stars": "Legendäre Sterne"
        },
        "items": {
          "coupons": "Coupons",
          "puzzles": "Puzzles",
          "chests": "Kisten",
          "stars": "Sterne",
          "star_coupons": "Stern-Coupons",
          "legendary_stars": "Legendäre Sterne"
        },
        "sim": {
          "guaranteed_mode": "Garantierter Modus",
          "optimistic_mode": "Optimistischer Modus",
          "manual_mode": "Manueller Modus",
          "target_level": "Zielstufe",
          "daily_income": "Tägliches Einkommen",
          "savings_badge": "⚡ Ersparnis: {{days}} Tage!",
          "timeline_title": "Fortschritts-Zeitachse",
          "finish_reached": "Ziel erreicht",
          "deficit": "Defizit",
          "current_progress": "Aktueller Fortschritt",
          "without_events": "Ohne Events",
          "with_events": "Mit Events",
          "no_events_guaranteed": "Ohne Events (Garantiert)",
          "no_events_optimistic": "Ohne Events (Optimistisch)"
        }
      },
      "toasts": {
        "saved_success": "Änderungen erfolgreich gespeichert",
        "saved_successfully": "Änderungen erfolgreich gespeichert",
        "sync_success": "Daten erfolgreich synchronisiert",
        "error_occurred": "Ein Fehler ist aufgetreten: {{error}}",
        "access_denied": "Zugriff durch Rangberechtigungen verweigert",
        "import_success": "{{count}} Datensätze importiert",
        "export_success": "Daten erfolgreich exportiert"
      },
      "pwa": {
        "update_available": "Ein Anwendungsupdate ist verfügbar",
        "btn_refresh": "Aktualisieren"
      },
      "audit": {
        "freshness_fresh": "Aktuelle Daten",
        "freshness_warning": "Aktualisierung erforderlich",
        "freshness_stale": "Lager veraltet",
        "history_title": "Lager-Änderungsverlauf",
        "source_manual": "Manuelle Bearbeitung",
        "source_ocr": "Screenshot (OCR)",
        "archived_screenshot_notice": "Archiv: Screenshot nach 30 Tagen gelöscht",
        "view_screenshot": "Screenshot ansehen",
        "btn_history": "Lager-Verlauf",
        "empty_history": "Noch kein Änderungsverlauf vorhanden",
        "zoom_title": "Original-Screenshot",
        "zoom_in": "Vergrößern",
        "zoom_out": "Verkleinern",
        "zoom_reset": "Zurücksetzen",
        "diff_coupons": "Kup.",
        "diff_puzzles": "Pzl.",
        "diff_stars": "Sterne",
        "author": "Autor",
        "source": "Quelle",
        "unknown_author": "Sektorbesitzer",
        "today": "heute",
        "days_ago": "vor {{days}} T.",
        "no_data": "keine Daten"
      },
      "telegram": {
        "card_title": "Telegram-Integration",
        "status_connected": "Verbunden",
        "status_not_connected": "Nicht verbunden",
        "btn_connect": "📱 Telegram verbinden",
        "btn_disconnect": "Trennen",
        "notifications_enabled": "Telegram-Benachrichtigungen",
        "admin_nav_title": "Benachrichtigungen & Vorlagen",
        "bot_settings_title": "Telegram-Bot-Einstellungen",
        "bot_token": "Bot-Token (BotFather)",
        "staff_chat_id": "Stab-Chat-ID",
        "btn_generate_staff_pin": "🔑 Stab-Verbindungscode generieren",
        "staff_pin_modal_title": "Stab-Chat-Verbindungscode",
        "staff_pin_hint": "Fügen Sie den Bot dem Stab-Chat hinzu und senden Sie den Befehl:",
        "bot_username": "Bot-Benutzername (@username)",
        "save_settings": "Bot-Einstellungen speichern",
        "settings_saved": "Bot-Einstellungen erfolgreich gespeichert",
        "pin_copied": "Befehl in die Zwischenablage kopiert",
        "link_copied": "Link in die Zwischenablage kopiert",
        "connected_as": "Verbunden als @{{username}}",
        "connected_id": "Verbunden (Chat ID: {{chatId}})",
        "disconnect_confirm": "Möchten Sie Telegram-Benachrichtigungen wirklich trennen?",
        "open_telegram": "Telegram öffnen",
        "pin_expires": "Code 15 Minuten gültig",
        "staff_chat_hint": "Oder negative Supergruppen-ID manuell eingeben",
        "btn_check_status": "🔄 Status prüfen",
        "checking_status": "Verbindung prüfen...",
        "not_connected_hint": "Verbindung noch nicht abgeschlossen. Senden Sie /start in Telegram"
      },
      "officers": {
        "stock_mode_title": "Lagermodus:",
        "mode_label": "Modus:",
        "mode_retro": "📜 Rückblick",
        "mode_retro_short": "📜 Retro",
        "mode_retro_hint": "Kein Lagerabzug",
        "mode_normal": "⚡ Aufwertung",
        "mode_normal_short": "⚡ Aufleveln",
        "mode_normal_hint": "Ressourcen aus dem Lager abziehen",
        "mode_officer_retro_toast": "📜 Retro-Modus für Offizier (kein Lagerabzug)",
        "mode_officer_normal_toast": "⚡ Auflevel-Modus für Offizier (Lagerabzug)",
        "toast_retro_updated": "Aktualisiert (Retro: ohne Lagerabzug)",
        "toast_retro_stars_updated": "Sterne aktualisiert (Retro: ohne Lagerabzug)",
        "toast_retro_skills_updated": "Fähigkeit aktualisiert (Retro: ohne Lagerabzug)",
        "stars_label": "Sterne (0-5★)",
        "btn_reset_stock": "↩️ Auf Standard zurücksetzen",
        "toast_reset_success": "Offizier auf Standardzustand zurückgesetzt, Ressourcen erstattet",
        "reset_modal_title": "Offizier auf Standardzustand zurücksetzen"
      },
      "mieru": {
        "card_title": "Mieru-Tunnel (Telegram-Zensurumgehung)",
        "toggle_enable": "Mieru-Tunnel für Telegram verwenden",
        "tab_form": "📝 Formularfelder",
        "tab_json": "📋 Rohes JSON",
        "server_address": "Serveradresse (IP oder Domain)",
        "port_range": "Port oder Portbereich",
        "port_range_hint": "z.B. 10000-10050 oder 443",
        "username": "Benutzername (User / UUID)",
        "password": "Passwort",
        "transport": "Übertragungsprotokoll",
        "socks5_port": "Lokaler SOCKS5-Port",
        "socks5_port_hint": "(auf diesem Server, normalerweise 1080, nicht mit VPS-Ports verwechseln)",
        "json_label": "Mieru-Konfiguration (JSON)",
        "json_placeholder": "Mieru-Client-JSON-Konfiguration hier einfügen...",
        "btn_save": "💾 Mieru-Einstellungen speichern",
        "btn_test": "⚡ Mieru-Tunnel testen",
        "status_running": "🟢 Tunnel aktiv",
        "status_stopped": "⚪ Tunnel deaktiviert",
        "status_error": "🔴 Tunnelfehler",
        "settings_saved": "Mieru-Einstellungen erfolgreich gespeichert",
        "test_success": "Mieru-Tunnel funktioniert! Telegram antwortete in {{ms}}ms",
        "test_error": "Mieru-Test fehlgeschlagen: {{error}}"
      },
      "templates": {
        "editor_title": "Benachrichtigungsvorlagen-Editor",
        "select_template": "Ereignis auswählen",
        "available_placeholders": "Verfügbare Variablen (Klicken zum Einfügen)",
        "template_text": "Vorlagentext (HTML)",
        "live_preview": "Live-Vorschau (Telegram-Stil)",
        "btn_save": "💾 Vorlage speichern",
        "btn_reset": "↩️ Auf Standard zurücksetzen",
        "btn_test": "🚀 Test an Telegram senden",
        "save_success": "Vorlage erfolgreich gespeichert",
        "reset_success": "Vorlage auf Standard zurückgesetzt",
        "test_success": "Testnachricht an Telegram gesendet",
        "reset_confirm": "Möchten Sie diese Vorlage wirklich auf den Standard zurücksetzen?",
        "channel_personal": "👤 Persönlich",
        "channel_staff": "💬 Stab",
        "empty_text_error": "Vorlagentext darf nicht leer sein"
      },
      "cabinet": {
        "title": "Mein Kabinett",
        "login_required_desc": "Um auf Ihr Kabinett zuzugreifen, melden Sie sich bitte an.",
        "login_btn": "Im System anmelden",
        "loading": "Kabinettsdaten werden geladen...",
        "no_sectors_title": "Sie haben noch keine Sektoren",
        "no_sectors_desc": "Fügen Sie Ihre erste Basis hinzu, um Offiziers-Upgrades und Vorräte zu verfolgen und an Allianz-Events teilzunehmen!",
        "btn_create_first_sector": "+ Ersten Sektor erstellen",
        "btn_add_sector": "+ Sektor hinzufügen",
        "active_sector": "Aktiver Sektor:",
        "stats_line": "VIP {{vip}} · Geheimhaltung {{conf}} · Macht {{power}} · Kills {{kills}} · Punkte {{points}}",
        "sector_params": "Sektor-Parameter",
        "puzzles_per_day": "+{{count}} Puzzle/Tag",
        "vip_level_label": "VIP-Stufe (0-17)",
        "vip_points_label": "VIP-Punkte",
        "hq_level": "HQ-Stufe",
        "hq_level_label": "HQ-Stufe",
        "hq_level_placeholder": "nicht angegeben",
        "hq_badge": "HQ {{level}}",
        "confidentiality_label": "Geheimhaltungsstufe",
        "power_label": "Macht / Stärke",
        "kills_label": "Getötet",
        "kill_points_label": "Kill-Punkte",
        "daily_income_hint": "Tägliches Einkommen: +{{count}} Puzzles/Tag (VIP: {{vip}}, Geheimhaltung: {{conf}}) + 1 Kiste/Tag.",
        "btn_save_sector": "💾 Sektor-Parameter speichern",
        "stocks_title": "Mitglieds-Vorräte",
        "stocks_click_hint": "Klicken Sie auf die Karte zur schnellen Bearbeitung",
        "officer_coupon": "Offiziers-Coupon",
        "officer_medal": "Offiziers-Medaille",
        "choice_chest": "Auswahl-Kiste",
        "star_coupon": "Stern-Coupon",
        "stars_123": "Sterne I / II / III",
        "stars_123_rates": "Sterne I (110) / II (420) / III (960)",
        "star_points": "Stern-Punkte",
        "my_officers": "Meine Offiziere",
        "btn_add_officer": "+ Offizier hinzufügen",
        "no_officers_desc": "Sie haben noch keine Offiziere in Ihrem Profil. Klicken Sie auf \"+ Offizier hinzufügen\", um Ihren ersten Offizier hinzuzufügen!",
        "gen_short": "Gen. {{gen}}",
        "only_personal": "Nur persönliche",
        "stars_label": "Sterne:",
        "star_ready": "5★ Bereit",
        "star_needed": "5★ Benötigt",
        "star_max": "5★ Maximum (98.000 Sterne)",
        "star_to_next": "Bis {{next}}★: {{cost}} Sterne",
        "level_label": "Stufe:",
        "puzzles_label": "Puzzles:",
        "coupons_label": "Coupons:",
        "deficit_to_180": "Defizit bis 180:",
        "forecast_without_events": "Prognose ohne Events:",
        "only_personal_medals": "Nur persönliche Medaillen",
        "simulator_title": "Persönlicher Leveling-Simulator bis Stufe 180",
        "officer_for_calc": "Offizier zur Berechnung",
        "target_level_label": "Ziel-Level",
        "timeline_header": "Fortschritts-Chronologie nach Kalender-Events:",
        "btn_open_calendar": "📅 Event-Kalender öffnen",
        "forecast_goal": "Ziel-Prognose:",
        "unreachable": "Nicht erreichbar",
        "in_days": "in {{days}} Tagen",
        "available_in_stock": "Auf Lager verfügbar für Gen. {{gen}}:"
      },
      "events": {
        "title": "Events",
        "btn_create_season": "⚡ Saison erstellen",
        "btn_create_event": "+ Event erstellen",
        "active_now": "● Läuft gerade",
        "upcoming": "◎ Bevorstehend",
        "past": "◌ Vergangen",
        "empty_events": "Keine Events vorhanden. Erstellen Sie das erste!",
        "status_active": "● Läuft",
        "status_upcoming": "◎ Bald",
        "status_past": "◌ Beendet",
        "assignments_count": "{{count}} Zuweisungen",
        "coupons_count": "{{count}} Coupons",
        "more_assignments": "+ weitere {{count}} Zuweisungen",
        "no_assignments": "Keine Zuweisungen",
        "btn_register": "📝 Für Event anmelden",
        "btn_register_sector": "+ Sektor anmelden",
        "edit_registration": "Bearbeiten",
        "cancel_registration": "Abbrechen",
        "any_place": "Beliebig",
        "place_num": "Platz {{place}}",
        "event_detail": "Event-Details"
      },
      "sectors": {
        "title": "Allianz-Sektoren",
        "btn_add_sector": "+ Sektor hinzufügen",
        "filter_officers_title": "Offiziersfilter (Paarungen & Kombos):",
        "clear_filter": "✕ Filter löschen",
        "officer_1": "Offizier 1:",
        "officer_2": "Offizier 2 (im Paar):",
        "any_officer": "— Beliebiger Offizier —",
        "any_pair": "— Beliebiger im Paar —",
        "found_count": "Gefunden: {{count}} von {{total}}",
        "total_sectors": "Gesamtanzahl Sektoren: {{count}}",
        "combo_search": "Such-Kombo:",
        "th_sector": "Sektor (Basis)",
        "th_owner": "Besitzer",
        "th_rank": "Rang",
        "th_stats": "Sektor (Stats)",
        "th_officers": "Offiziere",
        "th_stocks": "Vorräte"
      },
      "catalog": {
        "title": "Offizierskatalog",
        "subtitle": "Allianz-Kommandantenregister, Vorbereitungs-, Trainingsparameter und Wechselkurse",
        "btn_add_officer": "+ Offizier hinzufügen",
        "btn_ocr_store": "📷 Aus dem Shop erkennen",
        "btn_vip_scale": "⭐ VIP-Skaleneinstellungen",
        "empty_catalog": "Offizierskatalog ist leer",
        "th_officer": "Offizier",
        "th_type": "Truppentyp",
        "th_season": "Saison",
        "th_coupons_per_puzzle": "Coupons pro Medaille",
        "th_star_cost": "Coupons für 110★",
        "th_before_training": "Vor Vorbereitung",
        "th_training": "Vorbereitung",
        "th_total_medals": "Medaillen gesamt",
        "hint_auto_cost": "💡 Automatisch berechnet: {{cost}} Coupons basierend auf S{{gen}} {{type}} ({{baseCost}}) aufgerundet (+{{pct}}%). Anpassbar.",
        "hint_auto_cost_manual": "💡 Empfehlung für S{{gen}} {{type}}: {{cost}} Coupons.",
        "btn_reset_auto_cost": "Auf Auto-Kosten zurücksetzen"
      },
      "event_types": {
        "title": "Event-Typen",
        "btn_create_type": "+ Event-Typ erstellen",
        "empty_types": "Noch keine Event-Typen konfiguriert"
      },
      "calc": {
        "tab_personal": "🎯 Persönlicher Simulator",
        "tab_matrix": "📊 Allianz-Übersichtsmatrix",
        "player_label": "Spieler",
        "no_officers_player": "Spieler hat keine Offiziere für den Coupon-Simulator"
      },
      "pending": {
        "title": "Mitglieder-Registrierungsanträge",
        "loading": "Anträge werden geladen...",
        "empty": "Keine aktiven Registrierungsanträge",
        "empty_desc": "Alle eingegangenen Anträge wurden von der Gildenführung bearbeitet.",
        "th_id": "ID",
        "th_login": "Login",
        "th_character": "Charakter in der Gilde",
        "th_date": "Antragsdatum",
        "th_status": "Status",
        "new_character": "Neuer Charakter",
        "status_pending": "⏳ Ausstehend",
        "btn_approve_r3": "Genehmigen (R3)",
        "btn_approve_r4": "Genehmigen (R4)",
        "btn_reject": "Ablehnen"
      },
      "users": {
        "title": "Gilden-Benutzerverwaltung",
        "loading": "Benutzer werden geladen...",
        "empty": "Keine Benutzer gefunden",
        "th_login": "Login",
        "th_character": "Charakter",
        "th_rank": "Rang",
        "th_permissions": "Berechtigungen",
        "th_status": "Status",
        "th_registered": "Registrierung",
        "full_access": "⚡ Vollzugriff",
        "btn_rights": "🛡️ Rechte",
        "btn_password": "🔑 Passwort",
        "basic_r3": "Basis (R3)",
        "active": "✓ Aktiv",
        "pending": "⏳ Ausstehend",
        "rank_r3": "R3 (Mitglied)",
        "rank_r4": "R4 (Offizier)",
        "rank_r5": "R5 (Anführer)",
        "btn_block": "⛔ Sperren",
        "btn_unblock": "✅ Entsperren",
        "btn_delete": "🗑️ Löschen",
        "status_blocked": "⛔ Gesperrt",
        "confirm_block": "Benutzer {{username}} sperren? Alle aktiven Sitzungen werden sofort beendet.",
        "confirm_unblock": "Benutzer {{username}} entsperren?",
        "confirm_delete_title": "Benutzer löschen",
        "confirm_delete_desc": "Sie sind im Begriff, Benutzer @{{username}} zu löschen.",
        "delete_remove_sector": "Sektor des Spielers zusammen mit dem Konto löschen",
        "delete_remove_sector_hint": "Wenn nicht ausgewählt, verbleibt der Sektor in der Gilde als frei (ohne Besitzer).",
        "stat_total": "Gesamt",
        "stat_online": "Online",
        "stat_blocked": "Gesperrt",
        "tooltip_online": "Online",
        "tooltip_offline": "Nie online gesehen",
        "tooltip_last_seen": "Zuletzt online: {{time}}"
      }
    }
  }
};

let currentLang = 'ru';
let i18nInstance = null;

function getStorage() {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage;
    }
  } catch (e) {}
  return null;
}

function resolveI18next() {
  if (typeof window !== 'undefined' && window.i18next) {
    return window.i18next;
  }
  try {
    return require('./vendor/i18next.min.js');
  } catch (e1) {
    try {
      return require('i18next');
    } catch (e2) {
      return null;
    }
  }
}

async function initI18n(options = {}) {
  i18nInstance = options.i18nextInstance || resolveI18next();

  let defaultLang = 'ru';
  const storage = getStorage();
  if (options.lng && ['ru', 'en', 'de'].includes(options.lng)) {
    defaultLang = options.lng;
  } else if (storage) {
    const saved = storage.getItem('kow_lang');
    if (saved && ['ru', 'en', 'de'].includes(saved)) {
      defaultLang = saved;
    } else if (typeof navigator !== 'undefined' && navigator.language) {
      const nav = navigator.language.slice(0, 2).toLowerCase();
      if (['en', 'de'].includes(nav)) {
        defaultLang = nav;
      }
    }
  }

  currentLang = defaultLang;

  if (i18nInstance && typeof i18nInstance.init === 'function') {
    await i18nInstance.init({
      lng: defaultLang,
      fallbackLng: 'ru',
      resources: I18N_RESOURCES,
      interpolation: {
        escapeValue: false
      },
      ...options
    });
  }

  if (typeof document !== 'undefined' && document.documentElement) {
    document.documentElement.lang = defaultLang;
    updateStaticDOMTranslations();
  }

  return i18nInstance;
}

function t(key, options) {
  const fallbackText = typeof options === 'string' ? options : null;
  const optObj = (options && typeof options === 'object') ? options : null;

  if (i18nInstance && typeof i18nInstance.t === 'function') {
    const res = i18nInstance.t(key, optObj || (fallbackText ? { defaultValue: fallbackText } : undefined));
    if (res !== undefined && res !== key) {
      return res;
    }
  }

  // Fallback to dictionary lookup directly if i18next uninitialized or returns key
  const activeLang = getAppLanguage();
  const langResources = [activeLang, 'ru'];

  for (const lng of langResources) {
    const dict = I18N_RESOURCES[lng]?.translation;
    if (!dict) continue;

    const parts = String(key).split('.');
    let val = dict;
    for (const part of parts) {
      if (val && typeof val === 'object' && part in val) {
        val = val[part];
      } else {
        val = null;
        break;
      }
    }

    if (typeof val === 'string') {
      if (optObj) {
        return val.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => {
          return optObj[k] !== undefined ? optObj[k] : `{{${k}}}`;
        });
      }
      return val;
    }
  }

  return fallbackText || key;
}

function getAppLanguage() {
  if (i18nInstance && i18nInstance.language) {
    return i18nInstance.language.slice(0, 2).toLowerCase();
  }
  return currentLang;
}

async function setAppLanguage(lang) {
  if (!['ru', 'en', 'de'].includes(lang)) {
    return currentLang;
  }
  currentLang = lang;
  if (i18nInstance && typeof i18nInstance.changeLanguage === 'function') {
    await i18nInstance.changeLanguage(lang);
  }
  const storage = getStorage();
  if (storage) {
    storage.setItem('kow_lang', lang);
  }
  if (typeof document !== 'undefined' && document.documentElement) {
    document.documentElement.lang = lang;
  }
  updateStaticDOMTranslations();
  return currentLang;
}

function getLocalizedOfficerType(type) {
  if (!type) return '';
  const keyMap = {
    'tank': 'game.officer_types.tank',
    'infantry': 'game.officer_types.infantry',
    'tank_destroyer': 'game.officer_types.tank_destroyer',
    'garrison': 'game.officer_types.garrison',
    'siege': 'game.officer_types.siege',
    'Танк': 'game.officer_types.tank',
    'Пехота': 'game.officer_types.infantry',
    'ПТ': 'game.officer_types.tank_destroyer',
    'пт': 'game.officer_types.tank_destroyer',
    'ПТ-Сау': 'game.officer_types.tank_destroyer',
    'ПТ-САУ': 'game.officer_types.tank_destroyer',
    'Горнизон': 'game.officer_types.garrison',
    'Гарнизон': 'game.officer_types.garrison',
    'Осада': 'game.officer_types.siege'
  };

  const str = String(type).trim();
  const key = keyMap[str] || keyMap[str.toLowerCase()] || `game.officer_types.${str}`;
  const translated = t(key);
  if (translated !== key) {
    return translated;
  }
  return type;
}

function updateStaticDOMTranslations(doc) {
  const d = doc || (typeof document !== 'undefined' ? document : null);
  if (!d || typeof d.querySelectorAll !== 'function') return;

  const textNodes = d.querySelectorAll('[data-i18n]');
  if (textNodes && typeof textNodes.forEach === 'function') {
    textNodes.forEach(el => {
      const key = el.getAttribute('data-i18n');
      if (key) {
        el.textContent = t(key);
      }
    });
  }

  const attrNodes = d.querySelectorAll('[data-i18n-attr]');
  if (attrNodes && typeof attrNodes.forEach === 'function') {
    attrNodes.forEach(el => {
      const raw = el.getAttribute('data-i18n-attr');
      if (!raw) return;
      const rules = raw.split(';');
      for (const rule of rules) {
        const idx = rule.indexOf(':');
        if (idx > -1) {
          const attr = rule.slice(0, idx).trim();
          const key = rule.slice(idx + 1).trim();
          if (attr && key) {
            el.setAttribute(attr, t(key));
          }
        }
      }
    });
  }
}

const i18nExports = {
  I18N_RESOURCES,
  initI18n,
  t,
  getAppLanguage,
  setAppLanguage,
  getLocalizedOfficerType,
  updateStaticDOMTranslations
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = i18nExports;
}

if (typeof window !== 'undefined') {
  window.i18n = i18nExports;
  window.I18N_RESOURCES = I18N_RESOURCES;
  window.initI18n = initI18n;
  window.t = t;
  window.getLocalizedOfficerType = getLocalizedOfficerType;
  window.setAppLanguage = setAppLanguage;
  window.getAppLanguage = getAppLanguage;
  window.updateStaticDOMTranslations = updateStaticDOMTranslations;
}
