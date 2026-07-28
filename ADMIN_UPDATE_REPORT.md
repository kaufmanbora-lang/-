# Orbit Chat Admin Update Report

Date: 2026-06-13
Version: 1.4.5

## Added

- Admin login form on the auth screen.
- Admin password is accepted by the server but is no longer shown in the UI or docs.
- `/api/admin-login` endpoint.
- Automatic system admin account named `Администратор`.
- `/api/admin/block` endpoint.
- Admin-only `Админ: забанить` / `Админ: разбанить` button in user profiles.
- Admin-only `Админ: удалить` button in user profiles.
- Site-wide user bans with reason text.
- Banned users are logged out and cannot log in until unbanned.
- Account deletion cleanup for sessions, push subscriptions, contacts, related private chats, group membership, reports, and pins.
- Expanded reports view in the security panel with target, reporter, reason, time, message/file preview, and profile shortcut.

## Render Setting

The default password works as requested. For a real public release, change it on Render:

```text
ADMIN_LOGIN_PASSWORD=your-new-password
```

## QA Passed

- `node --check server.js`
- `node --check sw.js`
- `node qa-check.js`
- Deep Admin QA:
  - wrong admin password is rejected;
  - configured admin password logs into the admin account;
  - admin can find a user;
  - admin can ban a user;
  - banned user cannot log in;
  - admin can unban the user;
  - unbanned user can log in again.
