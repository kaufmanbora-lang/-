# Orbit Chat Security

Version `1.4.0` adds account recovery, blocking, reports, group roles, and optional PostgreSQL persistence on top of the server-side security layer.

## What Is Protected

- Static file allowlist: the server only serves public app files. Internal files like `server.js`, logs, `data/orbit-chat-data.json`, and deployment docs are not exposed through the browser.
- HttpOnly session cookie: after login the browser receives a protected `orbit_session` cookie. Live events no longer put the auth token into the URL.
- Cookie-first client: new sessions are not written into `localStorage`; old stored tokens are only used once for migration and then removed.
- Stronger passwords: new accounts must use at least 10 characters with a letter and a number.
- Stronger password hashing: PBKDF2-SHA256 now uses 310,000 iterations for new and upgraded passwords.
- Login abuse protection: repeated wrong password attempts lock that email/IP pair for 15 minutes.
- Upload validation: uploaded files are checked by content signature, not only by browser MIME type. SVG uploads are blocked.
- Private upload access: uploaded files require login and are only served if the user can access the avatar or message room that owns the file.
- Voice upload compatibility: real browser audio signatures for WebM, OGG, MP4/M4A, AAC, WAV, and MP3 are accepted while fake audio uploads remain blocked.
- Email verification: registration and email changes use one-time verification links. Tokens are stored only as SHA-256 hashes and expire after 24 hours.
- Password recovery: reset links are one-time, stored only as SHA-256 hashes, expire after 1 hour, and revoke old sessions after use.
- Search privacy: the app no longer receives the full user directory. People are found through `/api/users?q=...`, and empty search returns no users.
- Blocking: blocked users cannot DM or call through the server, and their messages are hidden for the blocker.
- Reports: reports are stored server-side and visible only to admins.
- Group roles: group owner/admin checks are enforced on the server for rename, add, remove, promote, demote, and leave flows.
- Optional PostgreSQL: `DATABASE_URL` stores app state and new uploaded files in PostgreSQL, with JSON/disk as a local fallback/backup.
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
- `PUBLIC_APP_URL=https://your-app.onrender.com`
- `DATABASE_URL=postgresql://...` recommended for real production persistence
- `ADMIN_EMAILS=you@example.com` optional comma-separated admin list for reports
- SMTP email: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`
- Or Resend email: `RESEND_API_KEY`, `MAIL_FROM`

Keep the Render service on HTTPS. Browser push notifications, camera, microphone, and secure cookies need HTTPS in production.

## Important

No real internet app can be made impossible to hack forever. This version closes the biggest practical risks in this project, but you should still keep backups, update dependencies, and avoid sharing admin/server files.
