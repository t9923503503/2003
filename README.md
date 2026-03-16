# Volley

Статическое веб-приложение для пляжного волейбола в формате King of the Court. Проект рассчитан на использование с телефона: счёт, таймеры, ростер, история, регистрация игроков, очередь ожидания, синхронизация между устройствами и экспорт результатов.

## Что умеет

- Несколько кортов одновременно.
- Счёт и таймеры по кортам и финалам.
- Локальная работа через `localStorage`.
- Синхронизация состояния между устройствами через Supabase.
- Регистрация на турниры, временные игроки, очередь заявок.
- Экспорт в Google Sheets.
- PWA-режим: манифест, иконка, service worker.

## Состав репозитория

- `index.html` — HTML-каркас приложения и один module-entrypoint.
- `assets/app.css` — основной stylesheet приложения.
- `assets/js/state/app-state.js` — общий runtime state приложения.
- `assets/js/domain/players.js`, `assets/js/domain/tournaments.js`, `assets/js/domain/timers.js` — storage и предметная логика игроков, турниров и таймеров.
- `assets/js/integrations/config.js` — дефолтный runtime-конфиг внешних интеграций.
- `assets/js/main.js` — module bootstrap, который поднимает приложение и загружает legacy runtime в правильном порядке.
- `assets/js/screens/*.js` — рендеры и UI-логика по отдельным экранам.
- `assets/js/ui/roster-auth.js` — локальная защита вкладки ростера.
- `assets/js/core.js`, `assets/js/registration.js`, `assets/js/integrations.js`, `assets/js/runtime.js` — общие UI-хелперы, сценарии регистрации, интеграции и runtime-обвязка.
- `prototypes/player-card.html` — отдельный прототип карточки игрока (концепт/демо).
- `supabase_migration.sql` — таблицы, индексы и RPC для регистрации.
- `manifest.webmanifest`, `sw.js`, `icon.svg` — PWA-артефакты.
- `.github/workflows/static.yml` — валидация и деплой на GitHub Pages.
- `scripts/validate-static.mjs` — локальная/CI-проверка целостности статического приложения.
- `NEXT_STEPS.md` — roadmap по следующим инженерным изменениям.

## Локальный запуск

Приложение можно просто открыть как статический файл, но для service worker лучше запускать через локальный HTTP-сервер.

Пример:

```bash
python3 -m http.server 8000
```

После этого откройте `http://localhost:8000`.

## Проверка перед деплоем

```bash
node scripts/validate-static.mjs
```

Требования:

- установлен Node.js (команда `node` доступна в терминале).
- на Windows можно проверить так:

```bash
where node
node -v
```

Скрипт проверяет:

- наличие обязательных файлов;
- валидность `manifest.webmanifest`;
- наличие entrypoint-ссылок в `index.html`, `assets/js/main.js` и `sw.js`;
- синтаксис встроенных `<script>`-блоков в HTML-файлах;
- синтаксис вынесенных JS-файлов в `assets/js`.

## Supabase

`supabase_migration.sql` создаёт:

- `players`
- `tournaments`
- `tournament_participants`
- `player_requests`
- `merge_audit`
- `kotc_sessions`

И RPC:

- `search_players`
- `safe_register_player`
- `submit_player_request`
- `create_temporary_player`
- `approve_player_request`
- `safe_cancel_registration`
- `merge_players`
- `create_room`
- `get_room_state`
- `push_room_state`
- `rotate_room_secret`

Синхронизация комнат теперь работает через `room_code + room_secret`. Прямой доступ к `kotc_sessions` закрыт, а чтение и запись идут через RPC.

## Защита ростера

Доступ к вкладке ростера теперь настраивается локально из самого интерфейса. Пароль:

- не хранится в репозитории;
- не отправляется на сервер;
- действует только в браузере конкретного устройства.

Это защита устройства, а не полноценная серверная авторизация.

## Использование

1. Откройте приложение.
2. Если нужна общая синхронизация, задайте код комнаты и секрет комнаты в блоке Supabase.
3. Перейдите в ростер, заполните составы и параметры турнира.
4. Ведите счёт по кортам.
5. Завершайте турнир, сохраняйте результаты и при необходимости экспортируйте их.
