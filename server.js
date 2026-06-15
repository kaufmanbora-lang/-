const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { version: APP_VERSION } = require("./package.json");
let webPush = null;
let nodemailer = null;
let PgPool = null;

try {
  webPush = require("web-push");
} catch {
  webPush = null;
}

try {
  nodemailer = require("nodemailer");
} catch {
  nodemailer = null;
}

try {
  ({ Pool: PgPool } = require("pg"));
} catch {
  PgPool = null;
}

const PORT = Number(process.env.PORT || 8790);
let DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
let DATA_FILE = process.env.DATA_FILE || path.join(DATA_DIR, "orbit-chat-data.json");
let UPLOAD_DIR = path.join(DATA_DIR, "uploads");
const SESSION_DAYS = 14;
const MAX_BODY = 40 * 1024 * 1024;
const MAX_MESSAGES = 12000;
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_AVATAR_BYTES = 8 * 1024 * 1024;
const PASSWORD_ITERATIONS = 310000;
const MIN_PASSWORD_LENGTH = 10;
const LOGIN_FAIL_LIMIT = 6;
const LOGIN_LOCK_MS = 15 * 60 * 1000;
const SESSION_COOKIE = "orbit_session";
const EMAIL_VERIFICATION_HOURS = 24;
const EMAIL_CODE_MINUTES = 10;
const EMAIL_CODE_MAX_ATTEMPTS = 7;
const PASSWORD_RESET_HOURS = 1;
const DEFAULT_ADMIN_LOGIN_PASSWORD = ["123", "487"].join("");
const ADMIN_LOGIN_PASSWORD = String(process.env.ADMIN_LOGIN_PASSWORD || DEFAULT_ADMIN_LOGIN_PASSWORD);
const ADMIN_LOGIN_EMAIL = normalizeEmail(process.env.ADMIN_LOGIN_EMAIL || "admin@orbit.local");
const ADMIN_LOGIN_NICKNAME = process.env.ADMIN_LOGIN_NICKNAME || "Администратор";
let SESSION_SECRET = process.env.SESSION_SECRET || "";
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || "mailto:orbit-chat@example.com";
const MAIL_FROM = process.env.MAIL_FROM || process.env.SMTP_FROM || "Orbit Chat <no-reply@orbit-chat.local>";
const ALLOWED_REACTIONS = new Set(["👍", "❤️", "😂", "🔥", "😮", "😢"]);
const POSTGRES_STATE_ID = "main";
const POSTGRES_STATE_TABLE = "orbit_chat_state";
const POSTGRES_UPLOADS_TABLE = "orbit_chat_uploads";
let pgPool = null;
let postgresReady = false;
let postgresSaveTimer = null;
const STATIC_FILES = new Set([
  "/index.html",
  "/manifest.json",
  "/sw.js",
  "/icon.svg",
  "/icon-192.png",
  "/icon-512.png",
  "/maskable-icon.svg",
  "/maskable-icon-512.png",
  "/privacy.html",
  "/support.html",
  "/terms.html",
  "/community-guidelines.html"
]);
const MIME_EXT = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/aac": "aac",
  "audio/x-m4a": "m4a",
  "audio/wav": "wav",
  "audio/wave": "wav",
  "audio/x-wav": "wav",
  "application/pdf": "pdf",
  "text/plain": "txt",
  "application/zip": "zip",
  "application/x-zip-compressed": "zip",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx"
};
const ALLOWED_IMAGE_MIME = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);
const ALLOWED_UPLOAD_MIME = new Set(Object.keys(MIME_EXT));

const clients = new Map();
const rateBuckets = new Map();
const loginFailures = new Map();
const SECURITY_HEADERS = {
  "content-security-policy": "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; img-src 'self' data: blob:; media-src 'self' data: blob:; connect-src 'self'; worker-src 'self'; manifest-src 'self'; form-action 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'",
  "cross-origin-opener-policy": "same-origin",
  "cross-origin-resource-policy": "same-origin",
  "strict-transport-security": "max-age=31536000; includeSubDomains",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer",
  "permissions-policy": "camera=(self), microphone=(self), geolocation=()"
};

function now() {
  return Date.now();
}

function uid(prefix) {
  return `${prefix}_${crypto.randomBytes(12).toString("hex")}`;
}

function safeJson(value) {
  return JSON.stringify(value).replace(/[<>&]/g, (char) => ({
    "<": "\\u003c",
    ">": "\\u003e",
    "&": "\\u0026"
  }[char]));
}

function freshStore() {
  return {
    schemaVersion: 8,
    users: [],
    sessions: [],
    messages: [],
    scheduledMessages: [],
    groups: [],
    polls: [],
    roomTasks: [],
    roomEvents: [],
    roomPins: {},
    callInvites: [],
    pushSubscriptions: [],
    emailCodes: [],
    vapidKeys: null,
    reports: [],
    security: {},
    securityEvents: [],
    createdAt: new Date().toISOString()
  };
}

function normalizeStore(parsed) {
  const store = parsed && typeof parsed === "object" ? parsed : freshStore();
  store.schemaVersion = Math.max(Number(store.schemaVersion || 0), 8);
  store.users ||= [];
  store.sessions ||= [];
  store.messages ||= [];
  store.scheduledMessages ||= [];
  store.groups ||= [];
  store.polls ||= [];
  store.roomTasks ||= [];
  store.roomEvents ||= [];
  store.roomPins ||= {};
  store.callInvites ||= [];
  store.pushSubscriptions ||= [];
  store.emailCodes ||= [];
  store.reports ||= [];
  store.security ||= {};
  store.securityEvents ||= [];
  for (const user of store.users) {
    user.contactIds ||= [];
    user.blockedUserIds ||= [];
    user.savedMessageIds ||= [];
    user.favoriteRoomIds ||= [];
    user.mutedRoomIds ||= [];
    user.isSystemAdmin = Boolean(user.isSystemAdmin);
    user.bannedAt ||= 0;
    user.bannedBy ||= "";
    user.banReason ||= "";
    user.banVersion = Number(user.banVersion || 0);
    if (typeof user.emailVerified !== "boolean") user.emailVerified = true;
    user.pendingEmail ||= "";
    user.passwordResetHash ||= "";
    user.passwordResetExpiresAt ||= 0;
    user.passwordResetSentAt ||= 0;
  }
  const currentTime = now();
  store.emailCodes = store.emailCodes
    .filter((item) => item && typeof item === "object")
    .map((item) => ({
      id: item.id || uid("code"),
      email: normalizeEmail(item.email),
      purpose: item.purpose === "change" ? "change" : "register",
      userId: String(item.userId || ""),
      nickname: cleanText(item.nickname || "", 24),
      passwordSalt: String(item.passwordSalt || ""),
      passwordHash: String(item.passwordHash || ""),
      passwordIterations: Number(item.passwordIterations || PASSWORD_ITERATIONS),
      codeHash: String(item.codeHash || ""),
      expiresAt: Number(item.expiresAt || 0),
      createdAt: Number(item.createdAt || currentTime),
      attempts: Number(item.attempts || 0),
      ip: String(item.ip || "")
    }))
    .filter((item) => item.email && item.codeHash && item.expiresAt > currentTime && item.attempts < EMAIL_CODE_MAX_ATTEMPTS);
  for (const group of store.groups) {
    group.memberIds ||= [];
    group.ownerId ||= group.memberIds[0] || "";
    group.adminIds = Array.from(new Set([group.ownerId, ...(group.adminIds || [])].filter(Boolean)));
  }
  for (const message of store.messages) {
    message.attachments ||= [];
    message.reactions ||= {};
    message.readBy ||= [];
    message.replyToId ||= "";
    message.forwardedFrom ||= null;
  }
  store.scheduledMessages = store.scheduledMessages
    .filter((item) => item && typeof item === "object")
    .map((item) => ({
      id: item.id || uid("schedule"),
      roomId: String(item.roomId || ""),
      senderId: String(item.senderId || ""),
      text: cleanText(item.text || "", 1200),
      sendAt: Number(item.sendAt || 0),
      createdAt: Number(item.createdAt || now())
    }))
    .filter((item) => item.roomId && item.senderId && item.text && item.sendAt > now() - 60 * 60 * 1000);
  for (const poll of store.polls) {
    poll.options = Array.isArray(poll.options) ? poll.options : [];
    poll.votes = poll.votes && typeof poll.votes === "object" ? poll.votes : {};
    poll.closed = Boolean(poll.closed);
  }
  for (const task of store.roomTasks) {
    task.status = ["todo", "doing", "done"].includes(task.status) ? task.status : "todo";
    task.priority = ["low", "normal", "high"].includes(task.priority) ? task.priority : "normal";
    task.assigneeId ||= "";
    task.details ||= "";
    task.completedAt ||= 0;
  }
  for (const event of store.roomEvents) {
    event.rsvps = event.rsvps && typeof event.rsvps === "object" ? event.rsvps : {};
    event.location ||= "";
    event.details ||= "";
    event.cancelled = Boolean(event.cancelled);
  }
  for (const session of store.sessions) {
    session.banVersion = Number(session.banVersion || 0);
  }
  return store;
}

function ensureStore() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  } catch (error) {
    if (process.env.DATA_DIR && !process.env.DATA_FILE) {
      const fallback = path.join(__dirname, "data");
      console.warn(`DATA_DIR ${DATA_DIR} is not writable, falling back to ${fallback}: ${error.message}`);
      DATA_DIR = fallback;
      DATA_FILE = path.join(DATA_DIR, "orbit-chat-data.json");
      UPLOAD_DIR = path.join(DATA_DIR, "uploads");
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    } else {
      throw error;
    }
  }
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(freshStore(), null, 2));
  }
}

function loadStore() {
  ensureStore();
  try {
    return normalizeStore(JSON.parse(fs.readFileSync(DATA_FILE, "utf8")));
  } catch (error) {
    const backup = `${DATA_FILE}.broken-${Date.now()}`;
    if (fs.existsSync(DATA_FILE)) fs.copyFileSync(DATA_FILE, backup);
    const fresh = freshStore();
    fs.writeFileSync(DATA_FILE, JSON.stringify(fresh, null, 2));
    return fresh;
  }
}

let db = loadStore();

async function initPostgresStore() {
  if (!process.env.DATABASE_URL) return;
  if (!PgPool) {
    console.warn("DATABASE_URL is set, but pg is not installed. Falling back to JSON storage.");
    return;
  }
  pgPool = new PgPool({
    connectionString: process.env.DATABASE_URL,
    ssl: String(process.env.PGSSL || "").toLowerCase() === "disable" ? false : { rejectUnauthorized: false }
  });
  await pgPool.query(`
    create table if not exists ${POSTGRES_STATE_TABLE} (
      id text primary key,
      data jsonb not null,
      updated_at timestamptz not null default now()
    )
  `);
  await pgPool.query(`
    create table if not exists ${POSTGRES_UPLOADS_TABLE} (
      name text primary key,
      mime text not null,
      data bytea not null,
      created_at timestamptz not null default now()
    )
  `);
  const result = await pgPool.query(`select data from ${POSTGRES_STATE_TABLE} where id = $1`, [POSTGRES_STATE_ID]);
  if (result.rows[0]?.data) {
    db = normalizeStore(result.rows[0].data);
  } else {
    await pgPool.query(
      `insert into ${POSTGRES_STATE_TABLE} (id, data, updated_at) values ($1, $2::jsonb, now())
       on conflict (id) do update set data = excluded.data, updated_at = now()`,
      [POSTGRES_STATE_ID, JSON.stringify(db)]
    );
  }
  postgresReady = true;
}

async function savePostgresStore() {
  if (!postgresReady || !pgPool) return;
  await pgPool.query(
    `insert into ${POSTGRES_STATE_TABLE} (id, data, updated_at) values ($1, $2::jsonb, now())
     on conflict (id) do update set data = excluded.data, updated_at = now()`,
    [POSTGRES_STATE_ID, JSON.stringify(db)]
  );
}

function schedulePostgresSave() {
  if (!postgresReady || !pgPool) return;
  clearTimeout(postgresSaveTimer);
  postgresSaveTimer = setTimeout(() => {
    savePostgresStore().catch((error) => {
      postgresReady = false;
      console.error("PostgreSQL save failed:", error.message);
    });
  }, 150);
}

function queuePostgresUpload(fileName, mimeType, buffer) {
  if (!postgresReady || !pgPool) return;
  pgPool.query(
    `insert into ${POSTGRES_UPLOADS_TABLE} (name, mime, data, created_at) values ($1, $2, $3, now())
     on conflict (name) do update set mime = excluded.mime, data = excluded.data, created_at = now()`,
    [fileName, mimeType, buffer]
  ).catch((error) => {
    console.error("PostgreSQL upload save failed:", error.message);
  });
}

async function loadPostgresUpload(fileName) {
  if (!postgresReady || !pgPool) return null;
  const result = await pgPool.query(`select mime, data from ${POSTGRES_UPLOADS_TABLE} where name = $1`, [fileName]);
  const row = result.rows[0];
  if (!row) return null;
  return { mimeType: row.mime, buffer: Buffer.from(row.data) };
}

function saveStore() {
  const temp = `${DATA_FILE}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(db, null, 2));
  fs.renameSync(temp, DATA_FILE);
  schedulePostgresSave();
}

function recordSecurityEvent(type, userId = "", details = {}) {
  db.securityEvents ||= [];
  db.securityEvents.push({
    id: uid("sec"),
    type,
    userId,
    details,
    createdAt: now()
  });
  db.securityEvents = db.securityEvents.slice(-500);
}

function initSecurityState() {
  db.security ||= {};
  if (!SESSION_SECRET) {
    if (!db.security.sessionSecret) {
      db.security.sessionSecret = crypto.randomBytes(32).toString("hex");
      recordSecurityEvent("session-secret-created");
    }
    SESSION_SECRET = db.security.sessionSecret;
  }
  db.security.passwordIterations = PASSWORD_ITERATIONS;
  saveStore();
}

function initWebPush() {
  if (!webPush) return;
  if (!db.vapidKeys?.publicKey || !db.vapidKeys?.privateKey) {
    db.vapidKeys = webPush.generateVAPIDKeys();
    saveStore();
  }
  webPush.setVapidDetails(VAPID_SUBJECT, db.vapidKeys.publicKey, db.vapidKeys.privateKey);
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function cleanText(text, max = 1000) {
  return String(text || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function validateEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function tokenHash(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

function publicBaseUrl(req) {
  const configured = String(process.env.PUBLIC_APP_URL || "").trim().replace(/\/+$/, "");
  if (configured) return configured;
  const proto = req.headers["x-forwarded-proto"] || (isHttpsRequest(req) ? "https" : "http");
  const host = String(req.headers.host || `127.0.0.1:${PORT}`).replace(/[^\w.:\-]/g, "");
  return `${proto}://${host}`;
}

function makeEmailVerification(user, email, purpose = "verify") {
  const token = crypto.randomBytes(32).toString("hex");
  user.emailVerificationHash = tokenHash(token);
  user.emailVerificationEmail = normalizeEmail(email);
  user.emailVerificationPurpose = purpose;
  user.emailVerificationExpiresAt = now() + EMAIL_VERIFICATION_HOURS * 60 * 60 * 1000;
  user.emailVerificationSentAt = now();
  return token;
}

function mailConfigured() {
  return Boolean(process.env.RESEND_API_KEY || (process.env.SMTP_HOST && nodemailer));
}

async function sendMail({ to, subject, text, html }) {
  if (process.env.RESEND_API_KEY) {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        from: MAIL_FROM,
        to: [to],
        subject,
        text,
        html
      })
    });
    if (!response.ok) throw new Error(`Resend email failed: ${response.status}`);
    return { provider: "resend" };
  }
  if (process.env.SMTP_HOST && nodemailer) {
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: String(process.env.SMTP_SECURE || "").toLowerCase() === "true",
      auth: process.env.SMTP_USER ? {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS || ""
      } : undefined
    });
    await transporter.sendMail({ from: MAIL_FROM, to, subject, text, html });
    return { provider: "smtp" };
  }
  return { provider: "none", skipped: true };
}

async function sendVerificationEmail(req, user, email, token, purpose = "verify") {
  const verificationUrl = `${publicBaseUrl(req)}/api/email/verify?token=${encodeURIComponent(token)}`;
  const subject = purpose === "change" ? "Подтверди новую почту Orbit Chat" : "Подтверди почту Orbit Chat";
  const text = [
    "Привет!",
    "",
    purpose === "change" ? "Чтобы поменять почту аккаунта Orbit Chat, открой ссылку:" : "Чтобы подтвердить аккаунт Orbit Chat, открой ссылку:",
    verificationUrl,
    "",
    `Ссылка действует ${EMAIL_VERIFICATION_HOURS} часа.`
  ].join("\n");
  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.5;color:#111">
      <h2>Orbit Chat</h2>
      <p>${purpose === "change" ? "Подтверди новую почту аккаунта." : "Подтверди почту аккаунта."}</p>
      <p><a href="${verificationUrl}" style="display:inline-block;padding:12px 16px;border-radius:10px;background:#111;color:#fff;text-decoration:none">Подтвердить почту</a></p>
      <p>Ссылка действует ${EMAIL_VERIFICATION_HOURS} часа.</p>
    </div>
  `;
  const result = await sendMail({ to: email, subject, text, html });
  recordSecurityEvent("email-verification-sent", user.id, { email, purpose, provider: result.provider, skipped: Boolean(result.skipped) });
  return {
    sent: !result.skipped,
    provider: result.provider,
    needsMailSetup: Boolean(result.skipped),
    devLink: result.skipped && !process.env.RENDER ? verificationUrl : undefined
  };
}

function cleanEmailCodes() {
  const currentTime = now();
  db.emailCodes = (db.emailCodes || []).filter((item) => (
    item
    && item.expiresAt > currentTime
    && Number(item.attempts || 0) < EMAIL_CODE_MAX_ATTEMPTS
  ));
}

function sanitizeEmailCode(code) {
  return String(code || "").replace(/\D/g, "").slice(0, 6);
}

function makeEmailCode() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, "0");
}

function hashEmailCode(email, purpose, code, userId = "") {
  return tokenHash(`${purpose}:${normalizeEmail(email)}:${String(userId || "")}:${sanitizeEmailCode(code)}`);
}

function createEmailCodeChallenge({ email, purpose, userId = "", nickname = "", password = null, ip = "" }) {
  cleanEmailCodes();
  const targetEmail = normalizeEmail(email);
  const code = makeEmailCode();
  const challenge = {
    id: uid("code"),
    email: targetEmail,
    purpose: purpose === "change" ? "change" : "register",
    userId: String(userId || ""),
    nickname: cleanText(nickname || "", 24),
    passwordSalt: "",
    passwordHash: "",
    passwordIterations: PASSWORD_ITERATIONS,
    codeHash: hashEmailCode(targetEmail, purpose, code, userId),
    expiresAt: now() + EMAIL_CODE_MINUTES * 60 * 1000,
    createdAt: now(),
    attempts: 0,
    ip: String(ip || "")
  };
  if (password !== null) {
    const { salt, hash, iterations } = hashPassword(password);
    challenge.passwordSalt = salt;
    challenge.passwordHash = hash;
    challenge.passwordIterations = iterations;
  }
  db.emailCodes = (db.emailCodes || []).filter((item) => !(
    item.email === challenge.email
    && item.purpose === challenge.purpose
    && String(item.userId || "") === challenge.userId
  ));
  db.emailCodes.push(challenge);
  return { code, challenge };
}

function findEmailCodeChallenge({ email, purpose, userId = "" }) {
  cleanEmailCodes();
  const targetEmail = normalizeEmail(email);
  return (db.emailCodes || []).find((item) => (
    item.email === targetEmail
    && item.purpose === (purpose === "change" ? "change" : "register")
    && String(item.userId || "") === String(userId || "")
  ));
}

function verifyEmailCodeChallenge(challenge, code) {
  if (!challenge) return { ok: false, status: 400, message: "Сначала запроси код на почту." };
  if (challenge.expiresAt < now()) return { ok: false, status: 400, message: "Код устарел. Запроси новый код." };
  if (Number(challenge.attempts || 0) >= EMAIL_CODE_MAX_ATTEMPTS) {
    return { ok: false, status: 429, message: "Слишком много неправильных кодов. Запроси новый код." };
  }
  const normalizedCode = sanitizeEmailCode(code);
  if (normalizedCode.length !== 6 || hashEmailCode(challenge.email, challenge.purpose, normalizedCode, challenge.userId) !== challenge.codeHash) {
    challenge.attempts = Number(challenge.attempts || 0) + 1;
    return { ok: false, status: 400, message: "Код неверный. Проверь письмо и попробуй еще раз." };
  }
  return { ok: true };
}

async function sendEmailCode(req, { user = null, email, code, purpose = "register" }) {
  const action = purpose === "change" ? "смены почты" : "регистрации";
  const subject = purpose === "change" ? "Код для новой почты Orbit Chat" : "Код регистрации Orbit Chat";
  const text = [
    "Привет!",
    "",
    `Твой код ${action} в Orbit Chat: ${code}`,
    "",
    `Код действует ${EMAIL_CODE_MINUTES} минут. Никому его не показывай.`
  ].join("\n");
  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.5;color:#111">
      <h2>Orbit Chat</h2>
      <p>Код ${action}:</p>
      <p style="font-size:32px;font-weight:800;letter-spacing:8px;margin:20px 0">${code}</p>
      <p>Код действует ${EMAIL_CODE_MINUTES} минут. Если это был не ты, просто проигнорируй письмо.</p>
    </div>
  `;
  const result = await sendMail({ to: email, subject, text, html });
  recordSecurityEvent("email-code-sent", user?.id || "", {
    email,
    purpose,
    provider: result.provider,
    skipped: Boolean(result.skipped)
  });
  return {
    sent: !result.skipped,
    provider: result.provider,
    needsMailSetup: Boolean(result.skipped),
    expiresInMinutes: EMAIL_CODE_MINUTES,
    devCode: result.skipped && !process.env.RENDER ? code : undefined
  };
}

