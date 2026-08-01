# Orbit Chat Security Audit

Date: 2026-07-31

## Fixed critical findings

1. A fallback administrator password was present in the public server source.
2. The first database user could become an administrator when `ADMIN_EMAILS` was empty.
3. Raw session tokens were stored in JSON/PostgreSQL state and returned in login JSON.
4. Cookie-authenticated modifying requests had no session-bound CSRF token.

## Fixed high-risk findings

1. Administrator sessions used the same 14-day lifetime as user sessions.
2. Password hashes used only the older PBKDF2 format and had no automatic migration to a memory-hard KDF.
3. Password recovery exposed account existence through response data and timing.
4. Email changes and account deletion did not require password confirmation.
5. Login protection only tracked one IP/email pair and in-memory rate buckets could grow without cleanup.
6. Revoked sessions could keep an already-open live event connection.
7. Runtime dependencies were not locked and the mail package was outdated.

## Remaining operational requirements

- Configure strong secrets and persistent PostgreSQL in Render.
- Keep Render and PostgreSQL accounts protected with MFA.
- Rotate secrets after uploading this version because the old administrator password was previously public.
- Back up the database and test restoration regularly.
- Consider verified email ownership and administrator MFA before handling sensitive or paid data.
