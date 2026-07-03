# Orbit Chat 1.5.7 - App Store Readiness

## Orbit+ expansion

- Added a new `Orbit+` hub with stories, friends, profile power, achievements, customization shop, mini-games, clans, safety preferences, and onboarding.
- Replaced the first simple game buttons with real active mini-games: Reactor, Memory, and Signal with a timed grid, score, combo, miss penalty, and server-saved results.
- Fixed the mobile game layout so the real Orbit+ games stay visible after scrolling, and active games hide the stats/tabs area so the playable grid starts inside the phone viewport.
- Added a bottom mobile `Orbit+` tab so games and achievements are reachable from the phone layout.
- Expanded achievements with story reactions, profile style, social core, clan membership, arcade completion, high score, and profile level goals.
- Added server-side persistence for stories, friend requests, clans, mini-game rounds, XP, achievements, custom inventory, notification preferences, profile frames, themes, message effects, and profile badges.
- Added live `orbit-plus` SSE updates so account/profile/social changes can refresh without restarting the app.
- Added `npm run smoke:orbit` for a real HTTP smoke test that creates temporary users, checks friends/stories/games/clans/achievements, and cleans up.
- Added API smoke coverage for the new social flow: two users, friend request, accept, story, story reaction, friend removal, customization, mini-game, clan, preferences, and DM.
- Added mobile browser checks for every Orbit+ tab with overflow detection.
- Expanded `qa-check.js` so future GitHub uploads fail if Orbit+ client/server APIs or UI tabs are missing.

## App Store preparation

- Added in-app privacy, support, terms, and community guidelines links.
- Added public `privacy.html`, `support.html`, `terms.html`, and `community-guidelines.html` pages.
- Rebuilt `terms.html` as a full user agreement for App Store review: accounts, user-generated content, reports, blocking, moderation, account deletion, calls/media, privacy, payments, and Apple App Store conditions.
- Added self-service account deletion in Security so users can remove their own account from inside the app.
- Added `/api/account/delete` with session cleanup, push cleanup, contact cleanup, room updates, and account data removal.
- Prepared a separate `app-store-package` with iOS wrapper files, App Store metadata drafts, review notes, privacy label guidance, and submission checklist.

## Layout restoration

- Restored the app package version to `1.5.7`.
- Disabled the later experimental phone control layer so the old button layout stays in place.
- Moved `Все / Непрочит. / Архив` below the chat list instead of keeping it in the crowded top menu.
- Tightened mobile chat-row title/subtitle spacing so chat names and descriptions sit under each other cleanly.
- Added visible logout controls in the account footer and profile without changing the main button grid.
- Registration no longer sends or requires an email confirmation code; accounts are created immediately after legal acceptance, email, nickname, and password validation.
- Added a private Support chat: users open it from the chat tabs, admins see support conversations and can reply from the app.
- Admin replies inside Support chats are shown to users as `Поддержка Orbit`, so the admin personal profile is not exposed.
- Registration now requires accepting Terms and Privacy before account creation; the acceptance timestamps are stored on the account.
- Terms and Privacy are always available from Profile with dedicated button-style links.
- The top Poll button in the chat toolbar is hidden; Poll remains available from the lower attachment/action menu.
- Chat list titles were nudged right and locked into their own column beside the avatar.
- Live incoming messages now preserve the composer text, focus, and cursor position; read receipts no longer reopen the current chat while the user is typing.
- Added admin-controlled Premium status with a gold badge, live account updates, and Premium nickname stickers visible across chats, profiles, messages, and user lists.
- Added private Premium applications: users submit a message from Profile, only admins can read it, and admins can approve or reject requests from the Security admin panel.

## QA

- `node --check server.js`
- `node --check sw.js`
- Inline client JavaScript syntax check from `index.html`.
- `node qa-check.js`
- Mobile browser QA for Orbit+ games: bottom tab opens the games screen, Reactor/Signal render a visible grid, tapping the active cell increases score/combo, cancel exits without saving.
- SSE live-message smoke test proving an incoming message event is delivered without needing a restart.
- API smoke test for self-service account deletion.

# Orbit Chat 1.5.6 - Email Codes, Filters, Scheduled Messages

## Major features

- Registration no longer requires a 6-digit email code before the account is created.
- Existing accounts can bind a new email only after confirming a code sent to the new address.
- Added chat filters for All, Unread, and Archive.
- Added scheduled messages: the server stores the queue and sends messages automatically at the selected time.
- Added a closer iPhone-style glass shell with status bar, stronger black-blue depth, and live clock.