function makePasswordReset(user) {
  const token = crypto.randomBytes(32).toString("hex");
  user.passwordResetHash = tokenHash(token);
  user.passwordResetExpiresAt = now() + PASSWORD_RESET_HOURS * 60 * 60 * 1000;
  user.passwordResetSentAt = now();
  return token;
}

async function sendPasswordResetEmail(req, user, token) {
  const resetUrl = `${publicBaseUrl(req)}/?reset=${encodeURIComponent(token)}`;
  const subject = "Восстановление пароля Orbit Chat";
  const text = [
    "Привет!",
    "",
    "Чтобы поставить новый пароль Orbit Chat, открой ссылку:",
    resetUrl,
    "",
    `Ссылка действует ${PASSWORD_RESET_HOURS} час. Если это был не ты, просто не открывай её.`
  ].join("\n");
  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.5;color:#111">
      <h2>Orbit Chat</h2>
      <p>Поставь новый пароль для аккаунта.</p>
      <p><a href="${resetUrl}" style="display:inline-block;padding:12px 16px;border-radius:10px;background:#111;color:#fff;text-decoration:none">Сбросить пароль</a></p>
      <p>Ссылка действует ${PASSWORD_RESET_HOURS} час. Если это был не ты, просто не открывай её.</p>
    </div>
  `;
  const result = await sendMail({ to: user.email, subject, text, html });
  recordSecurityEvent("password-reset-sent", user.id, { provider: result.provider, skipped: Boolean(result.skipped) });
  return {
    sent: !result.skipped,
    provider: result.provider,
    needsMailSetup: Boolean(result.skipped),
    devLink: result.skipped && !process.env.RENDER ? resetUrl : undefined
  };
}

function verifyEmailToken(token) {
  const hash = tokenHash(token);
  const user = db.users.find((item) => item.emailVerificationHash === hash);
  if (!user) return { ok: false, message: "Ссылка подтверждения неверная." };
  if (!user.emailVerificationExpiresAt || user.emailVerificationExpiresAt < now()) {
    return { ok: false, message: "Ссылка подтверждения устарела. Запроси новое письмо." };
  }
  const verifiedEmail = normalizeEmail(user.emailVerificationEmail || user.email);
  if (!verifiedEmail || !validateEmail(verifiedEmail)) return { ok: false, message: "Почта в подтверждении неверная." };
  if (db.users.some((item) => item.id !== user.id && item.email === verifiedEmail)) {
    return { ok: false, message: "Эта почта уже занята другим аккаунтом." };
  }
  user.email = verifiedEmail;
  user.pendingEmail = "";
  user.emailVerified = true;
  user.emailVerificationHash = "";
  user.emailVerificationEmail = "";
  user.emailVerificationPurpose = "";
  user.emailVerificationExpiresAt = 0;
  recordSecurityEvent("email-verified", user.id, { email: verifiedEmail });
  saveStore();
  return { ok: true, user, message: "Почта подтверждена." };
}

function avatarColor(seed) {
  const colors = ["#54d6ff", "#9eff8f", "#ffcc66", "#ff7ab6", "#a78bfa", "#72f1b8", "#f59e0b", "#38bdf8"];
  let sum = 0;
  for (const char of seed) sum += char.charCodeAt(0);
  return colors[sum % colors.length];
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex"), iterations = PASSWORD_ITERATIONS) {
  const hash = crypto.pbkdf2Sync(String(password), salt, iterations, 32, "sha256").toString("hex");
  return { salt, hash, iterations };
}

function verifyPassword(password, user) {
  const iterations = Number(user.passwordIterations || 120000);
  const { hash } = hashPassword(password, user.passwordSalt, iterations);
  const a = Buffer.from(hash, "hex");
  const b = Buffer.from(user.passwordHash, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function validatePasswordStrength(password) {
  const value = String(password || "");
  if (value.length < MIN_PASSWORD_LENGTH) return `Пароль должен быть минимум ${MIN_PASSWORD_LENGTH} символов.`;
  if (!/[a-zA-Zа-яА-ЯёЁ]/.test(value)) return "В пароле должна быть хотя бы одна буква.";
  if (!/[0-9]/.test(value)) return "В пароле должна быть хотя бы одна цифра.";
  if (/(.)\1{5,}/.test(value)) return "Пароль слишком простой.";
  return "";
}

function ensureAdminUser() {
  let user = db.users.find((item) => item.isSystemAdmin) || db.users.find((item) => normalizeEmail(item.email) === ADMIN_LOGIN_EMAIL);
  if (!user) {
    const { salt, hash, iterations } = hashPassword(`${ADMIN_LOGIN_PASSWORD}-internal-admin-password`);
    user = {
      id: uid("admin"),
      email: ADMIN_LOGIN_EMAIL,
      nickname: ADMIN_LOGIN_NICKNAME,
      passwordSalt: salt,
      passwordHash: hash,
      passwordIterations: iterations,
      avatarColor: "#ffcc66",
      avatarUrl: "",
      bio: "Служебный аккаунт администратора",
      contactIds: [],
      blockedUserIds: [],
      savedMessageIds: [],
      favoriteRoomIds: [],
      mutedRoomIds: [],
      isSystemAdmin: true,
      bannedAt: 0,
      bannedBy: "",
      banReason: "",
      banVersion: 0,
      emailVerified: true,
      pendingEmail: "",
      lastSeen: now(),
      createdAt: now()
    };
    db.users.unshift(user);
    recordSecurityEvent("system-admin-created", user.id);
    return user;
  }
  user.isSystemAdmin = true;
  user.email = ADMIN_LOGIN_EMAIL;
  user.nickname ||= ADMIN_LOGIN_NICKNAME;
  user.avatarColor ||= "#ffcc66";
  user.bio ||= "Служебный аккаунт администратора";
  user.contactIds ||= [];
  user.blockedUserIds ||= [];
  user.savedMessageIds ||= [];
  user.favoriteRoomIds ||= [];
  user.mutedRoomIds ||= [];
  user.emailVerified = true;
  user.bannedAt = 0;
  user.bannedBy = "";
  user.banReason = "";
  user.banVersion = Number(user.banVersion || 0);
  user.lastSeen = now();
  return user;
}

function userBanMessage(user) {
  const reason = cleanText(user?.banReason || "", 140);
  return reason ? `Аккаунт заблокирован администратором: ${reason}` : "Аккаунт заблокирован администратором.";
}

function upgradePasswordHashIfNeeded(password, user) {
  if (Number(user.passwordIterations || 120000) >= PASSWORD_ITERATIONS) return false;
  const { salt, hash, iterations } = hashPassword(password);
  user.passwordSalt = salt;
  user.passwordHash = hash;
  user.passwordIterations = iterations;
  recordSecurityEvent("password-hash-upgraded", user.id);
  return true;
}

function signToken(raw) {
  return crypto.createHmac("sha256", SESSION_SECRET).update(raw).digest("hex").slice(0, 20);
}

function makeToken() {
  const raw = crypto.randomBytes(24).toString("hex");
  return `${raw}.${signToken(raw)}`;
}

function tokenLooksValid(token) {
  const [raw, sig] = String(token || "").split(".");
  if (!raw || !sig) return false;
  const expected = signToken(raw);
  const a = Buffer.from(expected);
  const b = Buffer.from(sig);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function secretEquals(a, b) {
  const left = Buffer.from(String(a || ""));
  const right = Buffer.from(String(b || ""));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function publicUser(user, includeEmail = false) {
  if (!user) return null;
  return {
    id: user.id,
    email: includeEmail ? user.email : undefined,
    emailVerified: includeEmail ? Boolean(user.emailVerified) : undefined,
    pendingEmail: includeEmail ? (user.pendingEmail || "") : undefined,
    mailConfigured: includeEmail ? mailConfigured() : undefined,
    isAdmin: includeEmail ? isAdmin(user) : undefined,
    isSystemAdmin: includeEmail ? Boolean(user.isSystemAdmin) : undefined,
    isBanned: includeEmail ? Boolean(user.bannedAt) : undefined,
    bannedAt: includeEmail ? (user.bannedAt || 0) : undefined,
    banReason: includeEmail ? (user.banReason || "") : undefined,
    nickname: user.nickname,
    avatarColor: user.avatarColor,
    avatarUrl: user.avatarUrl || "",
    contactIds: includeEmail ? (user.contactIds || []) : undefined,
    blockedUserIds: includeEmail ? (user.blockedUserIds || []) : undefined,
    savedMessageIds: includeEmail ? (user.savedMessageIds || []) : undefined,
    favoriteRoomIds: includeEmail ? (user.favoriteRoomIds || []) : undefined,
    mutedRoomIds: includeEmail ? (user.mutedRoomIds || []) : undefined,
    bio: user.bio || "",
    status: onlineUserIds().has(user.id) ? "online" : "offline",
    lastSeen: user.lastSeen,
    createdAt: user.createdAt
  };
}

function publicUserFor(user, viewer) {
  const data = publicUser(user, viewer?.id === user?.id);
  if (data && viewer && viewer.id !== user.id) {
    data.isContact = (viewer.contactIds || []).includes(user.id);
    data.isBlocked = (viewer.blockedUserIds || []).includes(user.id);
    if (isAdmin(viewer)) {
      data.isAdmin = isAdmin(user);
      data.isSystemAdmin = Boolean(user.isSystemAdmin);
      data.isBanned = Boolean(user.bannedAt);
      data.bannedAt = user.bannedAt || 0;
      data.banReason = user.banReason || "";
    }
  }
  return data;
}

function onlineUserIds() {
  const ids = new Set();
  for (const client of clients.values()) ids.add(client.userId);
  return ids;
}

function userById(userId) {
  return db.users.find((user) => user.id === userId);
}

function isBlockedBy(blockerId, blockedId) {
  const blocker = userById(blockerId);
  return Boolean(blocker && (blocker.blockedUserIds || []).includes(blockedId));
}

function isBlockedBetween(userA, userB) {
  if (!userA || !userB || userA === userB) return false;
  return isBlockedBy(userA, userB) || isBlockedBy(userB, userA);
}

function canSeeMessage(userId, message) {
  if (!message) return false;
  return message.senderId === userId || !isBlockedBetween(userId, message.senderId);
}

function canSendToRoom(userId, roomId) {
  if (!canUseRoom(userId, roomId)) return false;
  if (!String(roomId || "").startsWith("dm:")) return true;
  const otherId = dmParticipants(roomId).find((id) => id !== userId);
  return !isBlockedBetween(userId, otherId);
}

function groupRole(group, userId) {
  if (!group || !userId) return "";
  if (group.ownerId === userId) return "owner";
  if ((group.adminIds || []).includes(userId)) return "admin";
  if ((group.memberIds || []).includes(userId)) return "member";
  return "";
}

function canManageGroup(userId, group) {
  return ["owner", "admin"].includes(groupRole(group, userId));
}

function isAdmin(user) {
  if (user?.isSystemAdmin) return true;
  const configured = String(process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((item) => normalizeEmail(item))
    .filter(Boolean);
  if (configured.length) return configured.includes(normalizeEmail(user?.email));
  return Boolean(user && db.users[0]?.id === user.id);
}

function reactionSummary(message, viewerId = "") {
  const raw = message.reactions || {};
  const counts = new Map();
  for (const emoji of Object.values(raw)) {
    if (!emoji) continue;
    counts.set(emoji, (counts.get(emoji) || 0) + 1);
  }
  return {
    mine: viewerId ? raw[viewerId] || "" : "",
    items: Array.from(counts.entries())
      .map(([emoji, count]) => ({ emoji, count }))
      .sort((a, b) => b.count - a.count || a.emoji.localeCompare(b.emoji))
  };
}

function serializeMessage(message, viewerId = "") {
  const readBy = Array.isArray(message.readBy) ? message.readBy : [];
  const replySource = message.replyToId
    ? db.messages.find((item) => item.id === message.replyToId && item.roomId === message.roomId && !item.deletedAt && (!viewerId || canSeeMessage(viewerId, item)))
    : null;
  return {
    id: message.id,
    roomId: message.roomId,
    senderId: message.senderId,
    sender: publicUser(db.users.find((user) => user.id === message.senderId)),
    text: message.deletedAt ? "" : message.text,
    attachments: message.attachments || [],
    replyToId: message.replyToId || "",
    forwardedFrom: message.forwardedFrom || null,
    replyTo: replySource ? {
      id: replySource.id,
      senderId: replySource.senderId,
      senderName: userById(replySource.senderId)?.nickname || "?",
      text: replySource.text || "",
      attachmentName: replySource.attachments?.[0]?.name || "",
      attachmentKind: replySource.attachments?.[0]?.kind || ""
    } : null,
    editedAt: message.editedAt || 0,
    deletedAt: message.deletedAt || 0,
    readByMe: viewerId ? readBy.includes(viewerId) : false,
    readCount: readBy.filter((id) => id !== message.senderId).length,
    reactions: reactionSummary(message, viewerId),
    saved: viewerId ? Boolean(userById(viewerId)?.savedMessageIds?.includes(message.id)) : false,
    scheduledFrom: message.scheduledFrom || 0,
    createdAt: message.createdAt
  };
}

function dmRoom(userA, userB) {
  return `dm:${[userA, userB].sort().join(":")}`;
}

function groupRoom(groupId) {
  return `group:${groupId}`;
}

function groupIdFromRoom(roomId) {
  return String(roomId || "").startsWith("group:") ? String(roomId).slice(6) : "";
}

function publicGroup(group, viewerId = "") {
  if (!group) return null;
  return {
    id: group.id,
    roomId: groupRoom(group.id),
    name: group.name,
    ownerId: group.ownerId,
    adminIds: group.adminIds || [],
    memberIds: group.memberIds || [],
    myRole: viewerId ? groupRole(group, viewerId) : undefined,
    createdAt: group.createdAt
  };
}

function dmParticipants(roomId) {
  if (!roomId || !roomId.startsWith("dm:")) return [];
  return roomId.slice(3).split(":").filter(Boolean);
}

function canUseRoom(userId, roomId) {
  if (roomId === "global") return false;
  if (String(roomId || "").startsWith("group:")) {
    const group = db.groups.find((item) => item.id === groupIdFromRoom(roomId));
    return Boolean(group && group.memberIds.includes(userId));
  }
  const parts = dmParticipants(roomId);
  return parts.length === 2 && parts.includes(userId);
}

function cleanFavoriteRooms(user) {
  user.favoriteRoomIds = (user.favoriteRoomIds || [])
    .filter((roomId) => canUseRoom(user.id, roomId))
    .slice(0, 80);
}

function cleanMutedRooms(user) {
  user.mutedRoomIds = (user.mutedRoomIds || [])
    .filter((roomId) => canUseRoom(user.id, roomId))
    .slice(0, 120);
}

function deleteAccountByAdmin(target, adminUser, reason = "") {
  const targetId = target.id;
  const deletedAt = now();
  const touchedRooms = new Set();
  const removedRooms = new Set();

  db.sessions = db.sessions.filter((session) => session.userId !== targetId);
  db.pushSubscriptions = db.pushSubscriptions.filter((item) => item.userId !== targetId);
  db.callInvites = (db.callInvites || []).filter((invite) => (
    invite.targetUserId !== targetId
    && invite.from?.id !== targetId
    && !String(invite.callId || "").includes(targetId)
  ));

  for (const user of db.users) {
    if (user.id === targetId) continue;
    user.contactIds = (user.contactIds || []).filter((id) => id !== targetId);
    user.blockedUserIds = (user.blockedUserIds || []).filter((id) => id !== targetId);
    user.favoriteRoomIds = (user.favoriteRoomIds || []).filter((roomId) => !dmParticipants(roomId).includes(targetId));
    user.mutedRoomIds = (user.mutedRoomIds || []).filter((roomId) => !dmParticipants(roomId).includes(targetId));
    user.savedMessageIds = (user.savedMessageIds || []).filter((id) => {
      const message = db.messages.find((item) => item.id === id);
      return message && message.senderId !== targetId && !dmParticipants(message.roomId).includes(targetId);
    });
  }

  for (const message of db.messages) {
    if (dmParticipants(message.roomId).includes(targetId)) {
      touchedRooms.add(message.roomId);
      message.text = "";
      message.attachments = [];
      message.reactions = {};
      message.deletedAt = deletedAt;
      continue;
    }
    if (message.senderId === targetId) {
      touchedRooms.add(message.roomId);
      message.text = "";
      message.attachments = [];
      message.reactions = {};
      message.deletedAt = deletedAt;
    }
    if (message.replyToId) {
      const reply = db.messages.find((item) => item.id === message.replyToId);
      if (reply?.senderId === targetId) message.replyToId = "";
    }
    message.readBy = (message.readBy || []).filter((id) => id !== targetId);
    if (message.reactions?.[targetId]) delete message.reactions[targetId];
  }

  for (const roomId of Object.keys(db.roomPins || {})) {
    db.roomPins[roomId] = (db.roomPins[roomId] || []).filter((id) => {
      const message = db.messages.find((item) => item.id === id);
      return message && !message.deletedAt && message.senderId !== targetId;
    });
  }

  for (const poll of db.polls || []) {
    if (poll.votes?.[targetId]) delete poll.votes[targetId];
  }

  for (const task of db.roomTasks || []) {
    if (task.assigneeId === targetId) task.assigneeId = "";
  }

  for (const event of db.roomEvents || []) {
    if (event.rsvps?.[targetId]) delete event.rsvps[targetId];
  }

  for (const group of db.groups) {
    const wasMember = group.memberIds.includes(targetId);
    group.memberIds = group.memberIds.filter((id) => id !== targetId);
    group.adminIds = (group.adminIds || []).filter((id) => id !== targetId);
    if (group.ownerId === targetId) group.ownerId = group.memberIds[0] || "";
    if (group.ownerId && !group.adminIds.includes(group.ownerId)) group.adminIds.unshift(group.ownerId);
    if (wasMember) touchedRooms.add(groupRoom(group.id));
    if (group.memberIds.length < 2) removedRooms.add(groupRoom(group.id));
  }
  db.groups = db.groups.filter((group) => group.memberIds.length >= 2 && group.ownerId);
  for (const roomId of removedRooms) db.roomPins[roomId] = [];

  db.reports = (db.reports || []).filter((report) => report.reporterId !== targetId && report.targetUserId !== targetId);
  db.users = db.users.filter((user) => user.id !== targetId);
  recordSecurityEvent("admin-account-deleted", adminUser.id, {
    targetUserId: targetId,
    targetEmail: target.email,
    targetNickname: target.nickname,
    reason: cleanText(reason || "Удаление аккаунта администратором", 160)
  });
  return Array.from(touchedRooms);
}

function deleteOwnAccount(target) {
  const touchedRooms = deleteAccountByAdmin(target, target, "Account deleted by owner");
  recordSecurityEvent("account-self-deleted", target.id, { targetUserId: target.id });
  return touchedRooms;
}

function disconnectUserClients(userId, type = "session-revoked") {
  for (const [id, client] of clients) {
    if (client.userId !== userId) continue;
    try {
      client.res.write(`event: ${type}\ndata: ${safeJson({ reason: type })}\n\n`);
      client.res.end();
    } catch {}
    clients.delete(id);
  }
}

function removeUserCallInvites(userId) {
  db.callInvites = (db.callInvites || []).filter((invite) => (
    invite.targetUserId !== userId
    && invite.from?.id !== userId
    && !String(invite.callId || "").includes(userId)
  ));
}

function banAccountByAdmin(target, adminUser, reason = "") {
  target.bannedAt = now();
  target.bannedBy = adminUser.id;
  target.banReason = cleanText(reason || "Блокировка администратором", 160) || "Блокировка администратором";
  target.banVersion = Number(target.banVersion || 0) + 1;
  target.passwordResetHash = "";
  target.passwordResetExpiresAt = 0;
  target.passwordResetSentAt = 0;
  target.emailVerificationHash = "";
  target.emailVerificationExpiresAt = 0;
  target.emailVerificationSentAt = 0;
  db.sessions = db.sessions.filter((session) => session.userId !== target.id);
  db.pushSubscriptions = db.pushSubscriptions.filter((item) => item.userId !== target.id);
  removeUserCallInvites(target.id);
  disconnectUserClients(target.id, "admin-user-banned");
  recordSecurityEvent("admin-user-banned", adminUser.id, {
    targetUserId: target.id,
    reason: target.banReason,
    revokedSessions: true,
    banVersion: target.banVersion
  });
}

function unbanAccountByAdmin(target, adminUser) {
  target.bannedAt = 0;
  target.bannedBy = "";
  target.banReason = "";
  target.banVersion = Number(target.banVersion || 0) + 1;
  db.sessions = db.sessions.filter((session) => session.userId !== target.id);
  disconnectUserClients(target.id, "admin-user-unbanned");
  recordSecurityEvent("admin-user-unbanned", adminUser.id, {
    targetUserId: target.id,
    revokedSessions: true,
    banVersion: target.banVersion
  });
}

function roomTargets(roomId) {
  if (roomId === "global") return "all";
  if (String(roomId || "").startsWith("group:")) {
    const group = db.groups.find((item) => item.id === groupIdFromRoom(roomId));
    return group?.memberIds || [];
  }
  return dmParticipants(roomId);
}

function roomTargetsExcept(roomId, userId) {
  const targets = roomTargets(roomId);
  if (targets === "all") return db.users.map((user) => user.id).filter((id) => id !== userId);
  return targets.filter((id) => id !== userId);
}

function messageTargets(message) {
  const targets = roomTargets(message.roomId);
  const ids = targets === "all" ? db.users.map((user) => user.id) : targets;
  return ids.filter((id) => id === message.senderId || !isBlockedBetween(id, message.senderId));
}

function findMessageForUser(messageId, userId) {
  const message = db.messages.find((item) => item.id === messageId);
  if (!message || !canUseRoom(userId, message.roomId) || !canSeeMessage(userId, message)) return null;
  return message;
}

function pinnedMessages(roomId, viewerId = "") {
  const ids = db.roomPins?.[roomId] || [];
  return ids
    .map((id) => db.messages.find((message) => message.id === id && !message.deletedAt))
    .filter(Boolean)
    .map((message) => serializeMessage(message, viewerId));
}

function pushMessageUpdate(message) {
  for (const [id, client] of clients) {
    if (!messageTargets(message).includes(client.userId)) continue;
    try {
      client.res.write(`event: message-update\ndata: ${safeJson({ message: serializeMessage(message, client.userId) })}\n\n`);
    } catch {
      clients.delete(id);
    }
  }
}

function cleanPinList(roomId) {
  const ids = db.roomPins?.[roomId] || [];
  db.roomPins[roomId] = ids.filter((id) => db.messages.some((message) => message.id === id && !message.deletedAt));
}

function pushPins(roomId) {
  for (const [id, client] of clients) {
    if (!canUseRoom(client.userId, roomId)) continue;
    try {
      client.res.write(`event: pins\ndata: ${safeJson({ roomId, pins: pinnedMessages(roomId, client.userId) })}\n\n`);
    } catch {
      clients.delete(id);
    }
  }
}

function isImageMime(mimeType) {
  return ALLOWED_IMAGE_MIME.has(normalizeMimeType(mimeType));
}

function isAudioMime(mimeType) {
  const value = normalizeMimeType(mimeType);
  return value.startsWith("audio/") && ALLOWED_UPLOAD_MIME.has(value);
}

function normalizeMimeType(mimeType) {
  return String(mimeType || "").split(";")[0].trim().toLowerCase();
}

function sanitizeFileName(fileName) {
  const cleaned = String(fileName || "file").replace(/[^\w.\-а-яА-ЯёЁ ]+/g, "").trim();
  return cleaned.slice(0, 80) || "file";
}

function uploadExt(mimeType, fileName) {
  const normalized = normalizeMimeType(mimeType);
  if (MIME_EXT[normalized]) return MIME_EXT[normalized];
  const ext = path.extname(String(fileName || "")).replace(".", "").toLowerCase();
  return ext && ext.length <= 8 ? ext : "bin";
}

function hasMagic(buffer, hex) {
  return buffer.subarray(0, hex.length / 2).equals(Buffer.from(hex, "hex"));
}

function sniffMime(buffer) {
  if (hasMagic(buffer, "ffd8ff")) return "image/jpeg";
  if (hasMagic(buffer, "89504e470d0a1a0a")) return "image/png";
  if (buffer.subarray(0, 6).toString("ascii") === "GIF87a" || buffer.subarray(0, 6).toString("ascii") === "GIF89a") return "image/gif";
  if (buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  if (buffer.subarray(0, 4).toString("ascii") === "OggS") return "audio/ogg";
  if (hasMagic(buffer, "1a45dfa3")) return "audio/webm";
  if (buffer[0] === 0xff && (buffer[1] & 0xf6) === 0xf0) return "audio/aac";
  if (buffer.subarray(0, 3).toString("ascii") === "ID3" || buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0) return "audio/mpeg";
  if (buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WAVE") return "audio/wav";
  if (buffer.subarray(4, 8).toString("ascii") === "ftyp") return "audio/mp4";
  if (buffer.subarray(0, 4).toString("ascii") === "%PDF") return "application/pdf";
  if (hasMagic(buffer, "504b0304") || hasMagic(buffer, "504b0506") || hasMagic(buffer, "504b0708")) return "application/zip";
  if (hasMagic(buffer, "d0cf11e0a1b11ae1")) return "application/msword";
  if (!buffer.includes(0) && buffer.length <= MAX_FILE_BYTES) return "text/plain";
  return "";
}

function uploadMimeAllowed(claimedMime, sniffedMime) {
  if (!ALLOWED_UPLOAD_MIME.has(claimedMime)) return false;
  if (!sniffedMime) return false;
  if (claimedMime === sniffedMime) return true;
  if (claimedMime === "audio/x-wav" && sniffedMime === "audio/wav") return true;
  if (claimedMime === "audio/wave" && sniffedMime === "audio/wav") return true;
  if (claimedMime === "audio/x-m4a" && sniffedMime === "audio/mp4") return true;
  if (claimedMime === "audio/aac" && sniffedMime === "audio/mp4") return true;
  if (claimedMime.startsWith("audio/") && sniffedMime.startsWith("audio/")) return true;
  if (claimedMime === "application/x-zip-compressed" && sniffedMime === "application/zip") return true;
  if (claimedMime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" && sniffedMime === "application/zip") return true;
  return false;
}

function voiceUploadRequested(input) {
  const intent = String(input?.intent || input?.kind || "").toLowerCase();
  return intent === "voice" || intent === "audio";
}

function normalizedVoiceMime(mimeType, sniffedMime, input) {
  if (!voiceUploadRequested(input) || !String(sniffedMime || "").startsWith("audio/")) return mimeType;
  if (ALLOWED_UPLOAD_MIME.has(mimeType) && String(mimeType).startsWith("audio/")) return mimeType;
  if (["video/webm", "video/mp4", "application/mp4", "application/octet-stream"].includes(mimeType)) return sniffedMime;
  return mimeType;
}

function uploadDuration(input) {
  const duration = Math.round(Number(input?.durationSec || input?.duration || 0));
  if (!Number.isFinite(duration) || duration <= 0) return 0;
  return Math.min(duration, 60 * 60);
}

function userError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function decodeUpload(input) {
  const raw = String(input?.data || "");
  const match = raw.match(/^data:([^;,]+)(?:;[^,]*)?;base64,(.+)$/);
  const mimeType = normalizeMimeType(input?.mimeType || match?.[1] || "application/octet-stream");
  const base64 = (match ? match[2] : raw).replace(/\s+/g, "");
  if (!/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(mimeType)) throw userError("Неверный тип файла.");
  if (!/^[a-z0-9+/]*={0,2}$/i.test(base64) || base64.length % 4 === 1) throw userError("Неверные данные файла.");
  return { mimeType, buffer: Buffer.from(base64, "base64") };
}

function saveUpload(input, options = {}) {
  const { maxBytes = MAX_FILE_BYTES, imagesOnly = false } = options;
  const decoded = decodeUpload(input);
  let mimeType = decoded.mimeType;
  const { buffer } = decoded;
  if (!buffer.length) throw userError("Файл пустой.");
  if (buffer.length > maxBytes) throw userError(`Файл слишком большой. Максимум ${Math.round(maxBytes / 1024 / 1024)} МБ.`, 413);
  const sniffedMime = sniffMime(buffer);
  mimeType = normalizedVoiceMime(mimeType, sniffedMime, input);
  if (imagesOnly && !isImageMime(mimeType)) throw userError("Для аватарки нужна JPG, PNG, GIF или WebP картинка.");
  if (!imagesOnly && !ALLOWED_UPLOAD_MIME.has(mimeType)) {
    throw userError("Такой тип файла пока нельзя отправить.");
  }
  if (!uploadMimeAllowed(mimeType, sniffedMime)) throw userError("Тип файла не совпадает с его содержимым.");
  const originalName = sanitizeFileName(input?.name || input?.fileName || "file");
  const ext = uploadExt(mimeType, originalName);
  const storedName = `${uid(imagesOnly ? "avatar" : "file")}.${ext}`;
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  fs.writeFileSync(path.join(UPLOAD_DIR, storedName), buffer);
  queuePostgresUpload(storedName, mimeType, buffer);
  return {
    id: storedName.replace(/\.[^.]+$/, ""),
    url: `/uploads/${storedName}`,
    name: originalName,
    mimeType,
    size: buffer.length,
    kind: isImageMime(mimeType) ? "image" : (isAudioMime(mimeType) ? "audio" : "file"),
    durationSec: uploadDuration(input) || undefined,
    createdAt: now()
  };
}

function contentTypeForUpload(fileName) {
  const ext = path.extname(fileName).toLowerCase();
  const types = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".webm": "audio/webm",
    ".ogg": "audio/ogg",
    ".mp3": "audio/mpeg",
    ".m4a": "audio/mp4",
    ".aac": "audio/aac",
    ".wav": "audio/wav",
    ".pdf": "application/pdf",
    ".txt": "text/plain; charset=utf-8",
    ".zip": "application/zip",
    ".doc": "application/msword",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  };
  return types[ext] || "application/octet-stream";
}

function sendJson(res, status, payload, extraHeaders = {}) {
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    ...extraHeaders,
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(safeJson(payload));
}

function sendError(res, status, message) {
  sendJson(res, status, { ok: false, error: message });
}

function sendHtml(res, status, html) {
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(html);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let body = "";
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        const error = new Error("Слишком большой запрос.");
        error.statusCode = 413;
        reject(error);
        req.destroy();
        return;
      }
      body += chunk;
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        const error = new Error("Неверный JSON.");
        error.statusCode = 400;
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function parseCookies(req) {
  const header = String(req.headers.cookie || "");
  const cookies = {};
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (name) cookies[name] = decodeURIComponent(value);
  }
  return cookies;
}

function isHttpsRequest(req) {
  return req.headers["x-forwarded-proto"] === "https" || req.socket.encrypted;
}

function sessionCookie(req, token, maxAgeSeconds = SESSION_DAYS * 24 * 60 * 60) {
  const secure = isHttpsRequest(req) ? "; Secure" : "";
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAgeSeconds}${secure}`;
}

