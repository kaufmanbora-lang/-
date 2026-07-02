# Orbit Chat Voice Update Report

Date: 2026-06-13
Version: 1.4.1

## Fixed

- Voice recordings now handle browser MIME quirks from desktop and phones.
- If a browser records audio as `video/webm`, `video/mp4`, or `application/octet-stream`, the server checks the file signature and stores it as a normal audio attachment when the upload is marked as `intent: voice`.
- Voice messages now preserve `durationSec`.
- Voice recording now has a visible recording bar, live timer, cancel button, and Escape-to-cancel support.
- Recording cleanup now stops microphone tracks and timers more reliably.

## Extra Features

- Recording timer in the composer.
- Cancel voice recording without sending a broken/empty file.
- Voice duration shown in preview.
- Voice duration shown on sent messages.
- Better mobile compatibility for Android/Chrome/Safari recording containers.

## QA

Passed:

- `node --check server.js`
- `node --check sw.js`
- `node qa-check.js`
- Static frontend audit: 131 DOM ids, 130 JavaScript DOM references, 0 missing ids.
- Voice API test: 28 checks, 0 failed.

Voice formats tested:

- `audio/wav`
- `video/webm` normalized to `audio/webm`
- `application/octet-stream` normalized to `audio/webm`
- `video/mp4` normalized to `audio/mp4`

Security check:

- `video/webm` without `intent: voice` is still rejected.
- Voice upload links still require authorization.

Browser visual QA note:

- The in-app Browser runtime was blocked by the local Windows environment with `CreateProcessAsUserW failed: 5`.
- Playwright fallback is not installed in this project, so screenshot-based browser QA was not available in this environment.