## QA

- `node --check server.js`
- `node --check sw.js`
- Inline client JavaScript syntax check from `index.html`.
- `node qa-check.js`
- API smoke test for email-code registration, wrong-code rejection, email change confirmation, and scheduled message create/list/delete.
- Timer delivery test proving a scheduled message is sent by the server automatically.

# Orbit Chat 1.5.5 - iPhone Concept Match

## Visual fidelity pass

- Added the iPhone-style bottom dock with Chats, Calls, Contacts, Favorites, and Profile.
- Added the large glass action sheet from the concept with Photo, Camera, File, Voice, Contact, and Poll actions.
- Reworked the shell into a closer two-panel glass layout with stronger blue active states, bigger circular controls, a darker message texture, and a more concept-like composer.
- Wired every new visible control to real app behavior instead of static decoration.

## QA

- `node --check server.js`
- `node --check sw.js`
- `node qa-check.js`
- Inline client JavaScript syntax check from `index.html`.
- Visual comparison against the accepted generated concept and mobile browser screenshot.

# Orbit Chat 1.5.4 - iPhone Glass Redesign

## Full redesign

- Rebuilt the visual system around black, deep navy, electric blue, cyan, and true iPhone-style dark surfaces.
- Added Apple-like frosted glass across auth, sidebars, chat, composer, modals, quick panels, cards, toasts, and call surfaces.
- Reworked message bubbles, chat rows, inputs, tabs, avatars, icons, badges, empty states, and action controls with blue rim light and hairline borders.
- Rebuilt the mobile button layout: side actions use a 5-button grid, chat header actions use a 7-button grid, and chat tools use a stable 6-column thumb-friendly grid.
- Improved phone safe-area behavior, sticky iPhone-style composer, glass bottom profile sheets, and cleaner call/action button grids.

## QA

- `node --check server.js`
- `node --check sw.js`
- `node qa-check.js`
- API smoke test for private rooms and removed global chat.
- Repeated CSS checks for theme tokens, glass blur, mobile grids, and version sync.

# Orbit Chat 1.5.3 - Private Mode Update

## Features

- Removed the global/public chat from the normal app flow.
- Added unread-first chat sorting.
- Added compact chat mode for denser conversations.
- Added focus mode that hides extra message chrome.
- Added quick emoji and quick message-template panels.
- Added a live message length counter in the composer.

## Design features

- Added a private-mode strip in the sidebar.
- Added accent rails to chat and contact rows.
- Added active glow states for the new client-side mode buttons.
- Added glass quick-action panels for emoji and templates.
- Added a private empty-home screen when no chat is selected.

## QA

- `node --check server.js`
- `node --check sw.js`
- `node qa-check.js`
- Mobile browser smoke test for auth, private empty state, chat list width, and quick controls.

# Orbit Chat 1.5.2 - Mobile Layout Rebuild

## Mobile rebuild

- Reworked phone menus from cramped bottom sheets into full-screen mobile panels.
- Replaced the hidden horizontal chat tool strip with a stable search + 4-column button grid.
- Tightened the chat header, avatar, room title, top actions, composer, and safe-area spacing for 360-430px screens.
- Balanced menu action buttons so odd button counts no longer leave one small button floating on the left.
- Kept long menu headings and action bars sticky without covering the main content.

## QA

- `node --check server.js`
- `node --check sw.js`
- `node qa-check.js`

# Orbit Chat 1.5.1 - Mobile Layout Polish

## Mobile layout

- All modal menus now behave like mobile bottom sheets with safe-area spacing, contained scrolling, and a small drag handle.
- Profile, notification, security, media, group, poll, task, and event panels now keep their headings visible while scrolling.
- The chat tool rail turns into a horizontal snap dock on phones so search and all action buttons stay reachable.
- Chat list, search, tabs, avatars, footer, and counters are denser and cleaner on small screens.

## Design features

- Added colored P/T/E feature chips for polls, tasks, and events in the chat list.
- Added active glow feedback to the tool buttons.
- Added mobile sheet handles and sticky panel bars for a more app-like feel.

## QA

- `node --check server.js`
- `node qa-check.js`

# Orbit Chat 1.5.0 - Command Rooms Update

## Major features

