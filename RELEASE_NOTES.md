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
