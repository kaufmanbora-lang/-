# Orbit Chat Deep QA Report

Date: 2026-06-13

## Result

- Static/code QA: passed.
- Clean temporary API server QA: passed.
- Deep API checks: 137 passed, 0 failed.
- Found and fixed: normal 4xx client errors no longer print full stack traces in server logs. Only real 5xx server errors are logged as server errors.

## Commands Run

```bash
node --check server.js
node --check sw.js
node qa-check.js
```

## Static Audit

- 128 DOM ids checked.
- 127 JavaScript DOM references checked.
- 31 required API routes checked.
- 20 security checks passed.
- No duplicate DOM ids found.
- No missing DOM ids referenced by JavaScript found.

## API Flows Tested

- Health endpoint and app version.
- Static app files and unknown static file 404.
- Bad JSON rejection.
- Registration validation.
- Duplicate email and duplicate nickname rejection.
- Login success and wrong-password rejection.
- Email verification flow.
- Password reset flow.
- Old session revocation after password reset.
- `/api/security` session list.
- Revoke other sessions.
- User search privacy.
- Contact add/remove.
- Global messages.
- Message replies.
- Message reactions.
- Unsupported reaction rejection.
- Editing own messages.
- Rejecting edits/deletes of someone else's messages.
- Pin and unpin.
- Message search.
- Read markers.
- Typing events.
- Image upload.
- Private upload access.
- Media gallery.
- Fake image rejection by content signature.
- Text file upload.
- Voice WAV upload.
- Avatar upload.
- Group creation.
- Group owner/admin/member roles.
- Group promote/demote.
- Group rename.
- Group add/remove member.
- Removed group member access rejection.
- User blocking.
- DM rejection while blocked.
- Search hiding blocker from blocked user.
- Call rejection while blocked.
- Unblock and DM after unblock.
- Call offer/answer.
- Invalid call type rejection.
- Self-call rejection.
- Report creation.
- Admin report list.
- Non-admin report rejection.
- Email change with pending verification.
- Duplicate profile email rejection.
- Resend verification.
- Password change validation.
- Old session revocation after password change.
- Push status/key/test behavior without VAPID.
- SSE auth requirement and authenticated event stream.
- Logout and token rejection after logout.

## Browser QA Note

The in-app Browser runtime was available in the tool list but failed in this local desktop environment with:

```text
CreateProcessAsUserW failed: 5
```

Playwright fallback was also unavailable because `playwright-core` is not installed. Because of that, screenshot-based visual QA was blocked by the local tool environment. Static frontend checks and deep API checks passed.