- Polls menu: create room polls, vote, see live result bars, close polls, and show active poll counters in rooms.
- Task board menu: create room tasks, assign people, set priority, move tasks between Plan / In Work / Done, delete tasks, and show open-task counters.
- Events menu: create room events with time, place, details, RSVP yes/maybe/no, cancel events, and show upcoming-event counters.

## Design upgrades

- Expanded chat action rail with dedicated feature buttons and live badges.
- Larger feature panels with a stronger glass surface and smoother opening animation.
- New progress bars, priority chips, RSVP chips, and feature-empty states.
- Chat list now surfaces P/T/E counters for rooms with active collaboration.
- Mobile layout collapses the feature board and task columns cleanly into one column.

## QA

- `node --check server.js`
- `node qa-check.js`
- Temporary-server API smoke test for polls, voting, tasks, task status changes, events, RSVP, and room feature counters.

# Orbit Chat 1.4.9 - Power Chat Update

## New features

- Message forwarding to any available chat with server-side access checks and `forwardedFrom` metadata.
- Room mute mode: the room stays readable, but push notifications are skipped for muted rooms.
- Chat export button that downloads the current conversation as a readable `.txt` file.
- Private per-room notes saved locally for the signed-in user.
- Slash commands in the composer: `/roll`, `/coin`, `/me`, `/time`, `/shrug`, `/help`.

## QA

- `node --check server.js`
- `node --check qa-check.js`
- `node qa-check.js`
- Temporary-server API smoke test for register, room mute, forwarding, and receiver visibility.

# Orbit Chat 1.4.8 - Strict Admin Bans

## Admin blocking

- Admin bans now revoke sessions, push subscriptions, call invites, password reset tokens, and live client connections.
- Banned users cannot log in again while the ban is active.
- Sessions now carry `banVersion`, so old sessions cannot revive after a ban cycle.

# Orbit Chat 1.4.7 - Admin Conversation Moderation

## Admin moderation

- Admins can open a moderation view with all global chats, groups, and direct conversations.
- Admins can read messages in selected conversations for moderation.
- Admins can delete user messages for everyone, with a security-event audit record.
- Admins can open attachments from moderated conversations.

# Orbit Chat 1.4.6 - Voice Messages Repair

## Voice messages

- Added a Web Audio WAV fallback for browsers and phones where `MediaRecorder` is missing or fails to start.
- Voice recording stop is more reliable when a browser throws during `requestData()`.
- QA now checks that the fallback recorder and WAV encoder stay in the app.

# Orbit Chat 1.4.5 - Admin Moderation Update

## Админ-панель

- Администратор теперь может удалять аккаунты пользователей.
- Удаление аккаунта сбрасывает сессии, push-подписки, контакты, личные чаты и связанные жалобы.
- Нельзя удалить себя или другой аккаунт администратора.
- В профиле пользователя появилась кнопка `Админ: удалить`.
- Раздел жалоб в панели безопасности расширен: видно цель жалобы, автора, причину, время, текст сообщения или имя файла.
- Из жалобы можно открыть профиль пользователя.

# Orbit Chat 1.4.4 - Admin Password Privacy Fix

## Исправлено

- В поле админ-входа больше не показывается настоящий пароль.
- Из README, релиз-нотов и отчета убрано точное значение админ-пароля.

# Orbit Chat 1.4.3 - Admin Login Update

## Админ-вход

- На экране входа/регистрации добавлена форма `Пароль администратора`.
- Пароль администратора больше не показывается в интерфейсе.
- Если пароль введен правильно, приложение входит в служебный аккаунт `Администратор`.
- Пароль можно заменить на Render через переменную `ADMIN_LOGIN_PASSWORD`.

## Админ-блокировка

- В профиле пользователя у администратора появляется кнопка `Админ: забанить`.
- Админская блокировка действует на весь сайт, а не только на личный чат.
- При бане активные сессии пользователя сбрасываются.
- Забаненный пользователь не может войти, пока админ его не разбанит.
- В поиске и профиле админ видит статус бана и причину.

## QA

- `node --check server.js`
- `node --check sw.js`
- `node qa-check.js`
- Deep Admin QA: неверный админ-пароль, вход по заданному админ-паролю, создание админ-аккаунта, бан пользователя, запрет входа забаненному, разбан.

# Orbit Chat 1.4.2 - Everyday Features Update

## Новые фишки

