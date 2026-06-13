# Orbit Chat Security

Version `1.2.0` adds a real server-side security layer.

## What Is Protected

- Static file allowlist: the server only serves public app files. Internal files like `server.js`, logs, `data/orbit-chat-data.json`, and deployment docs are not exposed through the browser.
- HttpOnly session cookie: after login the browser receives a protected `orbit_session` cookie. Live events no longer put the auth token into the URL.
- Cookie-first client: new sessions are not written into `localStorage`; old stored tokens are only used once for migration and then removed.
- Stronger passwords: new accounts must use at least 10 characters with a letter and a number.
- Stronger password hashing: PBKDF2-SHA256 now uses 310,000 iterations for new and upgraded passwords.
- Login abuse protection: repeated wrong password attempts lock that email/IP pair for 15 minutes.
- Upload validation: uploaded files are checked by content signature, not only by browser MIME type. SVG uploads are blocked.
- Private upload access: uploaded files require login and are only served if the user can access the avatar or message room that owns the file.
- Safer headers: CSP, frame blocking, no-sniff, referrer policy, HSTS, and permission policy are sent on responses.
- Origin protection: dangerous API methods reject requests from untrusted origins.
- Session control: `/api/security` shows active sessions and `/api/security/revoke-other-sessions` removes other logins.
- Safer errors: unexpected server errors no longer reveal internal paths to users.

## Render Settings To Use

Set these environment variables in Render:

- `DATA_DIR=/var/data`
- `VAPID_SUBJECT=mailto:your-email@example.com`
- `SESSION_SECRET=` a long random secret if you want to control it yourself
- `ALLOWED_ORIGINS=` optional comma-separated extra origins

Keep the Render service on HTTPS. Browser push notifications, camera, microphone, and secure cookies need HTTPS in production.

## Important

No real internet app can be made impossible to hack forever. This version closes the biggest practical risks in this project, but you should still keep backups, update dependencies, and avoid sharing admin/server files.
