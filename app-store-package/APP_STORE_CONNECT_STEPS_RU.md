# Как загрузить Orbit Chat в App Store

## 1. Сначала сайт должен работать

В App Store нельзя отправлять приложение, если сервер выключен. Сначала обнови GitHub и Render:

1. Загрузи новую версию из папки `github-upload` в GitHub.
2. Дождись, пока Render сделает новый деплой.
3. Проверь, что ссылки работают:
   - `https://ТВОЙ_RENDER_URL/`
   - `https://ТВОЙ_RENDER_URL/privacy.html`
   - `https://ТВОЙ_RENDER_URL/support.html`

## 2. Замени плейсхолдеры

В папке `ios-wrapper` замени:

- `https://YOUR_RENDER_URL` на свою настоящую ссылку Render.
- `YOUR_BUNDLE_ID` на Bundle ID, например `com.borys.orbitchat`.
- `YOUR_APPLE_ID_EMAIL`, `YOUR_ASC_APP_ID`, `YOUR_APPLE_TEAM_ID` в `eas.json`.

В `store.config.json` замени:

- `YOUR_NAME`;
- `YOUR_RENDER_URL`;
- `YOUR_SUPPORT_EMAIL`;
- `YOUR_DEMO_EMAIL@example.com`;
- `YOUR_DEMO_PASSWORD`;
- имя, фамилию и телефон для App Review.

## 3. Создай приложение в App Store Connect

1. Открой App Store Connect.
2. Нажми My Apps -> + -> New App.
3. Platform: iOS.
4. Name: Orbit Chat.
5. Primary Language: English или Russian.
6. Bundle ID: тот же, что в `app.json`.
7. SKU: `orbit-chat-ios`.

## 4. Собери iOS build через EAS

Открой терминал в папке `app-store-package/ios-wrapper`:

```bash
npm install
npx eas-cli@latest login
npx eas-cli@latest init
npx eas-cli@latest credentials -p ios
npx eas-cli@latest build -p ios --profile production
```

После сборки отправь build:

```bash
npx eas-cli@latest submit -p ios --latest
```

## 5. Заполни App Store Connect

Заполни:

- название и описание из `APP_STORE_DESCRIPTION_RU.md` или `APP_STORE_DESCRIPTION_EN.md`;
- Privacy Policy URL: `https://ТВОЙ_RENDER_URL/privacy.html`;
- Support URL: `https://ТВОЙ_RENDER_URL/support.html`;
- App Privacy по файлу `APP_PRIVACY_LABEL.md`;
- Review Notes по файлу `REVIEW_NOTES.md`;
- screenshots по файлу `SCREENSHOTS_PLAN.md`;
- age rating: честно укажи, что это соцсеть с пользовательским контентом.

## 6. Сначала TestFlight

Перед App Store Review обязательно проверь TestFlight на реальном iPhone:

- регистрация;
- вход;
- личный чат;
- группа;
- файл;
- голосовое;
- звонок;
- уведомления;
- жалоба;
- блокировка;
- удаление аккаунта.

## Важное

App Store не гарантирует одобрение автоматически. Особенно внимательно Apple проверяет соцсети, пользовательский контент, privacy policy, поддержку, demo account, модерацию, push и удаление аккаунта.
