# ПЛАН ИСПРАВЛЕНИЙ — Volley (КОТС)

> Сгенерировано по результатам code review от 16.03.2026
> Общий объём: ~10,600 строк кода, 31 файл

---

## ФАЗА 1: БЕЗОПАСНОСТЬ (P0 — Critical)

### 1.1 XSS: Экранирование данных в innerHTML
- [ ] `home.js` — обернуть `t.name`, `t.format`, `t.location`, `t.division`, `t.date`, `t.time`, `t.prize` в `esc()` в `cardHtml()` (строки 125-136) и `calRow()` (строки 163-167)
- [ ] `home.js` — заменить `'${t.id}'` на `'${escAttr(t.id)}'` в onclick (строки 118, 147)
- [ ] `home.js` — обернуть `topM.name` / `topW.name` в `escAttr()` в title-атрибутах (строки 348-349)
- [ ] `core.js` — заменить `esc()` на `escAttr()` для имени в onmousedown (строка 51)
- [ ] `core.js` — обернуть `p.id` в `escAttr()` во всех onclick (строки 834, 852, 863, 865)
- [ ] `registration.js` — обернуть `p.id` в `escAttr()` в onclick (строка 80)
- [ ] `registration.js` — обернуть `_regStatusMsg.text` в `esc()` (строка 117)
- [ ] `registration.js` — обернуть `t.id` в `escAttr()` в onclick (строки 730-736)
- [ ] `integrations.js` — обернуть `p.name` в `esc()` в `exportTournamentPDF` (строки 923, 929)
- [ ] `integrations.js` — обернуть `t.name` в `esc()` (строка 1061)
- [ ] `integrations.js` — обернуть `sbConfig.roomCode` в `escAttr()` (строка 600)
- [ ] `integrations.js` — обернуть `gshConfig.clientId` и `gshConfig.spreadsheetId` в `escAttr()` (строки 698, 709)

### 1.2 CSV Formula Injection
- [ ] `core.js` — экранировать имена в CSV-экспорте: если начинается с `=`, `+`, `-`, `@`, `\t`, `\r` — добавлять префикс `'` (строка 960)
- [ ] Экранировать двойные кавычки внутри имён (`"` → `""`)

### 1.3 Content Security Policy
- [ ] `index.html` — добавить `<meta http-equiv="Content-Security-Policy">` с белым списком: `script-src 'self' https://accounts.google.com https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; connect-src 'self' https://*.supabase.co; font-src https://fonts.gstatic.com; img-src 'self' data: blob:`
- [ ] Перенести inline onclick из `index.html` (строки 38, 55) в JS-модули

### 1.4 Subresource Integrity
- [ ] `index.html` — закрепить версию Supabase JS и добавить `integrity="sha384-..."` + `crossorigin="anonymous"` (строка 17)

---

## ФАЗА 2: КРИТИЧЕСКИЕ БАГИ (P1)

### 2.1 Мёртвое условие `|| true`
- [ ] `core.js:899` — убрать `|| true`, восстановить нормальное условие `wlist.length > 0`

### 2.2 Строковое сравнение версий
- [ ] `core.js:182` — заменить `ver < '1.1'` на числовое/semver сравнение

### 2.3 Мёртвый код
- [ ] `core.js:688-701` — удалить неиспользуемую функцию `_syncWinnerStats`

### 2.4 Blob URL memory leak
- [ ] `core.js:966-968` — добавить `setTimeout(() => URL.revokeObjectURL(link.href), 5000)` после `link.click()`

### 2.5 Offline-очередь без flush
- [ ] `registration.js` — реализовать flush `kotc3_player_requests` при восстановлении связи, или удалить мёртвый код записи в очередь

---

## ФАЗА 3: ПРОИЗВОДИТЕЛЬНОСТЬ (P2)

### 3.1 Мемоизация `getAllRanked()`
- [ ] Создать кэш с инвалидацией по `scoreTs` — вызывать расчёт 1 раз за цикл рендера вместо 30

### 3.2 Кэширование `loadPlayerDB()`
- [ ] Ввести `_playerDbCache` с invalidation по timestamp — не парсить JSON из localStorage на каждый вызов
- [ ] `core.js` — убрать дублирующие вызовы в `_rdbBodyHtml` (строки 121, 147, 148)

### 3.3 Debounce поиска
- [ ] `core.js:1036` (`ptSetSearch`) — добавить debounce 200мс перед `_renderPtModal()`
- [ ] `registration.js` — убедиться что debounce работает корректно (уже есть 300мс)

### 3.4 `_buildPlayerMap()` — поднять из цикла
- [ ] `core.js:485` — вынести вызов из `_slotHtml()` в `_reRenderSlots()`, передавать map параметром

### 3.5 AudioContext — переиспользование
- [ ] `runtime.js:14-27` — создать один `AudioContext` на уровне модуля, переиспользовать

### 3.6 Supabase Realtime (опционально, большой scope)
- [ ] Заменить polling каждые 1.5сек на Supabase Realtime WebSocket-подписку
- [ ] Убрать `setInterval` c `SB_POLL_MS`

