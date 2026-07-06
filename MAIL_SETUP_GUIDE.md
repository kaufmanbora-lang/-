# Как подключить почту на сервере

Этот файл нужен, чтобы в Orbit Chat реально приходили письма восстановления пароля.

Регистрация и смена почты теперь работают без кода из письма.

Секреты нельзя загружать в GitHub. Все пароли и ключи добавляются только в Render: `orbit-chat` -> `Environment`.

## Вариант 1. Самый простой: Gmail

Подходит для теста и маленького запуска.

### 1. Создай пароль приложения в Google

Обычный пароль от Gmail не подойдет.

1. Открой свой Google аккаунт.
2. Открой `Безопасность`.
3. Включи `Двухэтапная аутентификация`.
4. После этого найди `Пароли приложений`.
5. Создай новый пароль приложения.
6. Google даст пароль из 16 символов, например:

```text
abcd efgh ijkl mnop
```

Это и есть `SMTP_PASS`.

Если пункта `Пароли приложений` нет, значит двухэтапная аутентификация еще не включена или Google не дает эту функцию для твоего аккаунта.

### 2. Добавь переменные в Render

1. Открой Render.
2. Открой сервис `orbit-chat`.
3. Нажми `Environment`.
4. Нажми `Add Environment Variable`.
5. Добавь эти строки:

```text
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=твояпочта@gmail.com
SMTP_PASS=пароль_приложения_из_Google
SMTP_FROM=Orbit Chat <твояпочта@gmail.com>
PUBLIC_APP_URL=https://твоя-ссылка.onrender.com
```

Пример:

```text
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=orbit.test@gmail.com
SMTP_PASS=abcd efgh ijkl mnop
SMTP_FROM=Orbit Chat <orbit.test@gmail.com>
PUBLIC_APP_URL=https://orbit-chat-1234.onrender.com
```

Важно: в `SMTP_FROM` должна быть та же Gmail-почта, что и в `SMTP_USER`.

### 3. Перезапусти сайт

В Render нажми:

```text
Manual Deploy
Deploy latest commit
```

Подожди, пока статус станет `Live`.

### 4. Проверь

Открой:

```text
https://твоя-ссылка.onrender.com/api/health
```

Должно быть:

```json
"mailReady": true
```

Если там:

```json
"mailReady": false
```

значит почта не подключилась.

## Вариант 2. Для нормального релиза: Resend

Resend лучше для настоящего приложения, но обычно нужен свой домен.

### 1. Создай API key

1. Открой `resend.com`.
2. Зарегистрируйся.
3. Открой `API Keys`.
4. Создай ключ.
5. Скопируй его.

### 2. Добавь домен

1. В Resend открой `Domains`.
2. Добавь свой домен.
3. Resend покажет DNS-записи.
4. Добавь эти DNS-записи у регистратора домена.
5. Дождись, пока домен станет `Verified`.

Без подтвержденного домена письма могут не уходить обычным людям.

### 3. Добавь переменные в Render

В Render -> `orbit-chat` -> `Environment` добавь:

```text
RESEND_API_KEY=твой_ключ_из_Resend
MAIL_FROM=Orbit Chat <no-reply@твой-домен.com>
PUBLIC_APP_URL=https://твоя-ссылка.onrender.com
```

Потом нажми:

```text
Manual Deploy
Deploy latest commit
```

## Частые ошибки

- Вставил обычный пароль Gmail вместо пароля приложения.
- Забыл включить двухэтапную аутентификацию Google.
- Написал `SMTP_USER` одной почтой, а `SMTP_FROM` другой.
- Забыл нажать `Manual Deploy`.
- В `PUBLIC_APP_URL` оставил пример, а не свою Render-ссылку.
- Добавил секреты в GitHub вместо Render.
- Для Resend не подтвердил домен.

## Что делать после настройки

1. Открой сайт.
2. Попробуй зарегистрировать новый аккаунт.
3. Нажми `Забыли пароль?`.
4. Введи почту аккаунта.
5. На почту должна прийти ссылка восстановления.
6. Если письмо не пришло, открой:

```text
https://твоя-ссылка.onrender.com/api/health
```

Если `mailReady` равен `false`, проблема в переменных Render.

Если `mailReady` равен `true`, но письма не приходят, проверь папку `Спам` и правильность почты.
