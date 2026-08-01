const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const root = __dirname;
const port = 19000 + Math.floor(Math.random() * 1000);
const origin = `http://127.0.0.1:${port}`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "orbit-security-"));
const adminPassword = "Orbit-Admin-Test-9f4b27c1!";
let child = null;

function cookieFrom(response) {
  const values = typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : [response.headers.get("set-cookie") || ""];
  return values
    .map((value) => value.split(";", 1)[0])
    .filter(Boolean)
    .join("; ");
}

async function request(pathname, { method = "GET", cookie = "", csrf = "", body, requestOrigin = origin } = {}) {
  const headers = {};
  if (cookie) headers.cookie = cookie;
  if (csrf) headers["x-orbit-csrf"] = csrf;
  if (requestOrigin) headers.origin = requestOrigin;
  if (body !== undefined) headers["content-type"] = "application/json";
  const response = await fetch(`${origin}${pathname}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const payload = await response.json().catch(() => null);
  return { response, payload };
}

async function waitForServer() {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${origin}/api/health`);
      if (response.ok) return response;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  throw new Error("Security test server did not start.");
}

async function run() {
  const source = fs.readFileSync(path.join(root, "server.js"), "utf8");
  assert(!source.includes('["123", "487"]'), "Source still contains the legacy admin password.");
  assert(!source.includes("db.users[0]?.id === user.id"), "First user can still become admin implicitly.");

  child = spawn(process.execPath, [path.join(root, "server.js")], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(port),
      DATA_DIR: dataDir,
      DATA_FILE: path.join(dataDir, "orbit-chat-data.json"),
      ADMIN_LOGIN_PASSWORD: adminPassword,
      ADMIN_LOGIN_EMAIL: "security-admin@orbit.test",
      SESSION_SECRET: "a".repeat(64),
      PUBLIC_APP_URL: origin,
      NODE_ENV: "test"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let childError = "";
  child.stderr.on("data", (chunk) => { childError += chunk.toString(); });

  const health = await waitForServer();
  const healthPayload = await health.json();
  assert.strictEqual(health.headers.get("x-frame-options"), "DENY");
  assert.strictEqual(health.headers.get("x-content-type-options"), "nosniff");
  assert(health.headers.get("content-security-policy")?.includes("object-src 'none'"));
  assert.strictEqual(healthPayload.ok, true);
  assert(!Object.prototype.hasOwnProperty.call(healthPayload, "dataDir"), "Health endpoint leaked the storage path.");
  assert(!Object.prototype.hasOwnProperty.call(healthPayload, "postgresConfigured"), "Health endpoint leaked database configuration.");

  const malformedCookie = await fetch(`${origin}/api/me`, {
    headers: { cookie: "orbit_session=%E0%A4%A" }
  });
  assert.strictEqual(malformedCookie.status, 401, "Malformed cookie caused an unexpected server response.");

  const registration = await request("/api/register", {
    method: "POST",
    body: {
      email: "security-user@orbit.test",
      nickname: "security-user",
      password: "Safe-user-password-2048",
      legalAccepted: true
    }
  });
  assert.strictEqual(registration.response.status, 201, JSON.stringify(registration.payload));
  assert(!Object.prototype.hasOwnProperty.call(registration.payload, "token"), "Raw token leaked in registration JSON.");
  assert(registration.payload.csrfToken, "Registration did not return a CSRF token.");
  const userCookie = cookieFrom(registration.response);
  const setCookie = registration.response.headers.get("set-cookie") || "";
  assert(/HttpOnly/i.test(setCookie));
  assert(/SameSite=Strict/i.test(setCookie));

  const me = await request("/api/me", { cookie: userCookie });
  assert.strictEqual(me.response.status, 200);
  assert(me.payload.csrfToken);
  const csrf = me.payload.csrfToken;
  const userId = me.payload.user.id;

  const missingCsrf = await request("/api/contacts", {
    method: "POST",
    cookie: userCookie,
    body: { userId, action: "add" }
  });
  assert.strictEqual(missingCsrf.response.status, 403, "Mutation without CSRF was accepted.");

  const forgedOrigin = await request("/api/contacts", {
    method: "POST",
    cookie: userCookie,
    csrf,
    requestOrigin: "https://attacker.example",
    body: { userId, action: "add" }
  });
  assert.strictEqual(forgedOrigin.response.status, 403, "Cross-origin mutation was accepted.");

  const privilegeEscalation = await request("/api/admin/ot/grant", {
    method: "POST",
    cookie: userCookie,
    csrf,
    body: { userId, amount: 1000 }
  });
  assert.strictEqual(privilegeEscalation.response.status, 403, "Regular user reached an admin endpoint.");

  const fakeAvatar = await request("/api/profile", {
    method: "POST",
    cookie: userCookie,
    csrf,
    body: {
      avatar: {
        name: "avatar.png",
        mimeType: "image/png",
        data: `data:image/png;base64,${Buffer.from("<svg><script>alert(1)</script></svg>").toString("base64")}`
      }
    }
  });
  assert.strictEqual(fakeAvatar.response.status, 400, "Fake image upload was accepted.");

  const hiddenFile = await fetch(`${origin}/server.js`);
  assert.strictEqual(hiddenFile.status, 404, "Private server source is publicly readable.");

  const badAdmin = await request("/api/admin-login", {
    method: "POST",
    body: { adminPassword: "wrong-admin-password" }
  });
  assert.strictEqual(badAdmin.response.status, 401);

  const adminLogin = await request("/api/admin-login", {
    method: "POST",
    body: { adminPassword }
  });
  assert.strictEqual(adminLogin.response.status, 200, `${JSON.stringify(adminLogin.payload)}\n${childError}`);
  assert(!Object.prototype.hasOwnProperty.call(adminLogin.payload, "token"), "Raw admin token leaked in JSON.");
  const adminCookie = cookieFrom(adminLogin.response);
  const adminCsrf = adminLogin.payload.csrfToken;
  const grant = await request("/api/admin/ot/grant", {
    method: "POST",
    cookie: adminCookie,
    csrf: adminCsrf,
    body: { userId, amount: 50, note: "security test" }
  });
  assert.strictEqual(grant.response.status, 200, JSON.stringify(grant.payload));

  const dataFile = path.join(dataDir, "orbit-chat-data.json");
  const persisted = JSON.parse(fs.readFileSync(dataFile, "utf8"));
  assert(persisted.sessions.length >= 2);
  assert(persisted.sessions.every((session) => session.tokenHash && !session.token), "A raw session token was persisted.");
  assert(persisted.users.every((user) => user.passwordAlgorithm === "scrypt-v1"), "A new password was not stored with scrypt.");
  assert(persisted.users.filter((user) => user.isSystemAdmin).length === 1, "Unexpected admin account count.");

  console.log("Orbit Chat security check passed.");
}

run()
  .catch((error) => {
    console.error(error.stack || error);
    process.exitCode = 1;
  })
  .finally(() => {
    if (child && !child.killed) child.kill();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
