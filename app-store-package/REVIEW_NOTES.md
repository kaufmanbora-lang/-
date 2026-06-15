# App Review Notes template

Paste this into App Store Connect -> App Review Information -> Notes.

## Demo account

Demo email: `YOUR_DEMO_EMAIL@example.com`

Demo password: `YOUR_DEMO_PASSWORD`

If email delivery is being reviewed, keep SMTP/Resend enabled and provide a demo inbox if needed.

## Backend

Production backend URL: `https://YOUR_RENDER_URL`

The backend is live during review and supports account login, chats, files, calls, push registration, reports, blocks, and account deletion.

## How to test core flows

1. Log in with the demo account.
2. Search for another demo user or create a second account.
3. Open a direct chat and send a text message.
4. Send a photo/file and a voice message.
5. Open a group chat and test group messaging.
6. Start an audio or video call.
7. Open a user profile and test report/block.
8. Open Security and test session view.
9. Account deletion is available at Security -> Delete my account. Do not delete the review demo account unless you intend to recreate it.

## User-generated content moderation

The app includes:

- offensive content reporting from user profiles and messages;
- user blocking;
- admin report review;
- admin message deletion;
- admin account blocking;
- admin account deletion;
- community guidelines page inside the app.

## Push notifications

Push notifications are optional. Users must opt in from the notifications panel. The app remains functional if notifications are denied.

## Camera and microphone

Camera and microphone are used only for video calls, audio calls, and voice messages. The app requests permission only when a user starts those features.