function clearSessionCookie(req) {
  return sessionCookie(req, "", 0);
}

function trustedOrigin(req) {
  const origin = String(req.headers.origin || "");
  if (!origin) return true;
  try {
    const originUrl = new URL(origin);
    const host = String(req.headers.host || "");
    if (originUrl.host === host) return true;
    const allowed = String(process.env.ALLOWED_ORIGINS || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    return allowed.includes(origin);
  } catch {
    return false;
  }
}

function enforceOrigin(req, res, url) {
  if (url.pathname === "/api/health") return true;
  if (["POST", "PUT", "PATCH", "DELETE", "OPTIONS"].includes(req.method) && !trustedOrigin(req)) {
    sendError(res, 403, "Запрос заблокирован защитой origin.");
    return false;
  }
  return true;
}

function getToken(req, url) {
  const auth = req.headers.authorization || "";
  if (auth.startsWith("Bearer ")) return auth.slice(7).trim();
  const cookieToken = parseCookies(req)[SESSION_COOKIE];
  if (cookieToken) return cookieToken;
  return "";
}

function authenticate(req, url) {
  const token = getToken(req, url);
  if (!tokenLooksValid(token)) return null;
  const session = db.sessions.find((item) => item.token === token && item.expiresAt > now());
  if (!session) return null;
  const user = db.users.find((item) => item.id === session.userId);
  if (!user) return null;
  if (user.bannedAt && !isAdmin(user)) {
    return { user, session, token, banned: true };
  }
  if (!isAdmin(user) && Number(session.banVersion || 0) !== Number(user.banVersion || 0)) return null;
  if (!user.lastSeen || now() - user.lastSeen > 30000) {
    user.lastSeen = now();
    saveStore();
  }
  return { user, session, token };
}

function requireAuth(req, res, url) {
  const auth = authenticate(req, url);
  if (!auth) {
    sendError(res, 401, "Нужно войти в аккаунт.");
    return null;
  }
  if (auth.banned) {
    sendError(res, 403, userBanMessage(auth.user));
    return null;
  }
  return auth;
}

function rateLimit(req, key, limit = 80, windowMs = 60000) {
  const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket.remoteAddress || "local";
  const bucketKey = `${ip}:${key}`;
  const bucket = rateBuckets.get(bucketKey) || { count: 0, resetAt: now() + windowMs };
  if (now() > bucket.resetAt) {
    bucket.count = 0;
    bucket.resetAt = now() + windowMs;
  }
  bucket.count += 1;
  rateBuckets.set(bucketKey, bucket);
  return bucket.count <= limit;
}

function requesterIp(req) {
  return req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket.remoteAddress || "local";
}

function loginFailureKey(req, email) {
  return `${requesterIp(req)}:${normalizeEmail(email)}`;
}

function loginLocked(req, email) {
  const failure = loginFailures.get(loginFailureKey(req, email));
  if (!failure) return 0;
  if (failure.lockedUntil && failure.lockedUntil > now()) return failure.lockedUntil;
  if (failure.lockedUntil && failure.lockedUntil <= now()) loginFailures.delete(loginFailureKey(req, email));
  return 0;
}

function recordLoginFailure(req, email, userId = "") {
  const key = loginFailureKey(req, email);
  const failure = loginFailures.get(key) || { count: 0, lockedUntil: 0 };
  failure.count += 1;
  if (failure.count >= LOGIN_FAIL_LIMIT) {
    failure.lockedUntil = now() + LOGIN_LOCK_MS;
    failure.count = 0;
  }
  loginFailures.set(key, failure);
  recordSecurityEvent("login-failed", userId, { ip: requesterIp(req), lockedUntil: failure.lockedUntil || 0 });
}

function clearLoginFailures(req, email) {
  loginFailures.delete(loginFailureKey(req, email));
}

function pushEvent(event, payload, targets = "all") {
  const data = `event: ${event}\ndata: ${safeJson(payload)}\n\n`;
  for (const [id, client] of clients) {
    if (targets !== "all" && !targets.includes(client.userId)) continue;
    try {
      client.res.write(data);
    } catch {
      clients.delete(id);
    }
  }
}

function pruneCallInvites() {
  const cutoff = now() - 90 * 1000;
  const before = db.callInvites.length;
  db.callInvites = db.callInvites.filter((invite) => invite.createdAt > cutoff);
  if (db.callInvites.length !== before) saveStore();
}

function saveCallInvite(invite) {
  pruneCallInvites();
  db.callInvites = db.callInvites.filter((item) => (
    !(item.callId === invite.callId && item.targetUserId === invite.targetUserId)
  ));
  db.callInvites.push(invite);
  saveStore();
}

function removeCallInvite(callId, targetUserId = "") {
  const before = db.callInvites.length;
  db.callInvites = db.callInvites.filter((invite) => {
    if (invite.callId !== callId) return true;
    return targetUserId && invite.targetUserId !== targetUserId;
  });
  if (db.callInvites.length !== before) saveStore();
}

function webPushReady() {
  return Boolean(webPush && db.vapidKeys?.publicKey && db.vapidKeys?.privateKey);
}

function usersForRoom(roomId, senderId) {
  const targets = roomTargets(roomId);
  const ids = targets === "all" ? db.users.map((user) => user.id) : targets;
  return ids.filter((id) => id && id !== senderId && !isBlockedBetween(id, senderId));
}

function pushTitleFor(message) {
  const sender = db.users.find((user) => user.id === message.senderId);
  if (message.roomId === "global") return `${sender?.nickname || "Orbit"} в общем чате`;
  if (message.roomId.startsWith("group:")) {
    const group = db.groups.find((item) => item.id === groupIdFromRoom(message.roomId));
    return `${sender?.nickname || "Orbit"} в ${group?.name || "группе"}`;
  }
  return sender?.nickname || "Новое сообщение";
}

function pushBodyFor(message) {
  if (message.text) return message.text.slice(0, 120);
  const first = message.attachments?.[0];
  if (!first) return "Новое сообщение";
  return first.kind === "image" ? "Фото" : first.name || "Файл";
}

function unreadCountFor(userId) {
  return db.messages.filter((message) => (
    message.senderId !== userId
    && !message.deletedAt
    && !message.readBy?.includes(userId)
    && canUseRoom(userId, message.roomId)
    && canSeeMessage(userId, message)
  )).length;
}

function unreadCountForRoom(userId, roomId) {
  return db.messages.filter((message) => (
    message.roomId === roomId
    && message.senderId !== userId
    && !message.deletedAt
    && !message.readBy?.includes(userId)
    && canUseRoom(userId, message.roomId)
    && canSeeMessage(userId, message)
  )).length;
}

function pushUrlFor(roomId) {
  return roomId ? `/?room=${encodeURIComponent(roomId)}` : "/";
}

function pushPayload(data = {}) {
  return safeJson({
    title: data.title || "Orbit Chat",
    body: data.body || "Новое сообщение",
    url: data.url || "/",
    roomId: data.roomId || "",
    messageId: data.messageId || "",
    tag: data.tag || data.messageId || data.roomId || "orbit-chat",
    icon: "/icon-192.png",
    badge: "/maskable-icon-512.png",
    badgeCount: data.badgeCount || 0,
    timestamp: now()
  });
}

async function sendPushToUsers(userIds, data = {}) {
  if (!webPushReady()) return { attempted: 0, sent: 0, expired: 0, enabled: false };
  const uniqueIds = [...new Set(userIds.filter(Boolean))];
  if (!uniqueIds.length) return { attempted: 0, sent: 0, expired: 0, enabled: true };
  const subscriptions = db.pushSubscriptions.filter((item) => uniqueIds.includes(item.userId));
  if (!subscriptions.length) return { attempted: 0, sent: 0, expired: 0, enabled: true };
  const expired = new Set();
  let sent = 0;
  await Promise.all(subscriptions.map(async (item) => {
    try {
      const payload = pushPayload({
        ...data,
        badgeCount: unreadCountFor(item.userId)
      });
      await webPush.sendNotification(item.subscription, payload);
      sent += 1;
    } catch (error) {
      if (error.statusCode === 404 || error.statusCode === 410) expired.add(item.endpoint);
    }
  }));
  if (expired.size) {
    db.pushSubscriptions = db.pushSubscriptions.filter((item) => !expired.has(item.endpoint));
    saveStore();
  }
  return { attempted: subscriptions.length, sent, expired: expired.size, enabled: true };
}

async function sendPushNotifications(message) {
  const targetIds = usersForRoom(message.roomId, message.senderId)
    .filter((id) => !(userById(id)?.mutedRoomIds || []).includes(message.roomId));
  return sendPushToUsers(targetIds, {
    title: pushTitleFor(message),
    body: pushBodyFor(message),
    url: pushUrlFor(message.roomId),
    roomId: message.roomId,
    messageId: message.id,
    tag: message.roomId
  });
}

function appendMessage(message) {
  db.messages.push(message);
  if (db.messages.length > MAX_MESSAGES) db.messages = db.messages.slice(-MAX_MESSAGES);
}

function publishMessage(message) {
  for (const [id, client] of clients) {
    if (!messageTargets(message).includes(client.userId)) continue;
    try {
      client.res.write(`event: message\ndata: ${safeJson({ message: serializeMessage(message, client.userId), rooms: roomTargets(message.roomId) === "all" ? null : roomTargets(message.roomId) })}\n\n`);
    } catch {
      clients.delete(id);
    }
  }
  pushEvent("rooms", { roomIds: [message.roomId] }, roomTargets(message.roomId));
  sendPushNotifications(message).catch(() => {});
}

function deliverScheduledMessages() {
  if (!db?.scheduledMessages?.length) return;
  const currentTime = now();
  const due = [];
  const keep = [];
  for (const item of db.scheduledMessages) {
    if (Number(item.sendAt || 0) <= currentTime) due.push(item);
    else keep.push(item);
  }
  if (!due.length) return;
  db.scheduledMessages = keep;
  for (const item of due) {
    const sender = userById(item.senderId);
    if (!sender || (sender.bannedAt && !isAdmin(sender)) || !canSendToRoom(sender.id, item.roomId)) {
      recordSecurityEvent("scheduled-message-dropped", item.senderId, { roomId: item.roomId });
      continue;
    }
    const message = {
      id: uid("msg"),
      roomId: item.roomId,
      senderId: sender.id,
      text: cleanText(item.text, 1200),
      attachments: [],
      replyToId: "",
      reactions: {},
      readBy: [],
      scheduledFrom: item.createdAt,
      createdAt: currentTime
    };
    appendMessage(message);
    sender.lastSeen = currentTime;
    publishMessage(message);
  }
  saveStore();
}

function roomFeatureCounts(roomId) {
  const activePolls = db.polls.filter((poll) => poll.roomId === roomId && !poll.closed).length;
  const openTasks = db.roomTasks.filter((task) => task.roomId === roomId && task.status !== "done").length;
  const upcomingEvents = db.roomEvents.filter((event) => event.roomId === roomId && !event.cancelled && Number(event.startsAt || 0) >= now() - 60 * 60 * 1000).length;
  return { activePolls, openTasks, upcomingEvents };
}

function serializePoll(poll, viewerId = "") {
  const votes = poll.votes || {};
  const counts = {};
  for (const option of poll.options || []) counts[option.id] = 0;
  for (const optionId of Object.values(votes)) {
    if (counts[optionId] !== undefined) counts[optionId] += 1;
  }
  return {
    id: poll.id,
    roomId: poll.roomId,
    question: poll.question,
    options: (poll.options || []).map((option) => ({
      id: option.id,
      text: option.text,
      count: counts[option.id] || 0
    })),
    totalVotes: Object.keys(votes).length,
    myVote: viewerId ? (votes[viewerId] || "") : "",
    closed: Boolean(poll.closed),
    createdBy: poll.createdBy,
    creator: publicUser(userById(poll.createdBy)),
    createdAt: poll.createdAt,
    closedAt: poll.closedAt || 0
  };
}

function serializeTask(task, viewerId = "") {
  return {
    id: task.id,
    roomId: task.roomId,
    title: task.title,
    details: task.details || "",
    status: task.status,
    priority: task.priority || "normal",
    assigneeId: task.assigneeId || "",
    assignee: task.assigneeId ? publicUser(userById(task.assigneeId)) : null,
    createdBy: task.createdBy,
    creator: publicUser(userById(task.createdBy)),
    canEdit: viewerId ? task.createdBy === viewerId || task.assigneeId === viewerId : false,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt || task.createdAt,
    completedAt: task.completedAt || 0
  };
}

function serializeRoomEvent(event, viewerId = "") {
  const rsvps = event.rsvps || {};
  const counts = { yes: 0, maybe: 0, no: 0 };
  for (const answer of Object.values(rsvps)) {
    if (counts[answer] !== undefined) counts[answer] += 1;
  }
  return {
    id: event.id,
    roomId: event.roomId,
    title: event.title,
    details: event.details || "",
    location: event.location || "",
    startsAt: event.startsAt || 0,
    rsvpCounts: counts,
    myRsvp: viewerId ? (rsvps[viewerId] || "") : "",
    cancelled: Boolean(event.cancelled),
    createdBy: event.createdBy,
    creator: publicUser(userById(event.createdBy)),
    createdAt: event.createdAt,
    updatedAt: event.updatedAt || event.createdAt
  };
}

function canManageRoomFeature(userId, roomId, creatorId) {
  const user = userById(userId);
  if (creatorId === userId || isAdmin(user)) return true;
  if (String(roomId || "").startsWith("group:")) {
    const group = db.groups.find((item) => item.id === groupIdFromRoom(roomId));
    return canManageGroup(userId, group);
  }
  return false;
}

function roomContainsUser(roomId, userId) {
  if (!userId || !db.users.some((user) => user.id === userId)) return false;
  if (roomId === "global") return false;
  const targets = roomTargets(roomId);
  return targets !== "all" && targets.includes(userId);
}

function listRoomsFor(userId) {
  const viewer = userById(userId);
  if (viewer) cleanFavoriteRooms(viewer);
  if (viewer) cleanMutedRooms(viewer);
  const favorites = new Set(viewer?.favoriteRoomIds || []);
  const muted = new Set(viewer?.mutedRoomIds || []);
  const directRoomIds = new Set();
  for (const message of db.messages) {
    if (message.roomId.startsWith("dm:") && dmParticipants(message.roomId).includes(userId)) {
      directRoomIds.add(message.roomId);
    }
  }
  const rooms = [];
  for (const roomId of directRoomIds) {
    const otherId = dmParticipants(roomId).find((id) => id !== userId);
    const other = db.users.find((user) => user.id === otherId);
    rooms.push({
      id: roomId,
      type: "direct",
      title: other?.nickname || "Личный чат",
      user: publicUserFor(other, userById(userId)),
      favorite: favorites.has(roomId),
      muted: muted.has(roomId),
      featureCounts: roomFeatureCounts(roomId),
      lastMessage: lastMessageFor(roomId, userId),
      unreadCount: unreadCountForRoom(userId, roomId)
    });
  }
  for (const group of db.groups.filter((item) => item.memberIds.includes(userId))) {
    rooms.push({
      id: groupRoom(group.id),
      type: "group",
      title: group.name,
      group: publicGroup(group, userId),
      subtitle: `${group.memberIds.length} участников`,
      favorite: favorites.has(groupRoom(group.id)),
      muted: muted.has(groupRoom(group.id)),
      featureCounts: roomFeatureCounts(groupRoom(group.id)),
      lastMessage: lastMessageFor(groupRoom(group.id), userId),
      unreadCount: unreadCountForRoom(userId, groupRoom(group.id))
    });
  }
  rooms.sort((a, b) => Number(b.favorite) - Number(a.favorite) || (b.lastMessage?.createdAt || 0) - (a.lastMessage?.createdAt || 0));
  return rooms;
}

function serializeAdminMessage(message, adminUser) {
  const sender = userById(message.senderId);
  const data = serializeMessage(message, "");
  data.sender = sender ? publicUserFor(sender, adminUser) : {
    id: message.senderId,
    nickname: "Аккаунт удален",
    avatarColor: "#64748b",
    avatarUrl: "",
    status: "offline",
    lastSeen: 0,
    createdAt: 0
  };
  data.canAdminDelete = !message.deletedAt && (!sender || sender.id === adminUser.id || !isAdmin(sender));
  data.adminDeletedBy = message.adminDeletedBy || "";
  data.adminDeleteReason = message.adminDeleteReason || "";
  return data;
}

function lastAdminMessageFor(roomId, adminUser) {
  for (let index = db.messages.length - 1; index >= 0; index -= 1) {
    if (db.messages[index].roomId === roomId) return serializeAdminMessage(db.messages[index], adminUser);
  }
  return null;
}

function adminRoomInfo(roomId, adminUser) {
  const roomMessages = db.messages.filter((message) => message.roomId === roomId);
  const deletedCount = roomMessages.filter((message) => message.deletedAt).length;
  if (roomId === "global") {
    return {
      id: roomId,
      type: "global",
      title: "Общий чат",
      subtitle: "Все пользователи",
      participants: [],
      messageCount: roomMessages.length,
      deletedCount,
      updatedAt: roomMessages.at(-1)?.createdAt || 0,
      lastMessage: lastAdminMessageFor(roomId, adminUser)
    };
  }
  if (String(roomId).startsWith("dm:")) {
    const participants = dmParticipants(roomId).map((id) => userById(id)).filter(Boolean);
    const names = participants.map((user) => user.nickname);
    return {
      id: roomId,
      type: "direct",
      title: names.join(" ↔ ") || "Личная переписка",
      subtitle: `${roomMessages.length} сообщений`,
      participants: participants.map((user) => publicUserFor(user, adminUser)),
      messageCount: roomMessages.length,
      deletedCount,
      updatedAt: roomMessages.at(-1)?.createdAt || 0,
      lastMessage: lastAdminMessageFor(roomId, adminUser)
    };
  }
  if (String(roomId).startsWith("group:")) {
    const group = db.groups.find((item) => item.id === groupIdFromRoom(roomId));
    if (!group) return null;
    return {
      id: roomId,
      type: "group",
      title: group.name,
      subtitle: `${group.memberIds.length} участников · ${roomMessages.length} сообщений`,
      group: publicGroup(group, adminUser.id),
      participants: group.memberIds.map((id) => userById(id)).filter(Boolean).map((user) => publicUserFor(user, adminUser)),
      messageCount: roomMessages.length,
      deletedCount,
      updatedAt: roomMessages.at(-1)?.createdAt || group.createdAt || 0,
      lastMessage: lastAdminMessageFor(roomId, adminUser)
    };
  }
  return null;
}

function listAdminRooms(adminUser) {
  const roomIds = new Set();
  for (const group of db.groups) roomIds.add(groupRoom(group.id));
  for (const message of db.messages) roomIds.add(message.roomId);
  return Array.from(roomIds)
    .map((roomId) => adminRoomInfo(roomId, adminUser))
    .filter(Boolean)
    .filter((room) => room.id !== "global" && (room.messageCount > 0 || room.type === "group"))
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0) || a.title.localeCompare(b.title))
    .slice(0, 200);
}

