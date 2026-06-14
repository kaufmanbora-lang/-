const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const root = __dirname;

function runNodeCheck(file) {
  const result = spawnSync(process.execPath, ["--check", path.join(root, file)], {
    encoding: "utf8"
  });
  if (result.status !== 0) {
    throw new Error(`${file} syntax failed:\n${result.stderr || result.stdout}`);
  }
}

function checkManifest() {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
  if (manifest.display !== "standalone") throw new Error("manifest.display must be standalone.");
  if (!Array.isArray(manifest.icons) || manifest.icons.length < 5) throw new Error("manifest.icons must include PNG and SVG icons.");
  for (const icon of manifest.icons) {
    const iconPath = path.join(root, icon.src.replace(/^\//, ""));
    if (!fs.existsSync(iconPath)) throw new Error(`Missing icon file: ${icon.src}`);
  }
}

function checkClientScript() {
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const script = html.match(/<script>([\s\S]*)<\/script>/);
  if (!script) throw new Error("index.html script block not found.");
  if (!html.includes('id="copyAppLinkButton"')) throw new Error("Notification panel must include copyAppLinkButton.");
  if (!html.includes('id="audioCallButton"')) throw new Error("Chat header must include audioCallButton.");
  if (!html.includes('id="securityButton"')) throw new Error("Chat header must include securityButton.");
  if (!html.includes('id="securityPanel"')) throw new Error("Security panel must exist.");
  if (html.includes('id="peopleTab"')) throw new Error("People tab must be removed; people should be found only through search.");
  if (!html.includes('id="profileEmail"')) throw new Error("Profile must include email change input.");
  if (!html.includes('id="adminLoginForm"')) throw new Error("Auth must include adminLoginForm.");
  if (!html.includes('id="adminPassword"')) throw new Error("Auth must include adminPassword.");
  if (!html.includes('id="viewProfileAdminBlock"')) throw new Error("User profile must include admin block button.");
  if (!html.includes('id="sendVerificationButton"')) throw new Error("Profile must include send verification button.");
  if (!html.includes('id="resetRequestForm"')) throw new Error("Auth must include password reset request form.");
  if (!html.includes('id="replyBar"')) throw new Error("Composer must include reply bar.");
  if (!html.includes('id="voiceRecordingStatus"')) throw new Error("Composer must include voice recording status bar.");
  if (!html.includes('id="cancelVoiceButton"')) throw new Error("Composer must include voice recording cancel button.");
  if (!html.includes('id="roomPanel"')) throw new Error("Room info panel must exist.");
  if (!html.includes('id="mediaPanel"')) throw new Error("Media panel must exist.");
  if (!html.includes('id="viewProfileBlock"')) throw new Error("User profile must include block button.");
  if (!html.includes("function runPeopleSearch(")) throw new Error("index.html must search people through the API.");
  if (!html.includes('id="copyCallInviteButton"')) throw new Error("Call panel must include copyCallInviteButton.");
  if (!html.includes("function queueIceCandidate(")) throw new Error("index.html must include call ICE queue.");
  if (!html.includes("function startAudioCall(")) throw new Error("index.html must include audio call flow.");
  if (!html.includes("function supportedRecorderMime(")) throw new Error("index.html must choose supported voice recorder MIME.");
  if (!html.includes("function normalizeMimeType(")) throw new Error("index.html must normalize upload MIME types.");
  if (!html.includes("function voiceMimeForUpload(")) throw new Error("index.html must normalize browser voice MIME quirks.");
  if (!html.includes("durationSec")) throw new Error("index.html must keep voice message duration metadata.");
  if (!html.includes("video/webm")) throw new Error("index.html must handle browsers that record audio as video/webm.");
  if (!html.includes('id="savedFilterButton"')) throw new Error("Chat tools must include savedFilterButton.");
  if (!html.includes('id="favoriteRoomButton"')) throw new Error("Chat header must include favoriteRoomButton.");
  if (!html.includes("function saveMessage(")) throw new Error("index.html must include saved-message flow.");
  if (!html.includes("function toggleFavoriteRoom(")) throw new Error("index.html must include favorite-room flow.");
  if (!html.includes("function draftForRoom(")) throw new Error("index.html must include per-room drafts.");
  if (!html.includes("function copyMessageText(")) throw new Error("index.html must include message text copy.");
  if (!html.includes("function copyMessageLink(")) throw new Error("index.html must include message deep-link copy.");
  if (!html.includes("function toggleAdminBlockUser(")) throw new Error("index.html must include admin block flow.");
  if (!html.includes("/api/admin-login")) throw new Error("index.html must include admin login API call.");
  if (!html.includes("/api/admin/block")) throw new Error("index.html must include admin block API call.");
  if (!html.includes("initialMessageId")) throw new Error("index.html must support message deep links.");
  if (!html.includes("function copyAppLink()")) throw new Error("index.html must include copyAppLink().");
  if (!html.includes("/api/push-test")) throw new Error("index.html must include push test flow.");
  if (html.includes("/api/events?token=")) throw new Error("EventSource must not put the auth token in the URL.");
  if (html.includes("localStorage.setItem(\"orbit-token\"")) throw new Error("New sessions must not store auth tokens in localStorage.");
  if (!html.includes("/api/security")) throw new Error("index.html must include security center API calls.");
  new Function(script[1]);
}

function checkPackageAndRenderConfig() {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  if (pkg.version !== "1.4.3") throw new Error("package.json version must be 1.4.3.");
  if (!pkg.dependencies?.nodemailer) throw new Error("package.json must include nodemailer for SMTP verification emails.");
  if (!pkg.dependencies?.pg) throw new Error("package.json must include pg for optional PostgreSQL storage.");
  if (pkg.scripts?.check !== "node qa-check.js") throw new Error("package.json check script must run qa-check.js.");
  if (!fs.existsSync(path.join(root, "PHONE_PUSH_GUIDE.md"))) throw new Error("PHONE_PUSH_GUIDE.md is missing.");
  if (!fs.existsSync(path.join(root, "SECURITY.md"))) throw new Error("SECURITY.md is missing.");
  const renderYaml = fs.readFileSync(path.join(root, "render.yaml"), "utf8");
  if (!renderYaml.includes("healthCheckPath: /api/health")) throw new Error("render.yaml must include healthCheckPath: /api/health.");
  if (renderYaml.includes("disk:")) throw new Error("render.yaml should not require Render Disk by default.");
  const server = fs.readFileSync(path.join(root, "server.js"), "utf8");
  if (!server.includes("callInvites")) throw new Error("server.js must include stored call invites.");
  if (!server.includes("normalizeMimeType")) throw new Error("server.js must normalize MIME types with parameters.");
  if (!server.includes("falling back")) throw new Error("server.js must include DATA_DIR fallback for Render startup.");
  if (!server.includes("STATIC_FILES")) throw new Error("server.js must lock static files to an allowlist.");
  if (server.includes('"access-control-allow-origin": "*"')) throw new Error("server.js must not allow wildcard CORS.");
  if (!server.includes("validatePasswordStrength")) throw new Error("server.js must validate password strength.");
  if (!server.includes("LOGIN_FAIL_LIMIT")) throw new Error("server.js must lock repeated login failures.");
  if (!server.includes("SESSION_COOKIE")) throw new Error("server.js must support HttpOnly session cookies.");
  if (!server.includes("canAccessUpload")) throw new Error("server.js must authorize uploaded files.");
  if (!server.includes("sniffMime")) throw new Error("server.js must verify uploaded file signatures.");
  if (!server.includes("audio/aac")) throw new Error("server.js must support AAC voice-message uploads.");
  if (!server.includes("normalizedVoiceMime")) throw new Error("server.js must normalize phone/browser voice MIME quirks.");
  if (!server.includes("uploadDuration")) throw new Error("server.js must preserve voice message duration metadata.");
  if (!server.includes("/api/messages/save")) throw new Error("server.js must include saved-message endpoint.");
  if (!server.includes("/api/rooms/favorite")) throw new Error("server.js must include favorite-room endpoint.");
  if (!server.includes("/api/admin-login")) throw new Error("server.js must include admin login endpoint.");
  if (!server.includes("/api/admin/block")) throw new Error("server.js must include admin block endpoint.");
  if (!server.includes("ADMIN_LOGIN_PASSWORD")) throw new Error("server.js must include admin login password support.");
  if (!server.includes("isSystemAdmin")) throw new Error("server.js must include system admin account support.");
  if (!server.includes("bannedAt")) throw new Error("server.js must include account ban support.");
  if (!server.includes("savedMessageIds")) throw new Error("server.js must persist saved message ids.");
  if (!server.includes("favoriteRoomIds")) throw new Error("server.js must persist favorite room ids.");
  if (!server.includes("schemaVersion: 7")) throw new Error("server.js schemaVersion must be 7.");
  if (!server.includes("content-security-policy")) throw new Error("server.js must send a content security policy.");
  if (!server.includes("if (status >= 500) console.error(error);")) throw new Error("server.js must avoid stack traces for normal 4xx client errors.");
  if (!server.includes("/api/security/revoke-other-sessions")) throw new Error("server.js must include session revocation.");
  if (!server.includes("/api/email/verify")) throw new Error("server.js must include email verification endpoint.");
  if (!server.includes("/api/email/send-verification")) throw new Error("server.js must include resend verification endpoint.");
  if (!server.includes("/api/password/request-reset")) throw new Error("server.js must include password reset request endpoint.");
  if (!server.includes("/api/blocks")) throw new Error("server.js must include user blocking endpoint.");
  if (!server.includes("/api/groups/manage")) throw new Error("server.js must include group management endpoint.");
  if (!server.includes("DATABASE_URL")) throw new Error("server.js must support DATABASE_URL PostgreSQL storage.");
  if (!server.includes("POSTGRES_UPLOADS_TABLE")) throw new Error("server.js must support PostgreSQL upload storage.");
  if (!server.includes("visibleUsersFor")) throw new Error("server.js must avoid sending the full user directory to every client.");
  if (!server.includes("requesterIp")) throw new Error("server.js must track request IPs for security events.");
}

runNodeCheck("server.js");
runNodeCheck("sw.js");
checkManifest();
checkClientScript();
checkPackageAndRenderConfig();

console.log("Orbit Chat QA check passed.");
