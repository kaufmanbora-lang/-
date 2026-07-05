# Как загрузить Orbit Chat на GitHub и Render

## 1. Загрузить файлы на GitHub

1. Открой свой репозиторий на GitHub.
2. Нажми `Add file`.
3. Нажми `Upload files`.
4. Перетащи все файлы из папки `github-upload`.
5. Нажми зеленую кнопку `Commit changes`.

Загружать нужно эти файлы:

- `.gitignore`
- `DEPLOY_GUIDE.md`
- `RELEASE_NOTES.md`
- `README.md`
- `SECURITY.md`
- `TROUBLESHOOTING.md`
- `PHONE_PUSH_GUIDE.md`
- `MAIL_SETUP_GUIDE.md`
- `index.html`
- `manifest.json`
- `icon.svg`
- `icon-192.png`
- `icon-512.png`
- `maskable-icon.svg`
- `maskable-icon-512.png`
- `package.json`
- `qa-check.js`
- `QA_REPORT.md`
- `render.yaml`
- `server.js`
- `sw.js`

Папку `data` и файл `orbit-chat-data.json` загружать не нужно.

## 2. Запустить на Render

1. Открой Render.
2. Нажми `New`.
3. Нажми `Blueprint`.
4. Выбери репозиторий с Orbit Chat.
5. Если Render спрашивает `Blueprint Path`, оставь поле пустым, потому что `render.yaml` лежит в корне репозитория.
6. Нажми `Apply`.
7. Подожди, пока появится зеленый статус.
8. Открой ресурс `orbit-chat`.
9. Скопируй ссылку вида `https://orbit-chat-xxxx.onrender.com`.

Эту ссылку можно отправить другу. Он сможет открыть ее с телефона, из Англии, с любого интернета.

## 2.1. Настроить письма восстановления пароля

Регистрация и смена почты теперь работают без кода из письма. Почта нужна только для восстановления пароля. Если хочешь, чтобы письма восстановления реально приходили, в Render открой сервис `orbit-chat` -> `Environment` и добавь один из вариантов.

SMTP:

```text
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=your-user
SMTP_PASS=your-password
SMTP_FROM=Orbit Chat <no-reply@your-domain.com>
PUBLIC_APP_URL=https://твоя-ссылка.onrender.com
```

Или Resend:

```text
RESEND_API_KEY=your-resend-key
MAIL_FROM=Orbit Chat <no-reply@your-domain.com>
PUBLIC_APP_URL=https://твоя-ссылка.onrender.com
```

После этого нажми `Manual Deploy` -> `Deploy latest commit`.

## 2.2. Обязательно подключить PostgreSQL, чтобы данные не пропадали

Рекомендуемый вариант для настоящего релиза:

1. В Render нажми `New`.
2. Выбери `PostgreSQL`.
3. Создай базу.
4. Открой базу и скопируй `Internal Database URL`.
5. Открой сервис `orbit-chat` -> `Environment`.
6. Добавь переменную:

```text
DATABASE_URL=твой Internal Database URL
```

7. Нажми `Manual Deploy` -> `Deploy latest commit`.

После этого `/api/health` должен показать:

```json
"postgresConfigured": true,
"postgresReady": true
```

Если `postgresReady` false, приложение всё равно запустится на JSON, но аккаунты, сообщения и файлы могут пропасть после перезапуска. Для настоящего сайта исправь `DATABASE_URL`.

## 2.3. Назначить админа для жалоб

Чтобы видеть жалобы в панели `Безопасность`, добавь:

```text
ADMIN_EMAILS=твоя-почта@example.com
```

Можно указать несколько почт через запятую.

## 2.4. Как включить уведомления на телефоне

1. Открой опубликованную HTTPS-ссылку Render на телефоне.
2. Войди в аккаунт.
3. На iPhone: Safari -> Поделиться -> На экран Домой, потом открой Orbit Chat с новой иконки.
4. На Android: открой меню браузера и установи приложение, если появится кнопка установки.
5. В Orbit Chat нажми колокольчик.
6. Нажми `Включить` и разреши уведомления.
7. Нажми `Тест`. Если все готово, придет push-уведомление.

Если уведомления на телефон всё равно не приходят, открой файл `PHONE_PUSH_GUIDE.md` и пройди чеклист для iPhone или Android.

## 3. Почему Render может просить карту

Render может попросить карту для платных инстансов, постоянного диска или PostgreSQL.

В новом `render.yaml` постоянный диск не включён автоматически. Для настоящего мессенджера подключи PostgreSQL через `DATABASE_URL`: тогда аккаунты, сообщения и новые файлы будут храниться в базе.

## 4. Обновление новой версии

1. Замени файлы в GitHub новыми файлами из папки проекта.
2. Нажми `Commit changes`.
3. Render сам начнет деплой.
4. Если сам не начал: Render -> `Manual Deploy` -> `Deploy latest commit`.
