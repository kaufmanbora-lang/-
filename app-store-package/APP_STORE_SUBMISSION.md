# Orbit Chat App Store package

This folder contains the separate files prepared for an iOS App Store submission.

## What is included

- `store.config.json` - draft App Store metadata for EAS Metadata.
- `APP_STORE_DESCRIPTION_RU.md` - Russian listing copy.
- `APP_STORE_DESCRIPTION_EN.md` - English listing copy.
- `APP_PRIVACY_LABEL.md` - suggested App Privacy answers.
- `REVIEW_NOTES.md` - App Review notes template.
- `SCREENSHOTS_PLAN.md` - screenshot checklist.
- `ios-wrapper/` - Expo iOS wrapper around the hosted Orbit Chat web app.

## Must replace before submission

Replace every placeholder that starts with `YOUR_` or `your-`:

- `YOUR_RENDER_URL` with the live Render URL, for example `https://orbit-chat.onrender.com`.
- `YOUR_BUNDLE_ID` with your Apple bundle ID, for example `com.yourname.orbitchat`.
- `YOUR_APPLE_ID_EMAIL`, `YOUR_ASC_APP_ID`, and `YOUR_APPLE_TEAM_ID`.
- `YOUR_SUPPORT_EMAIL` and support contact details.
- Demo account email and password for App Review.

## Apple review readiness checklist

- Backend is live and reachable worldwide.
- App has a working demo account or full demo mode.
- Privacy policy URL works in App Store Connect and inside the app.
- Support URL works and has real contact information.
- In-app account deletion works from Security -> Delete my account.
- User-generated content has report, block, moderation, and admin deletion flows.
- Push notifications are optional and can be disabled.
- App description, screenshots, and review notes match the real app.
- TestFlight build is tested on a real iPhone before App Store review.

## Build path

1. Deploy the web app to Render first.
2. Open `ios-wrapper/App.js` and set `APP_URL` to the live Render URL.
3. Open `ios-wrapper/app.json` and set `bundleIdentifier`.
4. Install dependencies:

```bash
npm install
```

5. Log in to Expo/EAS:

```bash
npx eas-cli@latest login
npx eas-cli@latest init
```

6. Configure iOS credentials:

```bash
npx eas-cli@latest credentials -p ios
```

7. Build for TestFlight:

```bash
npx eas-cli@latest build -p ios --profile production
```

8. Submit:

```bash
npx eas-cli@latest submit -p ios --latest
```

## Important note

This wrapper is prepared so the current web app can become an iOS package. Apple can reject apps that are only a thin web wrapper if they feel the app lacks native value. To reduce that risk, keep the app polished, provide working push/camera/microphone flows, and explain the messenger features clearly in Review Notes.