function deleteMessageByAdmin(message, adminUser, reason = "") {
  const deletedAt = now();
  message.text = "";
  message.attachments = [];
  message.reactions = {};
  message.deletedAt = deletedAt;
  message.adminDeletedBy = adminUser.id;
  message.adminDeleteReason = cleanText(reason || "Удалено администратором", 160);
  for (const user of db.users) {
    user.savedMessageIds = (user.savedMessageIds || []).filter((id) => id !== message.id);
  }
  cleanPinList(message.roomId);
  recordSecurityEvent("admin-message-deleted", adminUser.id, {
    messageId: message.id,
    roomId: message.roomId,
    senderId: message.senderId,
    reason: message.adminDeleteReason
  });
}

function visibleUsersFor(viewer) {
  const ids = new Set(viewer.contactIds || []);
  for (const message of db.messages) {
    if (message.roomId.startsWith("dm:") && dmParticipants(message.roomId).includes(viewer.id)) {
      for (const id of dmParticipants(message.roomId)) if (id !== viewer.id) ids.add(id);
    }
  }
  for (const group of db.groups.filter((item) => item.memberIds.includes(viewer.id))) {
    for (const id of group.memberIds) if (id !== viewer.id) ids.add(id);
  }
  return db.users
    .filter((user) => ids.has(user.id))
    .map((user) => publicUserFor(user, viewer));
}

function pushUserLists(targetUserIds = null) {
  const allowed = targetUserIds ? new Set(targetUserIds) : null;
  for (const [id, client] of clients) {
    if (allowed && !allowed.has(client.userId)) continue;
    const viewer = db.users.find((user) => user.id === client.userId);
    if (!viewer) continue;
    try {
      client.res.write(`event: users\ndata: ${safeJson({ users: visibleUsersFor(viewer) })}\n\n`);
    } catch {
      clients.delete(id);
    }
  }
}

function lastMessageFor(roomId, viewerId = "") {
  for (let index = db.messages.length - 1; index >= 0; index -= 1) {
    if (db.messages[index].roomId === roomId && (!viewerId || canSeeMessage(viewerId, db.messages[index]))) {
      return serializeMessage(db.messages[index], viewerId);
    }
  }
  return null;
}

