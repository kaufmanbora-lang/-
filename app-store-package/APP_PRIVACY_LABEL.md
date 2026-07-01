# App Privacy answers draft

Use this as a draft for App Store Connect -> App Privacy. Answer honestly based on your final hosting, email provider, analytics, and database setup.

## Data collected

### Contact Info

- Email Address: collected, linked to user identity.
- Purpose: app functionality, account management, authentication, security, user support.

### User Content

- Photos or Videos: collected when users upload photos.
- Audio Data: collected when users send voice messages or use calls.
- Customer Support: collected if users contact support or submit reports.
- Other User Content: messages, files, reactions, polls, tasks, events, profile bio.
- Purpose: app functionality, user-generated content, moderation, safety.

### Identifiers

- User ID: internal account ID, linked to user identity.
- Device ID: push subscription endpoint may identify a device for notifications.
- Purpose: app functionality, notifications, fraud prevention, security.

### Usage Data

- Product Interaction: security events, session timestamps, message timestamps.
- Purpose: app functionality, security, fraud prevention.

### Diagnostics

- Crash Data: not collected by this project unless you add a crash tool.
- Performance Data: not collected by this project unless you add analytics.

## Tracking

Suggested answer: No, the app does not track users across apps and websites owned by other companies.

## Data linked to user

Email, profile, messages, files, contacts, reports, blocks, sessions, and push subscription data are linked to the account.

## Data used for advertising

Suggested answer: No.

## Data deletion

Users can delete their account inside the app: Security -> Delete my account.

## Third-party processors

List your actual providers before submission, for example:

- Render for hosting.
- PostgreSQL provider for database storage.
- SMTP or Resend for email delivery.
- Apple Push Notification service / browser push provider for push delivery.
