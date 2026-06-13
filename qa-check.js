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
  if (!html.includes('id="copyCallInviteButton"')) throw new Error("Call panel must include copyCallInviteButton.");
  if (!html.includes("function queueIceCandidate(")) throw new Error("index.html must include call ICE queue.");
  if (!html.includes("function startAudioCall(")) throw new Error("index.html must include audio call flow.");
  if (!html.includes("function supportedRecorderMime(")) throw new Error("index.html must choose supported voice recorder MIME.");
  if (!html.includes("function normalizeMimeType(")) throw new Error("index.html must normalize upload MIME types.");
  if (!html.includes("function copyAppLink()")) throw new Error("index.html must include copyAppLink().");
  if (!html.includes("/api/push-test")) throw new Error("index.html must include push test flow.");
  if (html.includes("/api/events?token=")) throw new Error("EventSource must not put the auth token in the URL.");
  if (html.includes("localStorage.setItem(\"orbit-token\"")) throw new Error("New sessions must not store auth tokens in localStorage.");
  if (!html.includes("/api/security")) throw new Error("index.html must include security center API calls.");
  new Function(script[1]);
}

function checkPackageAndRenderConfig() {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  if (pkg.version !== "1.2.0") throw new Error("package.json version must be 1.2.0.");
  if (pkg.scripts?.check !== "node qa-check.js") throw new Error("package.json check script must run qa-check.js.");
  if (!fs.existsSync(path.join(root, "PHONE_PUSH_GUIDE.md"))) throw new Error("PHONE_PUSH_GUIDE.md is missing.");
  if (!fs.existsSync(path.join(root, "SECURITY.md"))) throw new Error("SECURITY.md is missing.");
  const renderYaml = fs.readFileSync(path.join(root, "render.yaml"), "utf8");
  if (!renderYaml.includes("healthCheckPath: /api/health")) throw new Error("render.yaml must include healthCheckPath: /api/health.");
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
  if (!server.includes("content-security-policy")) throw new Error("server.js must send a content security policy.");
  if (!server.includes("/api/security/revoke-other-sessions")) throw new Error("server.js must include session revocation.");
  if (!server.includes("requesterIp")) throw new Error("server.js must track request IPs for security events.");
}

runNodeCheck("server.js");
runNodeCheck("sw.js");
checkManifest();
checkClientScript();
checkPackageAndRenderConfig();

console.log("Orbit Chat QA check passed.");