function serveStatic(req, res, pathname) {
  const requested = pathname === "/" ? "/index.html" : path.posix.normalize(`/${String(pathname || "").replace(/\\/g, "/")}`);
  if (!STATIC_FILES.has(requested)) {
    res.writeHead(404, { ...SECURITY_HEADERS, "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
    res.end("Not found");
    return;
  }
  const filePath = path.join(__dirname, requested.slice(1));
  const normalized = path.normalize(filePath);
  fs.readFile(normalized, (error, content) => {
    if (error) {
      res.writeHead(404, { ...SECURITY_HEADERS, "content-type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }
    const ext = path.extname(normalized).toLowerCase();
    const type = {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "application/javascript; charset=utf-8",
      ".json": "application/json; charset=utf-8",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".svg": "image/svg+xml"
    }[ext] || "application/octet-stream";
    res.writeHead(200, { ...SECURITY_HEADERS, "content-type": type, "cache-control": "no-store" });
    res.end(content);
  });
}

function uploadPathFor(fileName) {
  return `/uploads/${fileName}`;
}

function canAccessUpload(user, fileName) {
  const uploadPath = uploadPathFor(fileName);
  if (db.users.some((item) => item.avatarUrl === uploadPath)) return true;
  if (isAdmin(user)) {
    return db.messages.some((message) => (
      !message.deletedAt
      && (message.attachments || []).some((file) => file.url === uploadPath)
    ));
  }
  return db.messages.some((message) => (
    !message.deletedAt
    && canUseRoom(user.id, message.roomId)
    && canSeeMessage(user.id, message)
    && (message.attachments || []).some((file) => file.url === uploadPath)
  ));
}

function shouldDownloadUpload(fileName) {
  const type = contentTypeForUpload(fileName);
  return !type.startsWith("image/") && !type.startsWith("audio/");
}

async function serveUpload(req, res, url) {
  const auth = authenticate(req, url);
  if (!auth) {
    sendError(res, 401, "Нужно войти в аккаунт.");
    return;
  }
  const fileName = path.basename(decodeURIComponent(url.pathname).slice("/uploads/".length));
  if (!canAccessUpload(auth.user, fileName)) {
    sendError(res, 403, "Нет доступа к этому файлу.");
    return;
  }
  const filePath = path.join(UPLOAD_DIR, fileName);
  const normalized = path.resolve(filePath);
  const uploadRoot = path.resolve(UPLOAD_DIR);
  if (!normalized.startsWith(`${uploadRoot}${path.sep}`)) {
    res.writeHead(404, { ...SECURITY_HEADERS, "content-type": "text/plain; charset=utf-8" });
    res.end("Not found");
    return;
  }
  if (!fs.existsSync(normalized)) {
    const stored = await loadPostgresUpload(fileName).catch(() => null);
    if (!stored) {
      res.writeHead(404, { ...SECURITY_HEADERS, "content-type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }
    res.writeHead(200, {
      ...SECURITY_HEADERS,
      "content-type": stored.mimeType || contentTypeForUpload(fileName),
      ...(shouldDownloadUpload(fileName) ? { "content-disposition": `attachment; filename="${fileName.replace(/"/g, "")}"` } : {}),
      "cache-control": "private, max-age=86400"
    });
    res.end(stored.buffer);
    return;
  }
  res.writeHead(200, {
    ...SECURITY_HEADERS,
    "content-type": contentTypeForUpload(fileName),
    ...(shouldDownloadUpload(fileName) ? { "content-disposition": `attachment; filename="${fileName.replace(/"/g, "")}"` } : {}),
    "cache-control": "private, max-age=86400"
  });
  fs.createReadStream(normalized).pipe(res);
}

async function handleApi(req, res, url) {
  if (!enforceOrigin(req, res, url)) return;

  if (req.method === "OPTIONS") {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (url.pathname === "/api/health" && req.method === "GET") {
    sendJson(res, 200, {
      ok: true,
      app: "orbit-chat",
      version: APP_VERSION,
      time: new Date().toISOString(),
      webPushReady: webPushReady(),
      mailReady: mailConfigured(),
      postgresConfigured: Boolean(process.env.DATABASE_URL),
      postgresReady,
      dataDir: DATA_DIR,
      persistentDisk: DATA_DIR === "/var/data"
    });
    return;
  }

  if (url.pathname === "/api/email/verify" && req.method === "GET") {
    const token = String(url.searchParams.get("token") || "");
    const result = token ? verifyEmailToken(token) : { ok: false, message: "Ссылка подтверждения пустая." };
    sendHtml(res, result.ok ? 200 : 400, `<!doctype html>
      <html lang="ru">
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width,initial-scale=1">
          <title>Orbit Chat</title>
          <style>
            body{margin:0;min-height:100vh;display:grid;place-items:center;background:#071117;color:#eef8ff;font-family:Arial,sans-serif}
            main{max-width:520px;padding:28px;text-align:center}
            a{color:#9eff8f}
          </style>
        </head>
        <body>
          <main>
            <h1>${result.ok ? "Почта подтверждена" : "Не получилось подтвердить"}</h1>
            <p>${result.message}</p>
            <p><a href="/">Вернуться в Orbit Chat</a></p>
          </main>
        </body>
      </html>`);
    return;
  }

  if (url.pathname === "/api/register/request-code" && req.method === "POST") {
    const body = await readBody(req);
    const email = normalizeEmail(body.email);
    const nickname = cleanText(body.nickname, 24);
    const password = String(body.password || "");
    const passwordError = validatePasswordStrength(password);
    if (!validateEmail(email)) return sendError(res, 400, "Введи нормальную почту.");
    if (nickname.length < 2) return sendError(res, 400, "Ник должен быть минимум 2 символа.");
    if (passwordError) return sendError(res, 400, passwordError);
    if (!rateLimit(req, `register-code:${email}:${requesterIp(req)}`, 5, 15 * 60 * 1000)) {
      return sendError(res, 429, "Слишком много кодов на эту почту. Подожди 15 минут.");
    }
    if (db.users.some((user) => user.email === email || user.pendingEmail === email)) {
      return sendError(res, 409, "Такой email уже зарегистрирован.");
    }
    if (db.users.some((user) => user.nickname.toLowerCase() === nickname.toLowerCase())) {
      return sendError(res, 409, "Такой ник уже занят.");
    }
    const { code } = createEmailCodeChallenge({
      email,
      purpose: "register",
      nickname,
      password,
      ip: requesterIp(req)
    });
    const emailCode = await sendEmailCode(req, { email, code, purpose: "register" }).catch((error) => {
      recordSecurityEvent("email-code-failed", "", { email, purpose: "register", error: error.message });
      return { sent: false, provider: "error", error: "Код не отправился. Проверь SMTP/Resend настройки на Render." };
    });
    saveStore();
    sendJson(res, 200, {
      ok: true,
      message: "Код отправлен на почту. Введи его в форме регистрации.",
      emailCode
    });
    return;
  }

  if (url.pathname === "/api/register" && req.method === "POST") {
    if (!rateLimit(req, "register", 15)) return sendError(res, 429, "Слишком много попыток. Подожди минуту.");
    const body = await readBody(req);
    const email = normalizeEmail(body.email);
    const nickname = cleanText(body.nickname, 24);
    const password = String(body.password || "");
    const code = sanitizeEmailCode(body.code);
    const passwordError = validatePasswordStrength(password);
    if (!validateEmail(email)) return sendError(res, 400, "Введи нормальную почту.");
    if (nickname.length < 2) return sendError(res, 400, "Ник должен быть минимум 2 символа.");
    if (passwordError) return sendError(res, 400, passwordError);
    if (db.users.some((user) => user.email === email || user.pendingEmail === email)) return sendError(res, 409, "Такой email уже зарегистрирован.");
    if (db.users.some((user) => user.nickname.toLowerCase() === nickname.toLowerCase())) {
      return sendError(res, 409, "Такой ник уже занят.");
    }
    const challenge = findEmailCodeChallenge({ email, purpose: "register" });
    const codeResult = verifyEmailCodeChallenge(challenge, code);
    if (!codeResult.ok) {
      saveStore();
      return sendError(res, codeResult.status, codeResult.message);
    }
    if (challenge.nickname.toLowerCase() !== nickname.toLowerCase()) {
      return sendError(res, 400, "Ник отличается от того, для которого был отправлен код. Запроси новый код.");
    }
    if (!verifyPassword(password, challenge)) {
      return sendError(res, 400, "Пароль отличается от того, для которого был отправлен код. Запроси новый код.");
    }
    const user = {
      id: uid("user"),
      email,
      nickname,
      passwordSalt: challenge.passwordSalt,
      passwordHash: challenge.passwordHash,
      passwordIterations: challenge.passwordIterations,
      avatarColor: avatarColor(email + nickname),
      bio: "",
      contactIds: [],
      favoriteRoomIds: [],
      mutedRoomIds: [],
      emailVerified: true,
      pendingEmail: "",
      lastSeen: now(),
      createdAt: now()
    };
    const token = makeToken();
    db.users.push(user);
    db.emailCodes = (db.emailCodes || []).filter((item) => item.id !== challenge.id);
    db.sessions.push({
      token,
      userId: user.id,
      banVersion: Number(user.banVersion || 0),
      createdAt: now(),
      expiresAt: now() + SESSION_DAYS * 24 * 60 * 60 * 1000
    });
    recordSecurityEvent("registered-email-code", user.id, { ip: requesterIp(req), email });
    saveStore();
    const emailVerification = { sent: true, provider: "code", verified: true };
    pushUserLists();
    sendJson(res, 201, { ok: true, token, user: publicUser(user, true), rooms: listRoomsFor(user.id), emailVerification }, {
      "set-cookie": sessionCookie(req, token)
    });
    return;
  }

  if (url.pathname === "/api/login" && req.method === "POST") {
    if (!rateLimit(req, "login", 30)) return sendError(res, 429, "Слишком много попыток. Подожди минуту.");
    const body = await readBody(req);
    const email = normalizeEmail(body.email);
    const password = String(body.password || "");
    const lockedUntil = loginLocked(req, email);
    if (lockedUntil) return sendError(res, 429, `Слишком много неправильных попыток. Попробуй через ${Math.ceil((lockedUntil - now()) / 60000)} мин.`);
    const user = db.users.find((item) => item.email === email);
    if (!user || !verifyPassword(password, user)) {
      recordLoginFailure(req, email, user?.id || "");
      return sendError(res, 401, "Почта или пароль неверные.");
    }
    if (user.bannedAt && !isAdmin(user)) return sendError(res, 403, userBanMessage(user));
    const token = makeToken();
    clearLoginFailures(req, email);
    user.lastSeen = now();
    upgradePasswordHashIfNeeded(password, user);
    db.sessions.push({
      token,
      userId: user.id,
      banVersion: Number(user.banVersion || 0),
      createdAt: now(),
      expiresAt: now() + SESSION_DAYS * 24 * 60 * 60 * 1000
    });
    db.sessions = db.sessions.filter((session) => session.expiresAt > now());
    recordSecurityEvent("login", user.id, { ip: requesterIp(req) });
    saveStore();
    pushUserLists();
    sendJson(res, 200, { ok: true, token, user: publicUser(user, true), rooms: listRoomsFor(user.id) }, {
      "set-cookie": sessionCookie(req, token)
    });
    return;
  }

  if (url.pathname === "/api/admin-login" && req.method === "POST") {
    if (!rateLimit(req, "admin-login", 12, 15 * 60 * 1000)) return sendError(res, 429, "Слишком много попыток входа администратора.");
    const body = await readBody(req);
    const adminPassword = String(body.adminPassword || "");
    if (!secretEquals(adminPassword, ADMIN_LOGIN_PASSWORD)) {
      recordSecurityEvent("admin-login-failed", "", { ip: requesterIp(req) });
      return sendError(res, 401, "Пароль администратора неверный.");
    }
    const user = ensureAdminUser();
    const token = makeToken();
    db.sessions.push({
      token,
      userId: user.id,
      banVersion: Number(user.banVersion || 0),
      createdAt: now(),
      expiresAt: now() + SESSION_DAYS * 24 * 60 * 60 * 1000
    });
    db.sessions = db.sessions.filter((session) => session.expiresAt > now());
    recordSecurityEvent("admin-login", user.id, { ip: requesterIp(req) });
    saveStore();
    pushUserLists();
    sendJson(res, 200, { ok: true, token, user: publicUser(user, true), rooms: listRoomsFor(user.id) }, {
      "set-cookie": sessionCookie(req, token)
    });
    return;
  }

  if (url.pathname === "/api/password/request-reset" && req.method === "POST") {
    if (!rateLimit(req, "password-reset-request", 8, 60 * 60 * 1000)) {
      return sendError(res, 429, "Слишком много запросов восстановления. Попробуй позже.");
    }
    const body = await readBody(req);
    const email = normalizeEmail(body.email);
    const user = db.users.find((item) => item.email === email);
    let passwordReset = null;
    if (user) {
      const token = makePasswordReset(user);
      passwordReset = await sendPasswordResetEmail(req, user, token).catch((error) => {
        recordSecurityEvent("password-reset-failed", user.id, { error: error.message });
        return { sent: false, provider: "error", error: "Письмо восстановления не отправилось. Проверь SMTP/Resend настройки на Render." };
      });
      saveStore();
    }
    sendJson(res, 200, {
      ok: true,
      message: "Если такая почта зарегистрирована, мы отправили ссылку восстановления.",
      passwordReset
    });
    return;
  }

  if (url.pathname === "/api/password/reset" && req.method === "POST") {
    if (!rateLimit(req, "password-reset-finish", 12, 60 * 60 * 1000)) {
      return sendError(res, 429, "Слишком много попыток восстановления. Попробуй позже.");
    }
    const body = await readBody(req);
    const resetHash = tokenHash(body.token || "");
    const user = db.users.find((item) => item.passwordResetHash && item.passwordResetHash === resetHash);
    const newPassword = String(body.password || "");
    const passwordError = validatePasswordStrength(newPassword);
    if (!user || !user.passwordResetExpiresAt || user.passwordResetExpiresAt < now()) {
      return sendError(res, 400, "Ссылка восстановления неверная или устарела.");
    }
    if (passwordError) return sendError(res, 400, passwordError);
    const { salt, hash, iterations } = hashPassword(newPassword);
    user.passwordSalt = salt;
    user.passwordHash = hash;
    user.passwordIterations = iterations;
    user.passwordResetHash = "";
    user.passwordResetExpiresAt = 0;
    user.passwordResetSentAt = 0;
    db.sessions = db.sessions.filter((session) => session.userId !== user.id);
    recordSecurityEvent("password-reset-finished", user.id, { revokedSessions: true });
    saveStore();
    sendJson(res, 200, { ok: true });
    return;
  }

  const auth = requireAuth(req, res, url);
  if (!auth) return;

  if (url.pathname === "/api/logout" && req.method === "POST") {
    db.sessions = db.sessions.filter((session) => session.token !== auth.token);
    recordSecurityEvent("logout", auth.user.id);
    saveStore();
    sendJson(res, 200, { ok: true }, {
      "set-cookie": clearSessionCookie(req)
    });
    return;
  }

  if (url.pathname === "/api/me" && req.method === "GET") {
    sendJson(res, 200, {
      ok: true,
      user: publicUser(auth.user, true),
      users: visibleUsersFor(auth.user),
      rooms: listRoomsFor(auth.user.id)
    }, {
      "set-cookie": sessionCookie(req, auth.token)
    });
    return;
  }

  if (url.pathname === "/api/security" && req.method === "GET") {
    const sessions = db.sessions
      .filter((session) => session.userId === auth.user.id && session.expiresAt > now())
      .map((session) => ({
        id: crypto.createHash("sha256").update(session.token).digest("hex").slice(0, 12),
        current: session.token === auth.token,
        createdAt: session.createdAt,
        expiresAt: session.expiresAt
      }))
      .sort((a, b) => b.createdAt - a.createdAt);
    sendJson(res, 200, {
      ok: true,
      passwordIterations: Number(auth.user.passwordIterations || 120000),
      sessions,
      pushDevices: db.pushSubscriptions.filter((item) => item.userId === auth.user.id).length,
      recentEvents: (db.securityEvents || [])
        .filter((item) => !item.userId || item.userId === auth.user.id)
        .slice(-20)
        .reverse()
    });
    return;
  }

  if (url.pathname === "/api/account/delete" && req.method === "POST") {
    if (!rateLimit(req, `account-delete:${auth.user.id}`, 5, 60 * 60 * 1000)) {
      return sendError(res, 429, "Too many account deletion attempts.");
    }
    const body = await readBody(req);
    if (String(body.confirm || "").trim().toUpperCase() !== "DELETE") {
      return sendError(res, 400, "Type DELETE to confirm account deletion.");
    }
    if (auth.user.isSystemAdmin) {
      return sendError(res, 403, "The system administrator account cannot be deleted from the app.");
    }
    const deletedUserId = auth.user.id;
    const touchedRooms = deleteOwnAccount(auth.user);
    saveStore();
    disconnectUserClients(deletedUserId, "account-deleted");
    pushUserLists();
    for (const roomId of touchedRooms) {
      pushEvent("rooms", { roomIds: [roomId] }, roomTargets(roomId));
      pushPins(roomId);
    }
    sendJson(res, 200, { ok: true, deletedUserId }, {
      "set-cookie": clearSessionCookie(req)
    });
    return;
  }

  if (url.pathname === "/api/admin/reports" && req.method === "GET") {
    if (!isAdmin(auth.user)) return sendError(res, 403, "Нет доступа к админ-панели.");
    const reports = (db.reports || []).slice(-80).reverse().map((report) => {
      const reporter = userById(report.reporterId);
      const target = userById(report.targetUserId);
      const message = db.messages.find((item) => item.id === report.messageId);
      return {
        ...report,
        reporter: publicUser(reporter),
        target: publicUser(target),
        messageText: message?.text || "",
        attachmentName: message?.attachments?.[0]?.name || ""
      };
    });
    sendJson(res, 200, { ok: true, reports });
    return;
  }

  if (url.pathname === "/api/admin/rooms" && req.method === "GET") {
    if (!isAdmin(auth.user)) return sendError(res, 403, "Нет доступа к админ-панели.");
    if (!rateLimit(req, `admin-rooms:${auth.user.id}`, 120)) return sendError(res, 429, "Слишком много админ-запросов.");
    const q = cleanText(url.searchParams.get("q") || "", 80).toLowerCase();
    let rooms = listAdminRooms(auth.user);
    if (q) {
      rooms = rooms.filter((room) => (
        String(room.title || "").toLowerCase().includes(q)
        || String(room.subtitle || "").toLowerCase().includes(q)
        || (room.participants || []).some((user) => (
          String(user.nickname || "").toLowerCase().includes(q)
          || String(user.email || "").toLowerCase().includes(q)
        ))
      ));
    }
    recordSecurityEvent("admin-rooms-viewed", auth.user.id, { q: q ? "[search]" : "" });
    sendJson(res, 200, { ok: true, rooms: rooms.slice(0, 120) });
    return;
  }

  if (url.pathname === "/api/admin/messages" && req.method === "GET") {
    if (!isAdmin(auth.user)) return sendError(res, 403, "Нет доступа к админ-панели.");
    if (!rateLimit(req, `admin-messages:${auth.user.id}`, 180)) return sendError(res, 429, "Слишком много админ-запросов.");
    const roomId = String(url.searchParams.get("room") || "");
    if (!roomId || roomId === "global") return sendError(res, 404, "РџРµСЂРµРїРёСЃРєР° РЅРµ РЅР°Р№РґРµРЅР°.");
    const q = cleanText(url.searchParams.get("q") || "", 80).toLowerCase();
    const room = adminRoomInfo(roomId, auth.user);
    if (!room) return sendError(res, 404, "Переписка не найдена.");
    let messages = db.messages.filter((message) => message.roomId === roomId);
    if (q) {
      messages = messages.filter((message) => {
        const sender = userById(message.senderId);
        return !message.deletedAt && (
          String(message.text || "").toLowerCase().includes(q)
          || String(sender?.nickname || "").toLowerCase().includes(q)
          || (message.attachments || []).some((file) => String(file.name || "").toLowerCase().includes(q))
        );
      });
    }
    messages = messages.slice(q ? -60 : -150);
    recordSecurityEvent("admin-messages-viewed", auth.user.id, { roomId, q: q ? "[search]" : "" });
    sendJson(res, 200, {
      ok: true,
      room,
      messages: messages.map((message) => serializeAdminMessage(message, auth.user)),
      pins: pinnedMessages(roomId, "")
    });
    return;
  }

  if (url.pathname === "/api/admin/messages/delete" && req.method === "POST") {
    if (!isAdmin(auth.user)) return sendError(res, 403, "Нет доступа к админ-панели.");
    if (!rateLimit(req, `admin-message-delete:${auth.user.id}`, 80, 60 * 60 * 1000)) return sendError(res, 429, "Слишком много удалений сообщений.");
    const body = await readBody(req);
    const message = db.messages.find((item) => item.id === String(body.messageId || ""));
    const reason = cleanText(body.reason || "Удалено администратором", 160);
    if (!message) return sendError(res, 404, "Сообщение не найдено.");
    if (message.deletedAt) return sendError(res, 400, "Сообщение уже удалено.");
    const sender = userById(message.senderId);
    if (sender && isAdmin(sender) && sender.id !== auth.user.id) return sendError(res, 403, "Нельзя удалить сообщение другого администратора.");
    deleteMessageByAdmin(message, auth.user, reason);
    saveStore();
    pushMessageUpdate(message);
    pushEvent("rooms", { roomIds: [message.roomId] }, roomTargets(message.roomId));
    pushPins(message.roomId);
    sendJson(res, 200, {
      ok: true,
      message: serializeAdminMessage(message, auth.user),
      room: adminRoomInfo(message.roomId, auth.user),
      rooms: listAdminRooms(auth.user),
      pins: pinnedMessages(message.roomId, "")
    });
    return;
  }

  if (url.pathname === "/api/admin/block" && req.method === "POST") {
    if (!isAdmin(auth.user)) return sendError(res, 403, "Нет доступа к админ-панели.");
    if (!rateLimit(req, `admin-block:${auth.user.id}`, 80)) return sendError(res, 429, "Слишком много админ-действий.");
    const body = await readBody(req);
    const target = db.users.find((user) => user.id === String(body.userId || ""));
    const action = body.action === "unblock" ? "unblock" : "block";
    const reason = cleanText(body.reason || "Блокировка администратором", 160);
    if (!target || target.id === auth.user.id) return sendError(res, 404, "Пользователь не найден.");
    if (isAdmin(target) && target.id !== auth.user.id) return sendError(res, 403, "Нельзя заблокировать другого администратора.");
    if (action === "block") {
      banAccountByAdmin(target, auth.user, reason);
      saveStore();
      pushUserLists([auth.user.id, target.id]);
      sendJson(res, 200, {
        ok: true,
        target: publicUserFor(target, auth.user),
        users: visibleUsersFor(auth.user)
      });
      return;
      target.bannedAt = now();
      target.bannedBy = auth.user.id;
      target.banReason = reason || "Блокировка администратором";
      db.sessions = db.sessions.filter((session) => session.userId !== target.id);
      recordSecurityEvent("admin-user-banned", auth.user.id, { targetUserId: target.id, reason: target.banReason });
    } else {
      target.bannedAt = 0;
      target.bannedBy = "";
      target.banReason = "";
      recordSecurityEvent("admin-user-unbanned", auth.user.id, { targetUserId: target.id });
    }
    saveStore();
    pushUserLists([auth.user.id, target.id]);
    sendJson(res, 200, {
      ok: true,
      target: publicUserFor(target, auth.user),
      users: visibleUsersFor(auth.user)
    });
    return;
  }

  if (url.pathname === "/api/admin/delete-account" && req.method === "POST") {
    if (!isAdmin(auth.user)) return sendError(res, 403, "Нет доступа к админ-панели.");
    if (!rateLimit(req, `admin-delete:${auth.user.id}`, 20, 60 * 60 * 1000)) return sendError(res, 429, "Слишком много удалений аккаунтов.");
    const body = await readBody(req);
    const target = db.users.find((user) => user.id === String(body.userId || ""));
    const reason = cleanText(body.reason || "Удаление аккаунта администратором", 160);
    if (!target || target.id === auth.user.id) return sendError(res, 404, "Пользователь не найден.");
    if (isAdmin(target)) return sendError(res, 403, "Нельзя удалить аккаунт администратора.");
    const touchedRooms = deleteAccountByAdmin(target, auth.user, reason);
    saveStore();
    pushUserLists();
    for (const roomId of touchedRooms) {
      pushEvent("rooms", { roomIds: [roomId] }, roomTargets(roomId));
      pushPins(roomId);
    }
    sendJson(res, 200, {
      ok: true,
      deletedUserId: target.id,
      users: visibleUsersFor(auth.user),
      rooms: listRoomsFor(auth.user.id)
    });
    return;
  }

  if (url.pathname === "/api/security/revoke-other-sessions" && req.method === "POST") {
    const before = db.sessions.length;
    db.sessions = db.sessions.filter((session) => session.token === auth.token || session.userId !== auth.user.id);
    recordSecurityEvent("sessions-revoked", auth.user.id, { removed: before - db.sessions.length });
    saveStore();
    sendJson(res, 200, { ok: true, removed: before - db.sessions.length });
    return;
  }

  if (url.pathname === "/api/security/password" && req.method === "POST") {
    if (!rateLimit(req, `password:${auth.user.id}`, 6, 60 * 60 * 1000)) return sendError(res, 429, "Слишком много попыток смены пароля.");
    const body = await readBody(req);
    const currentPassword = String(body.currentPassword || "");
    const newPassword = String(body.newPassword || "");
    const passwordError = validatePasswordStrength(newPassword);
    if (!verifyPassword(currentPassword, auth.user)) return sendError(res, 401, "Текущий пароль неверный.");
    if (passwordError) return sendError(res, 400, passwordError);
    const { salt, hash, iterations } = hashPassword(newPassword);
    auth.user.passwordSalt = salt;
    auth.user.passwordHash = hash;
    auth.user.passwordIterations = iterations;
    db.sessions = db.sessions.filter((session) => session.token === auth.token || session.userId !== auth.user.id);
    recordSecurityEvent("password-changed", auth.user.id, { revokedOtherSessions: true });
    saveStore();
    sendJson(res, 200, { ok: true });
    return;
  }

  if (url.pathname === "/api/email/send-verification" && req.method === "POST") {
    if (!rateLimit(req, `email-verify:${auth.user.id}`, 5, 60 * 60 * 1000)) return sendError(res, 429, "Слишком много писем подтверждения. Попробуй позже.");
    const targetEmail = normalizeEmail(auth.user.pendingEmail || auth.user.email);
    if (!targetEmail || !validateEmail(targetEmail)) return sendError(res, 400, "Почта неверная.");
    const purpose = auth.user.pendingEmail ? "change" : "register";
    const { code } = createEmailCodeChallenge({
      email: targetEmail,
      purpose,
      userId: auth.user.id,
      ip: requesterIp(req)
    });
    const emailVerification = await sendEmailCode(req, { user: auth.user, email: targetEmail, code, purpose }).catch((error) => {
      recordSecurityEvent("email-code-failed", auth.user.id, { email: targetEmail, purpose, error: error.message });
      return { sent: false, provider: "error", error: "Код не отправился. Проверь SMTP/Resend настройки на Render." };
    });
    saveStore();
    sendJson(res, 200, { ok: true, user: publicUser(auth.user, true), emailVerification });
    return;
  }

  if (url.pathname === "/api/email/confirm-code" && req.method === "POST") {
    if (!rateLimit(req, `email-confirm:${auth.user.id}`, 20, 60 * 60 * 1000)) return sendError(res, 429, "Слишком много попыток подтверждения почты.");
    const body = await readBody(req);
    const targetEmail = normalizeEmail(auth.user.pendingEmail || auth.user.email);
    const purpose = auth.user.pendingEmail ? "change" : "register";
    if (!targetEmail || !validateEmail(targetEmail)) return sendError(res, 400, "Почта неверная.");
    const challenge = findEmailCodeChallenge({ email: targetEmail, purpose, userId: auth.user.id });
    const codeResult = verifyEmailCodeChallenge(challenge, body.code);
    if (!codeResult.ok) {
      saveStore();
      return sendError(res, codeResult.status, codeResult.message);
    }
    if (db.users.some((user) => user.id !== auth.user.id && (user.email === targetEmail || user.pendingEmail === targetEmail))) {
      return sendError(res, 409, "Эта почта уже занята другим аккаунтом.");
    }
    auth.user.email = targetEmail;
    auth.user.pendingEmail = "";
    auth.user.emailVerified = true;
    auth.user.emailVerificationHash = "";
    auth.user.emailVerificationEmail = "";
    auth.user.emailVerificationPurpose = "";
    auth.user.emailVerificationExpiresAt = 0;
    db.emailCodes = (db.emailCodes || []).filter((item) => item.id !== challenge.id);
    recordSecurityEvent("email-code-confirmed", auth.user.id, { email: targetEmail, purpose });
    saveStore();
    pushUserLists();
    sendJson(res, 200, {
      ok: true,
      user: publicUser(auth.user, true),
      emailVerification: { sent: true, provider: "code", verified: true }
    });
    return;
  }

  if (url.pathname === "/api/push-key" && req.method === "GET") {
    sendJson(res, 200, {
      ok: true,
      enabled: webPushReady(),
      publicKey: webPushReady() ? db.vapidKeys.publicKey : ""
    });
    return;
  }

  if (url.pathname === "/api/push-status" && req.method === "GET") {
    const userSubscriptions = db.pushSubscriptions.filter((item) => item.userId === auth.user.id);
    sendJson(res, 200, {
      ok: true,
      enabled: webPushReady(),
      installedDependency: Boolean(webPush),
      subscriptionCount: userSubscriptions.length,
      publicKey: webPushReady() ? db.vapidKeys.publicKey : "",
      subject: VAPID_SUBJECT
    });
    return;
  }

  if (url.pathname === "/api/push-subscriptions" && req.method === "POST") {
    if (!rateLimit(req, `push-subscribe:${auth.user.id}`, 20)) return sendError(res, 429, "Слишком много push-подписок. Подожди минуту.");
    if (!webPushReady()) return sendError(res, 503, "Push-уведомления включатся после установки зависимости web-push.");
    const body = await readBody(req);
    const subscription = body.subscription || {};
    const endpoint = String(subscription.endpoint || "");
    if (!endpoint || !subscription.keys?.p256dh || !subscription.keys?.auth) {
      return sendError(res, 400, "Браузер не дал корректную push-подписку.");
    }
    db.pushSubscriptions = db.pushSubscriptions.filter((item) => item.endpoint !== endpoint);
    db.pushSubscriptions.push({
      id: uid("push"),
      userId: auth.user.id,
      endpoint,
      subscription,
      createdAt: now(),
      lastSeen: now()
    });
    const ownSubscriptions = db.pushSubscriptions
      .filter((item) => item.userId === auth.user.id)
      .sort((a, b) => b.lastSeen - a.lastSeen);
    const keepEndpoints = new Set(ownSubscriptions.slice(0, 10).map((item) => item.endpoint));
    db.pushSubscriptions = db.pushSubscriptions.filter((item) => item.userId !== auth.user.id || keepEndpoints.has(item.endpoint));
    saveStore();
    sendJson(res, 200, { ok: true });
    return;
  }

  if (url.pathname === "/api/push-unsubscribe" && req.method === "POST") {
    const body = await readBody(req);
    const endpoint = String(body.endpoint || "");
    if (!endpoint) return sendError(res, 400, "Не передана push-подписка устройства.");
    const before = db.pushSubscriptions.length;
    db.pushSubscriptions = db.pushSubscriptions.filter((item) => (
      item.userId !== auth.user.id || item.endpoint !== endpoint
    ));
    saveStore();
    sendJson(res, 200, { ok: true, removed: before - db.pushSubscriptions.length });
    return;
  }

  if (url.pathname === "/api/push-test" && req.method === "POST") {
    if (!rateLimit(req, `push-test:${auth.user.id}`, 20)) return sendError(res, 429, "Слишком много тестовых уведомлений. Подожди минуту.");
    const result = await sendPushToUsers([auth.user.id], {
      title: "Orbit Chat",
      body: "Тестовое push-уведомление готово для экрана блокировки.",
      url: "/",
      roomId: "test",
      tag: `test-${auth.user.id}`
    });
    if (!result.enabled) return sendError(res, 503, "На сервере не установлен web-push. На Render он ставится через npm install.");
    if (!result.attempted) return sendError(res, 409, "У этого устройства пока нет push-подписки. Нажми включить уведомления ещё раз.");
    sendJson(res, 200, { ok: true, ...result });
    return;
  }

  if (url.pathname === "/api/profile" && req.method === "POST") {
    if (!rateLimit(req, `profile:${auth.user.id}`, 30)) return sendError(res, 429, "Слишком много изменений профиля. Подожди минуту.");
    const body = await readBody(req);
    const nickname = cleanText(body.nickname, 24);
    const bio = cleanText(body.bio, 120);
    const newEmail = normalizeEmail(body.email || auth.user.email);
    let emailVerification = null;
    if (nickname.length < 2) return sendError(res, 400, "Ник должен быть минимум 2 символа.");
    if (!validateEmail(newEmail)) return sendError(res, 400, "Введи нормальную почту.");
    const nicknameBusy = db.users.some((user) => user.id !== auth.user.id && user.nickname.toLowerCase() === nickname.toLowerCase());
    if (nicknameBusy) return sendError(res, 409, "Такой ник уже занят.");
    const emailBusy = db.users.some((user) => (
      user.id !== auth.user.id
      && (user.email === newEmail || user.pendingEmail === newEmail)
    ));
    if (emailBusy) return sendError(res, 409, "Такая почта уже занята.");
    auth.user.nickname = nickname;
    auth.user.bio = bio;
    if (newEmail !== auth.user.email && newEmail !== auth.user.pendingEmail) {
      auth.user.pendingEmail = newEmail;
      const { code } = createEmailCodeChallenge({
        email: newEmail,
        purpose: "change",
        userId: auth.user.id,
        ip: requesterIp(req)
      });
      emailVerification = await sendEmailCode(req, { user: auth.user, email: newEmail, code, purpose: "change" }).catch((error) => {
        recordSecurityEvent("email-code-failed", auth.user.id, { email: newEmail, purpose: "change", error: error.message });
        return { sent: false, provider: "error", error: "Код не отправился. Проверь SMTP/Resend настройки на Render." };
      });
    }
    if (body.removeAvatar) auth.user.avatarUrl = "";
    if (body.avatar) auth.user.avatarUrl = saveUpload(body.avatar, { maxBytes: MAX_AVATAR_BYTES, imagesOnly: true }).url;
    saveStore();
    pushUserLists();
    sendJson(res, 200, { ok: true, user: publicUser(auth.user, true), emailVerification });
    return;
  }

  if (url.pathname === "/api/contacts" && req.method === "POST") {
    if (!rateLimit(req, `contacts:${auth.user.id}`, 80)) return sendError(res, 429, "Слишком много действий с контактами.");
    const body = await readBody(req);
    const userId = String(body.userId || "");
    const target = db.users.find((user) => user.id === userId);
    if (!target || target.id === auth.user.id) return sendError(res, 404, "Пользователь не найден.");
    if (isBlockedBetween(auth.user.id, target.id)) return sendError(res, 403, "Нельзя сохранить контакт, пока есть блокировка.");
    auth.user.contactIds ||= [];
    const exists = auth.user.contactIds.includes(target.id);
    const shouldAdd = body.action !== "remove";
    if (shouldAdd && !exists) auth.user.contactIds.push(target.id);
    if (!shouldAdd && exists) auth.user.contactIds = auth.user.contactIds.filter((id) => id !== target.id);
    saveStore();
    sendJson(res, 200, {
      ok: true,
      user: publicUser(auth.user, true),
      users: visibleUsersFor(auth.user)
    });
    return;
  }

  if (url.pathname === "/api/blocks" && req.method === "POST") {
    if (!rateLimit(req, `blocks:${auth.user.id}`, 40)) return sendError(res, 429, "Слишком много действий с блокировками.");
    const body = await readBody(req);
    const userId = String(body.userId || "");
    const target = db.users.find((user) => user.id === userId);
    if (!target || target.id === auth.user.id) return sendError(res, 404, "Пользователь не найден.");
    auth.user.blockedUserIds ||= [];
    const shouldBlock = body.action !== "unblock";
    if (shouldBlock && !auth.user.blockedUserIds.includes(target.id)) {
      auth.user.blockedUserIds.push(target.id);
      auth.user.contactIds = (auth.user.contactIds || []).filter((id) => id !== target.id);
      recordSecurityEvent("user-blocked", auth.user.id, { targetUserId: target.id });
    }
    if (!shouldBlock) {
      auth.user.blockedUserIds = auth.user.blockedUserIds.filter((id) => id !== target.id);
      recordSecurityEvent("user-unblocked", auth.user.id, { targetUserId: target.id });
    }
    saveStore();
    pushUserLists([auth.user.id, target.id]);
    sendJson(res, 200, {
      ok: true,
      user: publicUser(auth.user, true),
      users: visibleUsersFor(auth.user)
    });
    return;
  }

  if (url.pathname === "/api/reports" && req.method === "POST") {
    if (!rateLimit(req, `reports:${auth.user.id}`, 10, 60 * 60 * 1000)) return sendError(res, 429, "Слишком много жалоб. Попробуй позже.");
    const body = await readBody(req);
    const messageId = String(body.messageId || "");
    const message = messageId ? findMessageForUser(messageId, auth.user.id) : null;
    const targetUserId = String(body.userId || message?.senderId || "");
    const target = db.users.find((user) => user.id === targetUserId);
    if (!target || target.id === auth.user.id) return sendError(res, 404, "Пользователь или сообщение не найдено.");
    const reason = cleanText(body.reason || "Жалоба из профиля", 240);
    db.reports ||= [];
    db.reports.push({
      id: uid("report"),
      reporterId: auth.user.id,
      targetUserId: target.id,
      messageId: message?.id || "",
      roomId: message?.roomId || "",
      reason,
      status: "open",
      createdAt: now()
    });
    db.reports = db.reports.slice(-1000);
    recordSecurityEvent("user-reported", auth.user.id, { targetUserId: target.id, messageId: message?.id || "" });
    saveStore();
    sendJson(res, 200, { ok: true });
    return;
  }

  if (url.pathname === "/api/groups" && req.method === "POST") {
    if (!rateLimit(req, `groups:${auth.user.id}`, 20)) return sendError(res, 429, "Слишком много групп за минуту.");
    const body = await readBody(req);
    const name = cleanText(body.name, 32);
    const requestedMembers = Array.isArray(body.memberIds) ? body.memberIds.map(String) : [];
    const memberIds = Array.from(new Set([auth.user.id, ...requestedMembers]))
      .filter((id) => db.users.some((user) => user.id === id))
      .filter((id) => id === auth.user.id || !isBlockedBetween(auth.user.id, id))
      .slice(0, 30);
    if (name.length < 2) return sendError(res, 400, "Название группы должно быть минимум 2 символа.");
    if (memberIds.length < 2) return sendError(res, 400, "Для группы нужен хотя бы один участник кроме тебя.");
    const group = {
      id: uid("group"),
      name,
      ownerId: auth.user.id,
      adminIds: [auth.user.id],
      memberIds,
      createdAt: now()
    };
    db.groups.push(group);
    saveStore();
    pushEvent("rooms", { roomIds: [groupRoom(group.id)] }, memberIds);
    sendJson(res, 201, {
      ok: true,
      group: publicGroup(group, auth.user.id),
      rooms: listRoomsFor(auth.user.id)
    });
    return;
  }

  if (url.pathname === "/api/groups/manage" && req.method === "POST") {
    if (!rateLimit(req, `groups-manage:${auth.user.id}`, 80)) return sendError(res, 429, "Слишком много действий с группами.");
    const body = await readBody(req);
    const groupId = String(body.groupId || groupIdFromRoom(body.roomId || ""));
    const action = String(body.action || "");
    const group = db.groups.find((item) => item.id === groupId);
    if (!group || !group.memberIds.includes(auth.user.id)) return sendError(res, 404, "Группа не найдена.");
    group.adminIds = Array.from(new Set([group.ownerId, ...(group.adminIds || [])].filter(Boolean)));
    const targetId = String(body.userId || "");
    const target = targetId ? db.users.find((user) => user.id === targetId) : null;
    const manager = canManageGroup(auth.user.id, group);

    if (action === "rename") {
      if (!manager) return sendError(res, 403, "Переименовывать группу могут владелец и админы.");
      const name = cleanText(body.name, 32);
      if (name.length < 2) return sendError(res, 400, "Название группы слишком короткое.");
      group.name = name;
    } else if (action === "add") {
      if (!manager) return sendError(res, 403, "Добавлять участников могут владелец и админы.");
      if (!target || target.id === auth.user.id) return sendError(res, 404, "Пользователь не найден.");
      if (isBlockedBetween(auth.user.id, target.id)) return sendError(res, 403, "Нельзя добавить пользователя, пока есть блокировка.");
      if (!group.memberIds.includes(target.id)) group.memberIds.push(target.id);
    } else if (action === "remove") {
      if (!manager) return sendError(res, 403, "Удалять участников могут владелец и админы.");
      if (!target || target.id === group.ownerId) return sendError(res, 400, "Владельца группы нельзя удалить.");
      if (target.id === auth.user.id) return sendError(res, 400, "Чтобы выйти самому, используй действие leave.");
      group.memberIds = group.memberIds.filter((id) => id !== target.id);
      group.adminIds = group.adminIds.filter((id) => id !== target.id);
    } else if (action === "promote") {
      if (group.ownerId !== auth.user.id) return sendError(res, 403, "Назначать админов может только владелец.");
      if (!target || !group.memberIds.includes(target.id)) return sendError(res, 404, "Участник не найден.");
      if (!group.adminIds.includes(target.id)) group.adminIds.push(target.id);
    } else if (action === "demote") {
      if (group.ownerId !== auth.user.id) return sendError(res, 403, "Снимать админов может только владелец.");
      if (!target || target.id === group.ownerId) return sendError(res, 400, "Владельца нельзя снять.");
      group.adminIds = group.adminIds.filter((id) => id !== target.id);
    } else if (action === "leave") {
      if (group.ownerId === auth.user.id) return sendError(res, 400, "Владелец пока не может выйти. Сначала создай новую группу или удали участников.");
      group.memberIds = group.memberIds.filter((id) => id !== auth.user.id);
      group.adminIds = group.adminIds.filter((id) => id !== auth.user.id);
    } else {
      return sendError(res, 400, "Неизвестное действие группы.");
    }

    group.memberIds = Array.from(new Set(group.memberIds)).filter((id) => db.users.some((user) => user.id === id)).slice(0, 60);
    group.adminIds = Array.from(new Set([group.ownerId, ...(group.adminIds || [])])).filter((id) => group.memberIds.includes(id));
    if (group.memberIds.length < 2) {
      db.groups = db.groups.filter((item) => item.id !== group.id);
      db.roomPins[groupRoom(group.id)] = [];
    }
    saveStore();
    const roomId = groupRoom(group.id);
    const targets = group.memberIds.length ? group.memberIds : [auth.user.id, targetId].filter(Boolean);
    pushEvent("rooms", { roomIds: [roomId] }, targets);
    pushUserLists(targets);
    sendJson(res, 200, { ok: true, group: publicGroup(group, auth.user.id), rooms: listRoomsFor(auth.user.id) });
    return;
  }

  if (url.pathname === "/api/calls" && req.method === "POST") {
    if (!rateLimit(req, `call:${auth.user.id}`, 240)) return sendError(res, 429, "Слишком много сигналов звонка.");
    const body = await readBody(req);
    const type = String(body.type || "");
    const targetUserId = String(body.targetUserId || "");
    const target = db.users.find((user) => user.id === targetUserId);
    const allowed = new Set(["offer", "answer", "ice", "hangup", "reject", "cancel"]);
    if (!allowed.has(type)) return sendError(res, 400, "Неверный тип звонка.");
    if (!target || target.id === auth.user.id) return sendError(res, 404, "Пользователь не найден.");
    if (["offer", "answer", "ice"].includes(type) && isBlockedBetween(auth.user.id, target.id)) {
      return sendError(res, 403, "Звонок заблокирован настройками приватности.");
    }
    const signalRoomId = String(body.payload?.roomId || "");
    if (signalRoomId && (!canUseRoom(auth.user.id, signalRoomId) || !canUseRoom(target.id, signalRoomId))) {
      return sendError(res, 403, "Нет доступа к комнате звонка.");
    }
    const payload = {
      type,
      callId: cleanText(body.callId || uid("call"), 80),
      from: publicUser(auth.user),
      targetUserId,
      payload: body.payload || {},
      createdAt: now()
    };
    if (type === "offer") saveCallInvite(payload);
    if (type === "answer" || type === "reject") removeCallInvite(payload.callId, auth.user.id);
    if (type === "cancel" || type === "hangup") removeCallInvite(payload.callId, targetUserId);
    pushEvent("call", payload, [targetUserId]);
    if (type === "offer") {
      const roomId = String(payload.payload?.roomId || "");
      const roomTitle = cleanText(payload.payload?.roomTitle || "", 60);
      sendPushToUsers([targetUserId], {
        title: "Входящий видеозвонок",
        body: roomTitle ? `${auth.user.nickname} звонит в ${roomTitle}` : `${auth.user.nickname} звонит тебе`,
        url: pushUrlFor(roomId),
        roomId,
        tag: payload.callId
      }).catch(() => {});
    }
    sendJson(res, 200, { ok: true });
    return;
  }

  if (url.pathname === "/api/users" && req.method === "GET") {
    const q = cleanText(url.searchParams.get("q") || "", 40).toLowerCase();
    if (q.length < 2) {
      sendJson(res, 200, { ok: true, users: [] });
      return;
    }
    let users = db.users.filter((user) => user.id !== auth.user.id && (isAdmin(auth.user) || !isBlockedBy(user.id, auth.user.id)));
    users = users.filter((user) => (
      user.nickname.toLowerCase().includes(q)
      || user.email.toLowerCase() === q
    )).slice(0, 30);
    sendJson(res, 200, { ok: true, users: users.map((user) => publicUserFor(user, auth.user)) });
    return;
  }

  if (url.pathname === "/api/rooms" && req.method === "GET") {
    sendJson(res, 200, { ok: true, rooms: listRoomsFor(auth.user.id) });
    return;
  }

  if (url.pathname === "/api/rooms/favorite" && req.method === "POST") {
    if (!rateLimit(req, `room-favorite:${auth.user.id}`, 80)) return sendError(res, 429, "Слишком много действий с чатами.");
    const body = await readBody(req);
    const roomId = String(body.roomId || "global");
    const action = body.action === "remove" ? "remove" : "add";
    if (!canUseRoom(auth.user.id, roomId)) return sendError(res, 403, "Нет доступа к этому чату.");
    auth.user.favoriteRoomIds ||= [];
    if (action === "add" && !auth.user.favoriteRoomIds.includes(roomId)) {
      auth.user.favoriteRoomIds.unshift(roomId);
    }
    if (action === "remove") {
      auth.user.favoriteRoomIds = auth.user.favoriteRoomIds.filter((id) => id !== roomId);
    }
    cleanFavoriteRooms(auth.user);
    saveStore();
    sendJson(res, 200, {
      ok: true,
      user: publicUser(auth.user, true),
      rooms: listRoomsFor(auth.user.id)
    });
    return;
  }

  if (url.pathname === "/api/rooms/mute" && req.method === "POST") {
    if (!rateLimit(req, `room-mute:${auth.user.id}`, 80)) return sendError(res, 429, "Слишком много действий с чатами.");
    const body = await readBody(req);
    const roomId = String(body.roomId || "global");
    const action = body.action === "unmute" ? "unmute" : "mute";
    if (!canUseRoom(auth.user.id, roomId)) return sendError(res, 403, "Нет доступа к этому чату.");
    auth.user.mutedRoomIds ||= [];
    if (action === "mute" && !auth.user.mutedRoomIds.includes(roomId)) {
      auth.user.mutedRoomIds.unshift(roomId);
    }
    if (action === "unmute") {
      auth.user.mutedRoomIds = auth.user.mutedRoomIds.filter((id) => id !== roomId);
    }
    cleanMutedRooms(auth.user);
    saveStore();
    sendJson(res, 200, {
      ok: true,
      user: publicUser(auth.user, true),
      rooms: listRoomsFor(auth.user.id)
    });
    return;
  }

  if (url.pathname === "/api/polls" && req.method === "GET") {
    const roomId = url.searchParams.get("room") || "global";
    if (!canUseRoom(auth.user.id, roomId)) return sendError(res, 403, "Нет доступа к этому чату.");
    const polls = db.polls
      .filter((poll) => poll.roomId === roomId)
      .sort((a, b) => Number(a.closed) - Number(b.closed) || b.createdAt - a.createdAt)
      .slice(0, 60)
      .map((poll) => serializePoll(poll, auth.user.id));
    sendJson(res, 200, { ok: true, polls });
    return;
  }

  if (url.pathname === "/api/polls" && req.method === "POST") {
    if (!rateLimit(req, `poll-create:${auth.user.id}`, 30)) return sendError(res, 429, "Слишком много опросов за минуту.");
    const body = await readBody(req);
    const roomId = String(body.roomId || "global");
    const question = cleanText(body.question, 160);
    const options = (Array.isArray(body.options) ? body.options : [])
      .map((item) => cleanText(item, 80))
      .filter(Boolean)
      .slice(0, 6);
    if (!canUseRoom(auth.user.id, roomId)) return sendError(res, 403, "Нет доступа к этому чату.");
    if (question.length < 3) return sendError(res, 400, "Вопрос слишком короткий.");
    if (options.length < 2) return sendError(res, 400, "Нужно минимум 2 варианта ответа.");
    const poll = {
      id: uid("poll"),
      roomId,
      question,
      options: options.map((text) => ({ id: uid("opt"), text })),
      votes: {},
      closed: false,
      createdBy: auth.user.id,
      createdAt: now()
    };
    db.polls.unshift(poll);
    db.polls = db.polls.slice(0, 1000);
    saveStore();
    pushEvent("features", { roomId, kind: "polls" }, roomTargets(roomId));
    pushEvent("rooms", { roomIds: [roomId] }, roomTargets(roomId));
    sendJson(res, 201, { ok: true, poll: serializePoll(poll, auth.user.id), rooms: listRoomsFor(auth.user.id) });
    return;
  }

  if (url.pathname === "/api/polls/vote" && req.method === "POST") {
    if (!rateLimit(req, `poll-vote:${auth.user.id}`, 120)) return sendError(res, 429, "Слишком много голосований.");
    const body = await readBody(req);
    const poll = db.polls.find((item) => item.id === String(body.pollId || ""));
    const optionId = String(body.optionId || "");
    if (!poll || !canUseRoom(auth.user.id, poll.roomId)) return sendError(res, 404, "Опрос не найден.");
    if (poll.closed) return sendError(res, 400, "Опрос уже закрыт.");
    if (!(poll.options || []).some((option) => option.id === optionId)) return sendError(res, 400, "Такого варианта нет.");
    poll.votes ||= {};
    poll.votes[auth.user.id] = optionId;
    saveStore();
    pushEvent("features", { roomId: poll.roomId, kind: "polls" }, roomTargets(poll.roomId));
    sendJson(res, 200, { ok: true, poll: serializePoll(poll, auth.user.id) });
    return;
  }

  if (url.pathname === "/api/polls/close" && req.method === "POST") {
    const body = await readBody(req);
    const poll = db.polls.find((item) => item.id === String(body.pollId || ""));
    if (!poll || !canUseRoom(auth.user.id, poll.roomId)) return sendError(res, 404, "Опрос не найден.");
    if (!canManageRoomFeature(auth.user.id, poll.roomId, poll.createdBy)) return sendError(res, 403, "Закрыть опрос может автор, админ группы или администратор.");
    poll.closed = true;
    poll.closedAt = now();
    saveStore();
    pushEvent("features", { roomId: poll.roomId, kind: "polls" }, roomTargets(poll.roomId));
    pushEvent("rooms", { roomIds: [poll.roomId] }, roomTargets(poll.roomId));
    sendJson(res, 200, { ok: true, poll: serializePoll(poll, auth.user.id), rooms: listRoomsFor(auth.user.id) });
    return;
  }

  if (url.pathname === "/api/tasks" && req.method === "GET") {
    const roomId = url.searchParams.get("room") || "global";
    if (!canUseRoom(auth.user.id, roomId)) return sendError(res, 403, "Нет доступа к этому чату.");
    const tasks = db.roomTasks
      .filter((task) => task.roomId === roomId)
      .sort((a, b) => (a.status === "done") - (b.status === "done") || (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt))
      .slice(0, 160)
      .map((task) => serializeTask(task, auth.user.id));
    sendJson(res, 200, { ok: true, tasks });
    return;
  }

  if (url.pathname === "/api/tasks" && req.method === "POST") {
    if (!rateLimit(req, `task-create:${auth.user.id}`, 50)) return sendError(res, 429, "Слишком много задач за минуту.");
    const body = await readBody(req);
    const roomId = String(body.roomId || "global");
    const title = cleanText(body.title, 120);
    const details = cleanText(body.details || "", 420);
    const priority = ["low", "normal", "high"].includes(body.priority) ? body.priority : "normal";
    const assigneeId = String(body.assigneeId || "");
    if (!canUseRoom(auth.user.id, roomId)) return sendError(res, 403, "Нет доступа к этому чату.");
    if (title.length < 2) return sendError(res, 400, "Название задачи слишком короткое.");
    if (assigneeId && !roomContainsUser(roomId, assigneeId)) return sendError(res, 400, "Исполнитель должен быть участником этого чата.");
    const task = {
      id: uid("task"),
      roomId,
      title,
      details,
      status: "todo",
      priority,
      assigneeId,
      createdBy: auth.user.id,
      createdAt: now(),
      updatedAt: now(),
      completedAt: 0
    };
    db.roomTasks.unshift(task);
    db.roomTasks = db.roomTasks.slice(0, 1600);
    saveStore();
    pushEvent("features", { roomId, kind: "tasks" }, roomTargets(roomId));
    pushEvent("rooms", { roomIds: [roomId] }, roomTargets(roomId));
    sendJson(res, 201, { ok: true, task: serializeTask(task, auth.user.id), rooms: listRoomsFor(auth.user.id) });
    return;
  }

  if (url.pathname === "/api/tasks/update" && req.method === "POST") {
    if (!rateLimit(req, `task-update:${auth.user.id}`, 120)) return sendError(res, 429, "Слишком много изменений задач.");
    const body = await readBody(req);
    const task = db.roomTasks.find((item) => item.id === String(body.taskId || ""));
    if (!task || !canUseRoom(auth.user.id, task.roomId)) return sendError(res, 404, "Задача не найдена.");
    const action = String(body.action || "update");
    if (action === "delete") {
      if (!canManageRoomFeature(auth.user.id, task.roomId, task.createdBy)) return sendError(res, 403, "Удалить задачу может автор, админ группы или администратор.");
      db.roomTasks = db.roomTasks.filter((item) => item.id !== task.id);
      saveStore();
      pushEvent("features", { roomId: task.roomId, kind: "tasks" }, roomTargets(task.roomId));
      pushEvent("rooms", { roomIds: [task.roomId] }, roomTargets(task.roomId));
      sendJson(res, 200, { ok: true, deleted: true, rooms: listRoomsFor(auth.user.id) });
      return;
    }
    if (body.status && ["todo", "doing", "done"].includes(body.status)) {
      task.status = body.status;
      task.completedAt = task.status === "done" ? now() : 0;
    }
    if (body.priority && ["low", "normal", "high"].includes(body.priority)) task.priority = body.priority;
    if (body.assigneeId !== undefined) {
      const assigneeId = String(body.assigneeId || "");
      if (assigneeId && !roomContainsUser(task.roomId, assigneeId)) return sendError(res, 400, "Исполнитель должен быть участником этого чата.");
      task.assigneeId = assigneeId;
    }
    if (body.title !== undefined) {
      const title = cleanText(body.title, 120);
      if (title.length < 2) return sendError(res, 400, "Название задачи слишком короткое.");
      task.title = title;
    }
    if (body.details !== undefined) task.details = cleanText(body.details, 420);
    task.updatedAt = now();
    saveStore();
    pushEvent("features", { roomId: task.roomId, kind: "tasks" }, roomTargets(task.roomId));
    pushEvent("rooms", { roomIds: [task.roomId] }, roomTargets(task.roomId));
    sendJson(res, 200, { ok: true, task: serializeTask(task, auth.user.id), rooms: listRoomsFor(auth.user.id) });
    return;
  }

  if (url.pathname === "/api/room-events" && req.method === "GET") {
    const roomId = url.searchParams.get("room") || "global";
    if (!canUseRoom(auth.user.id, roomId)) return sendError(res, 403, "Нет доступа к этому чату.");
    const events = db.roomEvents
      .filter((event) => event.roomId === roomId)
      .sort((a, b) => Number(a.cancelled) - Number(b.cancelled) || Number(a.startsAt || 0) - Number(b.startsAt || 0))
      .slice(0, 100)
      .map((event) => serializeRoomEvent(event, auth.user.id));
    sendJson(res, 200, { ok: true, events });
    return;
  }

  if (url.pathname === "/api/room-events" && req.method === "POST") {
    if (!rateLimit(req, `room-event-create:${auth.user.id}`, 30)) return sendError(res, 429, "Слишком много событий за минуту.");
    const body = await readBody(req);
    const roomId = String(body.roomId || "global");
    const title = cleanText(body.title, 120);
    const details = cleanText(body.details || "", 420);
    const location = cleanText(body.location || "", 120);
    const startsAt = Number(body.startsAt || 0);
    if (!canUseRoom(auth.user.id, roomId)) return sendError(res, 403, "Нет доступа к этому чату.");
    if (title.length < 2) return sendError(res, 400, "Название события слишком короткое.");
    if (!Number.isFinite(startsAt) || startsAt < now() - 24 * 60 * 60 * 1000) return sendError(res, 400, "Нужно выбрать нормальное время события.");
    const event = {
      id: uid("event"),
      roomId,
      title,
      details,
      location,
      startsAt,
      rsvps: { [auth.user.id]: "yes" },
      cancelled: false,
      createdBy: auth.user.id,
      createdAt: now(),
      updatedAt: now()
    };
    db.roomEvents.unshift(event);
    db.roomEvents = db.roomEvents.slice(0, 1000);
    saveStore();
    pushEvent("features", { roomId, kind: "events" }, roomTargets(roomId));
    pushEvent("rooms", { roomIds: [roomId] }, roomTargets(roomId));
    sendJson(res, 201, { ok: true, event: serializeRoomEvent(event, auth.user.id), rooms: listRoomsFor(auth.user.id) });
    return;
  }

  if (url.pathname === "/api/room-events/rsvp" && req.method === "POST") {
    if (!rateLimit(req, `room-event-rsvp:${auth.user.id}`, 120)) return sendError(res, 429, "Слишком много RSVP.");
    const body = await readBody(req);
    const event = db.roomEvents.find((item) => item.id === String(body.eventId || ""));
    const answer = ["yes", "maybe", "no"].includes(body.answer) ? body.answer : "";
    if (!event || !canUseRoom(auth.user.id, event.roomId)) return sendError(res, 404, "Событие не найдено.");
    if (event.cancelled) return sendError(res, 400, "Событие отменено.");
    event.rsvps ||= {};
    if (answer) event.rsvps[auth.user.id] = answer;
    else delete event.rsvps[auth.user.id];
    event.updatedAt = now();
    saveStore();
    pushEvent("features", { roomId: event.roomId, kind: "events" }, roomTargets(event.roomId));
    sendJson(res, 200, { ok: true, event: serializeRoomEvent(event, auth.user.id) });
    return;
  }

  if (url.pathname === "/api/room-events/cancel" && req.method === "POST") {
    const body = await readBody(req);
    const event = db.roomEvents.find((item) => item.id === String(body.eventId || ""));
    if (!event || !canUseRoom(auth.user.id, event.roomId)) return sendError(res, 404, "Событие не найдено.");
    if (!canManageRoomFeature(auth.user.id, event.roomId, event.createdBy)) return sendError(res, 403, "Отменить событие может автор, админ группы или администратор.");
    event.cancelled = true;
    event.updatedAt = now();
    saveStore();
    pushEvent("features", { roomId: event.roomId, kind: "events" }, roomTargets(event.roomId));
    pushEvent("rooms", { roomIds: [event.roomId] }, roomTargets(event.roomId));
    sendJson(res, 200, { ok: true, event: serializeRoomEvent(event, auth.user.id), rooms: listRoomsFor(auth.user.id) });
    return;
  }

  if (url.pathname === "/api/scheduled-messages" && req.method === "GET") {
    const roomId = String(url.searchParams.get("roomId") || "");
    if (!roomId || !canSendToRoom(auth.user.id, roomId)) return sendError(res, 403, "Нет доступа к этому чату.");
    const items = (db.scheduledMessages || [])
      .filter((item) => item.senderId === auth.user.id && item.roomId === roomId)
      .sort((a, b) => Number(a.sendAt || 0) - Number(b.sendAt || 0))
      .map((item) => ({
        id: item.id,
        roomId: item.roomId,
        text: item.text,
        sendAt: item.sendAt,
        createdAt: item.createdAt
      }));
    sendJson(res, 200, { ok: true, items });
    return;
  }

  if (url.pathname === "/api/scheduled-messages" && req.method === "POST") {
    if (!rateLimit(req, `schedule-message:${auth.user.id}`, 30, 60 * 60 * 1000)) return sendError(res, 429, "Слишком много отложенных сообщений за час.");
    const body = await readBody(req);
    const roomId = String(body.roomId || "");
    const text = cleanText(body.text, 1200);
    const sendAt = Number(body.sendAt || 0);
    if (!roomId || !canSendToRoom(auth.user.id, roomId)) return sendError(res, 403, "Нет доступа к этому чату.");
    if (!text) return sendError(res, 400, "Отложенное сообщение пустое.");
    if (sendAt < now() + 30 * 1000) return sendError(res, 400, "Выбери время хотя бы через 30 секунд.");
    if (sendAt > now() + 14 * 24 * 60 * 60 * 1000) return sendError(res, 400, "Можно отложить максимум на 14 дней.");
    const ownQueue = (db.scheduledMessages || []).filter((item) => item.senderId === auth.user.id);
    if (ownQueue.length >= 50) return sendError(res, 409, "У тебя уже 50 отложенных сообщений. Удали старые из очереди.");
    const item = {
      id: uid("schedule"),
      roomId,
      senderId: auth.user.id,
      text,
      sendAt,
      createdAt: now()
    };
    db.scheduledMessages.push(item);
    recordSecurityEvent("scheduled-message-created", auth.user.id, { roomId, sendAt });
    saveStore();
    sendJson(res, 201, { ok: true, item });
    return;
  }

  if (url.pathname === "/api/scheduled-messages/delete" && req.method === "POST") {
    const body = await readBody(req);
    const id = String(body.id || "");
    const before = db.scheduledMessages.length;
    db.scheduledMessages = db.scheduledMessages.filter((item) => !(item.id === id && item.senderId === auth.user.id));
    if (before === db.scheduledMessages.length) return sendError(res, 404, "Отложенное сообщение не найдено.");
    saveStore();
    sendJson(res, 200, { ok: true });
    return;
  }

  if (url.pathname === "/api/messages" && req.method === "GET") {
    const roomId = url.searchParams.get("room") || "global";
    const after = Number(url.searchParams.get("after") || 0);
    const q = cleanText(url.searchParams.get("q") || "", 80).toLowerCase();
    const savedOnly = url.searchParams.get("saved") === "1";
    if (!canUseRoom(auth.user.id, roomId)) return sendError(res, 403, "Нет доступа к этому чату.");
    let messages = db.messages.filter((message) => message.roomId === roomId && canSeeMessage(auth.user.id, message));
    if (savedOnly) {
      const saved = new Set(auth.user.savedMessageIds || []);
      messages = messages.filter((message) => saved.has(message.id));
    }
    if (Number.isFinite(after) && after > 0) messages = messages.filter((message) => message.createdAt > after);
    if (q) {
      messages = messages.filter((message) => (
        !message.deletedAt && (
          String(message.text || "").toLowerCase().includes(q) ||
          (message.attachments || []).some((file) => String(file.name || "").toLowerCase().includes(q))
        )
      ));
    }
    messages = messages.slice(q ? -40 : -100);
    sendJson(res, 200, {
      ok: true,
      messages: messages.map((message) => serializeMessage(message, auth.user.id)),
      pins: pinnedMessages(roomId, auth.user.id)
    });
    return;
  }

  if (url.pathname === "/api/media" && req.method === "GET") {
    const roomId = url.searchParams.get("room") || "global";
    if (!canUseRoom(auth.user.id, roomId)) return sendError(res, 403, "Нет доступа к этому чату.");
    const items = [];
    for (const message of db.messages) {
      if (message.roomId !== roomId || message.deletedAt || !canSeeMessage(auth.user.id, message)) continue;
      for (const attachment of message.attachments || []) {
        items.push({
          ...attachment,
          messageId: message.id,
          sender: publicUser(userById(message.senderId)),
          createdAt: message.createdAt
        });
      }
    }
    sendJson(res, 200, { ok: true, items: items.slice(-120).reverse() });
    return;
  }

  if (url.pathname === "/api/messages" && req.method === "POST") {
    if (!rateLimit(req, `message:${auth.user.id}`, 120)) return sendError(res, 429, "Слишком много сообщений. Подожди минуту.");
    const body = await readBody(req);
    let roomId = String(body.roomId || "global");
    const text = cleanText(body.text, 1200);
    if (body.toUserId) roomId = dmRoom(auth.user.id, String(body.toUserId));
    if (!text && !body.attachment) return sendError(res, 400, "Сообщение пустое.");
    if (!canSendToRoom(auth.user.id, roomId)) return sendError(res, 403, "Нет доступа к этому чату или пользователь заблокирован.");
    if (roomId.startsWith("dm:")) {
      const parts = dmParticipants(roomId);
      if (parts.length !== 2 || !parts.every((id) => db.users.some((user) => user.id === id))) {
        return sendError(res, 404, "Пользователь не найден.");
      }
    }
    let replyToId = String(body.replyToId || "");
    if (replyToId) {
      const replySource = db.messages.find((item) => item.id === replyToId && item.roomId === roomId && !item.deletedAt);
      if (!replySource || !canSeeMessage(auth.user.id, replySource)) replyToId = "";
    }
    const attachments = body.attachment ? [saveUpload(body.attachment, { maxBytes: MAX_FILE_BYTES })] : [];
    const message = {
      id: uid("msg"),
      roomId,
      senderId: auth.user.id,
      text,
      attachments,
      replyToId,
      reactions: {},
      readBy: [],
      createdAt: now()
    };
    appendMessage(message);
    auth.user.lastSeen = now();
    saveStore();
    publishMessage(message);
    sendJson(res, 201, { ok: true, message: serializeMessage(message, auth.user.id), rooms: listRoomsFor(auth.user.id) });
    return;
  }

  if (url.pathname === "/api/messages/forward" && req.method === "POST") {
    if (!rateLimit(req, `message-forward:${auth.user.id}`, 80)) return sendError(res, 429, "Слишком много пересылок. Подожди минуту.");
    const body = await readBody(req);
    const source = findMessageForUser(String(body.messageId || ""), auth.user.id);
    const roomId = String(body.roomId || "global");
    if (!source || source.deletedAt) return sendError(res, 404, "Сообщение не найдено.");
    if (!canSendToRoom(auth.user.id, roomId)) return sendError(res, 403, "Нет доступа к целевому чату.");
    if (roomId.startsWith("dm:")) {
      const parts = dmParticipants(roomId);
      if (parts.length !== 2 || !parts.every((id) => db.users.some((user) => user.id === id))) {
        return sendError(res, 404, "Пользователь не найден.");
      }
    }
    if (!source.text && !(source.attachments || []).length) return sendError(res, 400, "Это сообщение нельзя переслать.");
    const originalSender = userById(source.senderId);
    const message = {
      id: uid("msg"),
      roomId,
      senderId: auth.user.id,
      text: source.text || "",
      attachments: (source.attachments || []).map((file) => ({ ...file })),
      replyToId: "",
      forwardedFrom: {
        messageId: source.id,
        roomId: source.roomId,
        senderId: source.senderId,
        senderName: originalSender?.nickname || "Пользователь",
        createdAt: source.createdAt
      },
      reactions: {},
      readBy: [],
      createdAt: now()
    };
    db.messages.push(message);
    if (db.messages.length > MAX_MESSAGES) db.messages = db.messages.slice(-MAX_MESSAGES);
    auth.user.lastSeen = now();
    saveStore();
    for (const [id, client] of clients) {
      if (!messageTargets(message).includes(client.userId)) continue;
      try {
        client.res.write(`event: message\ndata: ${safeJson({ message: serializeMessage(message, client.userId), rooms: roomTargets(roomId) === "all" ? null : roomTargets(roomId) })}\n\n`);
      } catch {
        clients.delete(id);
      }
    }
    pushEvent("rooms", { roomIds: [roomId] }, roomTargets(roomId));
    sendPushNotifications(message).catch(() => {});
    sendJson(res, 201, { ok: true, message: serializeMessage(message, auth.user.id), rooms: listRoomsFor(auth.user.id) });
    return;
  }

  if (url.pathname === "/api/messages/edit" && req.method === "POST") {
    const body = await readBody(req);
    const message = findMessageForUser(String(body.messageId || ""), auth.user.id);
    const text = cleanText(body.text, 1200);
    if (!message) return sendError(res, 404, "Сообщение не найдено.");
    if (message.senderId !== auth.user.id) return sendError(res, 403, "Редактировать можно только свои сообщения.");
    if (message.deletedAt) return sendError(res, 400, "Удаленное сообщение нельзя редактировать.");
    if (!text) return sendError(res, 400, "Текст не может быть пустым.");
    message.text = text;
    message.editedAt = now();
    saveStore();
    pushMessageUpdate(message);
    pushEvent("rooms", { roomIds: [message.roomId] }, roomTargets(message.roomId));
    sendJson(res, 200, { ok: true, message: serializeMessage(message, auth.user.id) });
    return;
  }

  if (url.pathname === "/api/messages/delete" && req.method === "POST") {
    const body = await readBody(req);
    const message = findMessageForUser(String(body.messageId || ""), auth.user.id);
    if (!message) return sendError(res, 404, "Сообщение не найдено.");
    if (message.senderId !== auth.user.id) return sendError(res, 403, "Удалить можно только свои сообщения.");
    message.text = "";
    message.attachments = [];
    message.deletedAt = now();
    for (const user of db.users) {
      user.savedMessageIds = (user.savedMessageIds || []).filter((id) => id !== message.id);
    }
    cleanPinList(message.roomId);
    saveStore();
    pushMessageUpdate(message);
    pushEvent("rooms", { roomIds: [message.roomId] }, roomTargets(message.roomId));
    pushPins(message.roomId);
    sendJson(res, 200, { ok: true, message: serializeMessage(message, auth.user.id), pins: pinnedMessages(message.roomId, auth.user.id) });
    return;
  }

  if (url.pathname === "/api/messages/react" && req.method === "POST") {
    const body = await readBody(req);
    const message = findMessageForUser(String(body.messageId || ""), auth.user.id);
    const emoji = String(body.emoji || "");
    if (!message || message.deletedAt) return sendError(res, 404, "Сообщение не найдено.");
    if (emoji && !ALLOWED_REACTIONS.has(emoji)) return sendError(res, 400, "Такую реакцию пока нельзя поставить.");
    message.reactions ||= {};
    if (!emoji || message.reactions[auth.user.id] === emoji) delete message.reactions[auth.user.id];
    else message.reactions[auth.user.id] = emoji;
    saveStore();
    pushMessageUpdate(message);
    sendJson(res, 200, { ok: true, message: serializeMessage(message, auth.user.id) });
    return;
  }

  if (url.pathname === "/api/messages/save" && req.method === "POST") {
    const body = await readBody(req);
    const message = findMessageForUser(String(body.messageId || ""), auth.user.id);
    const action = body.action === "unsave" ? "unsave" : "save";
    if (!message || message.deletedAt) return sendError(res, 404, "Сообщение не найдено.");
    auth.user.savedMessageIds ||= [];
    if (action === "save" && !auth.user.savedMessageIds.includes(message.id)) {
      auth.user.savedMessageIds.unshift(message.id);
    }
    if (action === "unsave") {
      auth.user.savedMessageIds = auth.user.savedMessageIds.filter((id) => id !== message.id);
    }
    auth.user.savedMessageIds = auth.user.savedMessageIds
      .filter((id) => db.messages.some((item) => item.id === id && !item.deletedAt && canSeeMessage(auth.user.id, item)))
      .slice(0, 500);
    saveStore();
    sendJson(res, 200, {
      ok: true,
      message: serializeMessage(message, auth.user.id),
      savedMessageIds: auth.user.savedMessageIds
    });
    return;
  }

  if (url.pathname === "/api/messages/pin" && req.method === "POST") {
    const body = await readBody(req);
    const message = findMessageForUser(String(body.messageId || ""), auth.user.id);
    const action = body.action === "unpin" ? "unpin" : "pin";
    if (!message || message.deletedAt) return sendError(res, 404, "Сообщение не найдено.");
    db.roomPins ||= {};
    const pins = db.roomPins[message.roomId] || [];
    if (action === "pin" && !pins.includes(message.id)) pins.unshift(message.id);
    if (action === "unpin") db.roomPins[message.roomId] = pins.filter((id) => id !== message.id);
    db.roomPins[message.roomId] = (db.roomPins[message.roomId] || pins).slice(0, 5);
    cleanPinList(message.roomId);
    saveStore();
    pushPins(message.roomId);
    sendJson(res, 200, { ok: true, pins: pinnedMessages(message.roomId, auth.user.id) });
    return;
  }

  if (url.pathname === "/api/read" && req.method === "POST") {
    const body = await readBody(req);
    const roomId = String(body.roomId || "global");
    if (!canUseRoom(auth.user.id, roomId)) return sendError(res, 403, "Нет доступа к этому чату.");
    const lastMessageId = String(body.lastMessageId || "");
    const lastMessage = lastMessageId ? db.messages.find((message) => message.id === lastMessageId && message.roomId === roomId) : null;
    const maxTime = lastMessage?.createdAt || now();
    let changed = false;
    for (const message of db.messages) {
      if (message.roomId !== roomId || message.senderId === auth.user.id || message.createdAt > maxTime || !canSeeMessage(auth.user.id, message)) continue;
      message.readBy ||= [];
      if (!message.readBy.includes(auth.user.id)) {
        message.readBy.push(auth.user.id);
        changed = true;
      }
    }
    if (changed) {
      saveStore();
      pushEvent("read", { roomId, userId: auth.user.id, at: now() }, roomTargets(roomId));
    }
    sendJson(res, 200, { ok: true });
    return;
  }

  if (url.pathname === "/api/typing" && req.method === "POST") {
    if (!rateLimit(req, `typing:${auth.user.id}`, 60)) return sendError(res, 429, "Слишком много typing-событий.");
    const body = await readBody(req);
    const roomId = String(body.roomId || "global");
    if (!canSendToRoom(auth.user.id, roomId)) return sendError(res, 403, "Нет доступа к этому чату.");
    pushEvent("typing", {
      roomId,
      user: publicUser(auth.user),
      expiresAt: now() + 3200
    }, roomTargetsExcept(roomId, auth.user.id).filter((id) => !isBlockedBetween(id, auth.user.id)));
    sendJson(res, 200, { ok: true });
    return;
  }

  if (url.pathname === "/api/events" && req.method === "GET") {
    const clientId = uid("sse");
    res.writeHead(200, {
      ...SECURITY_HEADERS,
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "connection": "keep-alive"
    });
    res.write(`event: hello\ndata: ${safeJson({ ok: true, time: now() })}\n\n`);
    clients.set(clientId, { id: clientId, userId: auth.user.id, res });
    pruneCallInvites();
    for (const invite of db.callInvites.filter((item) => item.targetUserId === auth.user.id && !isBlockedBetween(auth.user.id, item.from?.id))) {
      res.write(`event: call\ndata: ${safeJson(invite)}\n\n`);
    }
    auth.user.lastSeen = now();
    saveStore();
    pushUserLists();
    req.on("close", () => {
      clients.delete(clientId);
      pushUserLists();
    });
    return;
  }

  sendError(res, 404, "API не найден.");
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  try {
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
      return;
    }
    if (url.pathname.startsWith("/uploads/")) {
      await serveUpload(req, res, url);
      return;
    }
    serveStatic(req, res, decodeURIComponent(url.pathname));
  } catch (error) {
    const status = Number(error.statusCode || 500);
    if (status >= 500) console.error(error);
    if (!res.headersSent) {
      sendError(res, status >= 400 && status < 500 ? status : 500, status >= 400 && status < 500 ? error.message : "Ошибка сервера. Попробуй позже.");
    }
  }
});

server.on("clientError", (error, socket) => {
  try {
    socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
  } catch {}
});

server.headersTimeout = 15000;
server.requestTimeout = 45000;
server.keepAliveTimeout = 5000;

async function startServer() {
  await initPostgresStore().catch((error) => {
    postgresReady = false;
    console.error("PostgreSQL init failed, falling back to JSON storage:", error.message);
  });
  initSecurityState();
  initWebPush();
  deliverScheduledMessages();
  const scheduleTimer = setInterval(deliverScheduledMessages, 15000);
  scheduleTimer.unref?.();
  server.listen(PORT, "0.0.0.0", () => {
    const storage = postgresReady ? "PostgreSQL + JSON backup" : "JSON";
    console.log(`Orbit Chat ${APP_VERSION} is running on http://127.0.0.1:${PORT} (${storage})`);
  });
}

startServer().catch((error) => {
  console.error("Orbit Chat failed to start:", error);
  process.exitCode = 1;
});
