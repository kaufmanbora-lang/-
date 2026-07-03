# Orbit Chat iOS wrapper

This is an Expo wrapper for the hosted Orbit Chat web app.

## Before building

1. Deploy the main web app to Render.
2. Replace `https://YOUR_RENDER_URL` in:
   - `App.js`
   - `app.json`
3. Replace `YOUR_BUNDLE_ID` in `app.json`.
4. Replace Apple account placeholders in `eas.json`.
5. Replace app icons in `assets/` if you want final branding.

## Commands

```bash
npm install
npx eas-cli@latest login
npx eas-cli@latest init
npx eas-cli@latest credentials -p ios
npx eas-cli@latest build -p ios --profile production
npx eas-cli@latest submit -p ios --latest
```

## Permission strings

The iOS permission strings are already added for:

- camera: video calls;
- microphone: audio/video calls and voice messages;
- photo library: sending images and avatars.

## Review risk

Apple may reject a simple web wrapper under minimum functionality rules. The current app has real account, chat, call, push, file, moderation, and account deletion flows, which helps. Test it on a real iPhone with TestFlight before App Store review.
