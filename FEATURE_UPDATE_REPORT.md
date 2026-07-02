# Orbit Chat Feature Update Report

Date: 2026-06-13
Version: 1.4.2

## Added

- Saved messages with a per-chat `★` filter.
- Account-synced favorite chats with a star button in the chat header.
- Favorite chats are sorted above normal chats.
- Per-room local drafts, so unfinished text is restored when returning to a chat.
- Copy message text or attached-file link.
- Copy deep link to a specific message.
- Deep links open the room and highlight the target message.

## Server Changes

- Data schema upgraded to `6`.
- Added `favoriteRoomIds` to the current user profile.
- Added `/api/rooms/favorite`.
- Added `/api/messages/save`.
- Saved messages are private per user.

## QA Passed

- `node --check server.js`
- `node --check sw.js`
- `node qa-check.js`
- Deep API QA for register, health version, messages, saved messages, saved filter, favorite chats.
- Served HTML smoke test.
- DOM id duplicate audit.

## Browser QA Note

The in-app Browser runtime was blocked by this local Windows environment with `CreateProcessAsUserW failed: 5`, so visual Browser automation could not run here. Server, syntax, API, and static frontend checks passed.
