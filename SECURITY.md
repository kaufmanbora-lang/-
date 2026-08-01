# Orbit Chat Security

## Implemented protection

- Administrator access has no password embedded in the source. Production requires `ADMIN_LOGIN_PASSWORD` with at least 16 characters.
- Only accounts marked `isSystemAdmin` on the server have administrator rights. The first registered user never becomes an administrator automatically.
- New passwords use Node.js `scrypt` with a per-password random salt. Existing PBKDF2 passwords are accepted once and upgraded after a successful login.
- Session tokens are stored only as SHA-256 hashes. Raw tokens exist only in the protected browser cookie.
- Production uses a `__Host-` cookie with `Secure`, `HttpOnly`, `SameSite=Strict`, `Path=/`, and high priority.
- Every authenticated modifying request requires a session-bound CSRF token and a trusted browser origin.
- User sessions are limited to 8 per account, administrator sessions to 3, and administrator sessions expire after 4 hours.
- Login throttling covers both the client IP and the target account. Unknown users receive the same expensive password check to reduce account enumeration by timing.
- Password recovery always returns the same public response whether or not an account exists.
- Email changes and account deletion require the current account password. Email changes revoke other sessions.
- Uploaded files are size limited, checked against an allowlist, verified by file signature, stored with random names, and served only after an access check.
- Private server files are protected by an explicit static-file allowlist.
- CSP, HSTS, frame blocking, MIME sniffing protection, strict referrer policy, browser capability restrictions, and no-store API responses are enabled.
- Live event streams are limited per user and are closed when their session expires or is revoked.
- The data file is written with owner-only permissions on systems that support POSIX file modes.
- Exact dependency versions are recorded in `package-lock.json`; `npm audit --omit=dev` currently reports zero known vulnerabilities.

## Required Render settings

Set these values in Render before deploying:

- `SESSION_SECRET`: at least 64 random characters.
- `ADMIN_LOGIN_PASSWORD`: a unique password with at least 16 characters.
- `ADMIN_LOGIN_EMAIL`: the private administrator login email.
- `PUBLIC_APP_URL=https://orbit-chat-qdmx.onrender.com`
- `DATA_DIR=/var/data`
- `DATABASE_URL`: a persistent PostgreSQL database is strongly recommended.
- `TRUST_PROXY=true`
- `VAPID_SUBJECT=mailto:your-email@example.com`
- Email provider variables when password recovery is enabled.

Do not put real secrets into GitHub, screenshots, chat messages, ZIP archives, or `.env.example`. Store them only in Render Environment and a password manager.

## Verification

Run:

```powershell
npm ci
npm run check
npm run check:security
npm audit --omit=dev
```

`security-check.js` starts an isolated server and tests CSRF rejection, origin rejection, administrator authorization, upload signature validation, static-file isolation, secure cookies, scrypt passwords, and hashed session persistence.

No internet service can be guaranteed impossible to compromise. Keep dependencies updated, retain encrypted backups, review security logs, and rotate administrator/session secrets after any suspected leak.