---

## ФАЗА 4: ОБРАБОТКА ОШИБОК (P2)

### 4.1 Заменить тихие `catch(e){}` на feedback пользователю
- [ ] `core.js:174` (`saveState`) — `showToast('Ошибка сохранения данных', 'error')`
- [ ] `core.js:223` (`loadState`) — `showToast('Не удалось загрузить данные', 'error')`
- [ ] `integrations.js:478` (`sbPush`) — `showToast('Ошибка синхронизации', 'error')`
- [ ] `integrations.js:405` (`syncPending`) — `console.warn` минимум
- [ ] `registration.js:536` — `console.warn` вместо `/* silent */`

### 4.2 Валидация данных
- [ ] `integrations.js` (`sbApplyRemoteState`) — базовая проверка формы `state` перед применением
- [ ] `registration.js` — проверка длины имени (max 100 символов) и телефона (формат) перед отправкой

### 4.3 Clipboard и popup-блокировка
- [ ] `integrations.js:304, 420` — добавить `.catch()` к `navigator.clipboard`
- [ ] `integrations.js:896` — проверять результат `window.open()` на `null`

---

## ФАЗА 5: РЕФАКТОРИНГ АРХИТЕКТУРЫ (P3)

### 5.1 Разделение модулей по ответственности
- [ ] Вынести экспорт/импорт бэкапа из `registration.js` → `backup.js`
- [ ] Вынести рендер турниров из `registration.js` → оставить в `core.js` или отдельный модуль
- [ ] Вынести PDF-экспорт из `integrations.js` → `pdf-export.js`
- [ ] Вынести `deleteHistory` из `integrations.js` → `stats.js` или `history.js`

### 5.2 Устранение дубликатов
- [ ] Извлечь offline-регистрацию в хелпер `_regLocalRegister()` (3 копии → 1)
- [ ] Извлечь `loadHistory()` хелпер (6+ копий `JSON.parse(localStorage.getItem('kotc3_history'))`)
- [ ] Извлечь `safeParseLS(key, fallback)` — общий хелпер для localStorage
- [ ] Объединить `sbRefreshCard()` и `gshRefreshCard()` в одну функцию
- [ ] Извлечь общий sort-компаратор для рейтинга (3 копии)
- [ ] Извлечь `buildPairMap()` для химии (2 копии)

### 5.3 Улучшение state management
- [ ] Обернуть глобальные переменные из `app-state.js` в объект/класс `AppState`
- [ ] Добавить подписки на изменения (простой EventEmitter) вместо ручных вызовов `saveState()`
- [ ] Исправить inconsistent вызовы `saveState()` (`clearRoster` не сохраняет)

### 5.4 Удаление хардкода
- [ ] `home.js:365-411` — убрать хардкод "Epic Player Card" (MAMEDOV / РАНГ: 3850) или привязать к реальным данным
- [ ] `integrations.js:16-223` — вынести SQL-миграцию из JS в отдельный `.sql` файл, подгружать по требованию

---

## ФАЗА 6: PWA / DEPLOY / ДОСТУПНОСТЬ (P3)

### 6.1 PWA-иконки
- [ ] Создать PNG-иконки 192x192 и 512x512 из SVG
- [ ] Разделить `"purpose": "any maskable"` на отдельные записи
- [ ] Заменить `apple-touch-icon` SVG на PNG 180x180

### 6.2 Service Worker
- [ ] Добавить механизм "skip waiting" + уведомление об обновлении
- [ ] Унифицировать список файлов — генерировать из одного источника (sw.js, validate-static.mjs, main.js)

### 6.3 Деплой
- [ ] `static.yml:52` — деплоить только публичные файлы, не весь репозиторий
- [ ] Добавить `.nojekyll` файл

### 6.4 Доступность (a11y)
- [ ] Убрать `user-scalable=no` и `maximum-scale=1.0` из viewport
- [ ] Добавить `aria-label` к кнопкам без текста (scrollTopBtn, etc.)
- [ ] Добавить `<label>` или `aria-label` к полям паролей
- [ ] Добавить `autocomplete="current-password"` / `autocomplete="new-password"`
- [ ] Добавить `<noscript>` fallback

---

## ПОРЯДОК ВЫПОЛНЕНИЯ

```
Фаза 1 (Безопасность)     ████████████████████  — СНАЧАЛА, самый высокий риск
Фаза 2 (Критические баги) ████████████           — быстрые правки, высокий эффект
Фаза 3 (Производительность) ██████████████       — ощутимо для пользователей
Фаза 4 (Обработка ошибок) ████████████           — улучшает надёжность
Фаза 5 (Рефакторинг)      ████████████████████   — самый большой scope
Фаза 6 (PWA/Deploy/a11y)  ████████████           — polish
```

**Оценка общего объёма:** ~70 задач в 6 фазах.
Фазы 1-2 — можно сделать за одну сессию.
Фаза 3 — отдельная сессия.
Фазы 4-6 — по сессии каждая.