- Добавлены избранные сообщения: у любого сообщения можно нажать `☆ В избранное`.
- Добавлен фильтр `★` в поисковой панели чата: показывает только избранные сообщения текущего чата.
- Добавлены черновики по чатам: начал писать, ушел в другой чат, вернулся - текст не пропадает.
- Добавлены любимые чаты: кнопка звезды в шапке чата сохраняет чат в аккаунте.
- Любимые чаты поднимаются выше в списке и подтягиваются после входа с другого устройства.
- Добавлено копирование текста сообщения.
- Добавлено копирование ссылки на конкретное сообщение: ссылка открывает нужный чат и подсвечивает сообщение.

## Сервер

- Новая схема данных `6`.
- Новое поле аккаунта `favoriteRoomIds`.
- Новая ручка `/api/rooms/favorite`.
- Ручка `/api/messages/save` сохраняет избранное отдельно для каждого пользователя.

## QA

- `node --check server.js`
- `node --check sw.js`
- `node qa-check.js`
- Deep API QA: регистрация, версия `1.4.2`, отправка сообщения, избранное сообщение, фильтр избранного, любимый чат.
- Served HTML smoke: страница отдается сервером и содержит новые элементы UI.
- DOM id audit: 133 id, дубликатов нет.

# Orbit Chat 1.4.1 - Voice Reliability Update

## Voice Messages

- Fixed phone/browser voice uploads that arrive as `video/webm`, `video/mp4`, or `application/octet-stream`.
- Added voice recording timer.
- Added cancel voice recording button.
- Added Escape-to-cancel while recording.
- Added voice duration metadata.
- Voice duration is shown in preview and in sent messages.
- Server now keeps suspicious video containers blocked unless the upload is explicitly marked as a voice recording.

## Voice QA

- `audio/wav` accepted.
- `video/webm` voice normalized to `audio/webm`.
- `application/octet-stream` voice normalized to `audio/webm`.
- `video/mp4` voice normalized to `audio/mp4`.
- `video/webm` without voice intent rejected.
- Voice upload links still require login.

# Orbit Chat 1.4.0 - Ideal Upgrade

## Главное

- Добавлено восстановление пароля по почте.
- Добавлена опциональная база PostgreSQL через `DATABASE_URL`.
- Новые загрузки файлов дублируются в PostgreSQL, если база подключена.
- Добавлены блокировки пользователей.
- Добавлены жалобы на пользователя или конкретное сообщение.
- Добавлены роли в группах: владелец, админы, участники.
- Добавлено управление группой: переименовать, добавить, удалить, повысить, снять админа, выйти.
- Добавлены ответы на сообщения.
- Добавлена медиа-галерея чата.
- Добавлена админ-панель жалоб в разделе `Безопасность`.

## Аккаунт

- На экране входа появилась кнопка `Забыли пароль?`.
- Письмо восстановления ведёт на ссылку вида `/?reset=...`.
- Токен восстановления хранится на сервере только как SHA-256 хеш.
- Ссылка восстановления действует 1 час.
- После сброса пароля все старые сессии аккаунта удаляются.

## Приватность

- Заблокированный пользователь не сможет писать тебе в личку.
- Сообщения заблокированных пользователей скрываются для тебя в общих чатах и группах.
- Звонки от заблокированных пользователей блокируются сервером.
- Контакт нельзя сохранить, пока есть блокировка.
- Жалобы сохраняются на сервере и доступны админам.

## Группы

- Создатель группы становится владельцем.
- Владелец может назначать и снимать админов.
- Владелец и админы могут менять название, добавлять и удалять участников.
- Участники могут выйти из группы.
- В шапке чата появилась кнопка информации о чате.

## Медиа

- В шапке чата появилась кнопка медиа.
- Галерея показывает последние фото, файлы и голосовые текущего чата.
- Доступ к файлам всё ещё приватный и требует активного входа.

## PostgreSQL

Если на Render добавить `DATABASE_URL`, приложение хранит состояние в PostgreSQL и параллельно делает JSON-копию.

Новые загрузки файлов тоже дублируются в PostgreSQL. Это лучше, чем только Render Disk, потому что база переживает перезапуски и лучше подходит для настоящего опубликованного приложения.

## Проверка

```bash
npm install
npm run check
npm start
```

Потом открой:

```text
http://127.0.0.1:8790/api/health
```

В ответе должна быть версия `1.4.0`.
