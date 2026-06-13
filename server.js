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
const PASSWORD_RESET_HOURS = 1;
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
  "/maskable-icon-512.png"
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
    schemaVersion: 4,
    users: [],
    sessions: [],
    messages: [],
    groups: [],
    roomPins: {},
    callInvites: [],
    pushSubscriptions: [],
    vapidKeys: null,
    reports: [],
    security: {},
    securityEvents: [],
    createdAt: new Date().toISOString()
  };
}

function normalizeStore(parsed) {
  const store = parsed && typeof parsed === "object" ? parsed : freshStore();
  store.schemaVersion = Math.max(Number(store.schemaVersion || 0), 4);
  store.users ||= [];
  store.sessions ||= [];
  store.messages ||= [];
  store.groups ||= [];
  store.roomPins ||= {};
  store.callInvites ||= [];
  store.pushSubscriptions ||= [];
  store.reports ||= [];
  store.security ||= {};
  store.securityEvents ||= [];
  for (const user of store.users) {
    user.contactIds ||= [];
    user.blockedUserIds ||= [];
    if (typeof user.emailVerified !== "boolean") user.emailVerified = true;
    user.pendingEmail ||= "";
    user.passwordResetHash ||= "";
    user.passwordResetExpiresAt ||= 0;
    user.passwordResetSentAt ||= 0;
  }
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

function publicUser(user, includeEmail = false) {
  if (!user) return null;
  return {
    id: user.id,
    email: includeEmail ? user.email : undefined,
    emailVerified: includeEmail ? Boolean(user.emailVerified) : undefined,
    pendingEmail: includeEmail ? (user.pendingEmail || "") : undefined,
    mailConfigured: includeEmail ? mailConfigured() : undefined,
    isAdmin: includeEmail ? isAdmin(user) : undefined,
    nickname: user.nickname,
    avatarColor: user.avatarColor,
    avatarUrl: user.avatarUrl || "",
    contactIds: includeEmail ? (user.contactIds || []) : undefined,
    blockedUserIds: includeEmail ? (user.blockedUserIds || []) : undefined,
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
  if (roomId === "global") return true;
  if (String(roomId || "").startsWith("group:")) {
    const group = db.groups.find((item) => item.id === groupIdFromRoom(roomId));
    return Boolean(group && group.memberIds.includes(userId));
  }
  const parts = dmParticipants(roomId);
  return parts.length === 2 && parts.includes(userId);
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
  const { mimeType, buffer } = decodeUpload(input);
  if (!buffer.length) throw userError("Файл пустой.");
  if (buffer.length > maxBytes) throw userError(`Файл слишком большой. Максимум ${Math.round(maxBytes / 1024 / 1024)} МБ.`, 413);
  const sniffedMime = sniffMime(buffer);
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
  const targetIds = usersForRoom(message.roomId, message.senderId);
  return sendPushToUsers(targetIds, {
    title: pushTitleFor(message),
    body: pushBodyFor(message),
    url: pushUrlFor(message.roomId),
    roomId: message.roomId,
    messageId: message.id,
    tag: message.roomId
  });
}

function listRoomsFor(userId) {
  const directRoomIds = new Set();
  for (const message of db.messages) {
    if (message.roomId.startsWith("dm:") && dmParticipants(message.roomId).includes(userId)) {
      directRoomIds.add(message.roomId);
    }
  }
  const rooms = [{
    id: "global",
    type: "global",
    title: "Общий чат",
    subtitle: "Все пользователи Orbit Chat",
    lastMessage: lastMessageFor("global", userId),
    unreadCount: unreadCountForRoom(userId, "global")
  }];
  for (const roomId of directRoomIds) {
    const otherId = dmParticipants(roomId).find((id) => id !== userId);
    const other = db.users.find((user) => user.id === otherId);
    rooms.push({
      id: roomId,
      type: "direct",
      title: other?.nickname || "Личный чат",
      user: publicUserFor(other, userById(userId)),
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
      lastMessage: lastMessageFor(groupRoom(group.id), userId),
      unreadCount: unreadCountForRoom(userId, groupRoom(group.id))
    });
  }
  rooms.sort((a, b) => (b.lastMessage?.createdAt || 0) - (a.lastMessage?.createdAt || 0));
  return rooms;
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

  if (url.pathname === "/api/register" && req.method === "POST") {
    if (!rateLimit(req, "register", 15)) return sendError(res, 429, "Слишком много попыток. Подожди минуту.");
    const body = await readBody(req);
    const email = normalizeEmail(body.email);
    const nickname = cleanText(body.nickname, 24);
    const password = String(body.password || "");
    const passwordError = validatePasswordStrength(password);
    if (!validateEmail(email)) return sendError(res, 400, "Введи нормальную почту.");
    if (nickname.length < 2) return sendError(res, 400, "Ник должен быть минимум 2 символа.");
    if (passwordError) return sendError(res, 400, passwordError);
    if (db.users.some((user) => user.email === email)) return sendError(res, 409, "Такой email уже зарегистрирован.");
    if (db.users.some((user) => user.nickname.toLowerCase() === nickname.toLowerCase())) {
      return sendError(res, 409, "Такой ник уже занят.");
    }
    const { salt, hash, iterations } = hashPassword(password);
    const user = {
      id: uid("user"),
      email,
      nickname,
      passwordSalt: salt,
      passwordHash: hash,
      passwordIterations: iterations,
      avatarColor: avatarColor(email + nickname),
      bio: "",
      contactIds: [],
      emailVerified: false,
      pendingEmail: "",
      lastSeen: now(),
      createdAt: now()
    };
    const verificationToken = makeEmailVerification(user, email, "register");
    const token = makeToken();
    db.users.push(user);
    db.sessions.push({
      token,
      userId: user.id,
      createdAt: now(),
      expiresAt: now() + SESSION_DAYS * 24 * 60 * 60 * 1000
    });
    recordSecurityEvent("registered", user.id, { ip: requesterIp(req) });
    saveStore();
    const emailVerification = await sendVerificationEmail(req, user, email, verificationToken, "register").catch((error) => {
      recordSecurityEvent("email-verification-failed", user.id, { email, error: error.message });
      return { sent: false, provider: "error", error: "Письмо подтверждения не отправилось. Проверь SMTP/Resend настройки на Render." };
    });
    saveStore();
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
    const token = makeToken();
    clearLoginFailures(req, email);
    user.lastSeen = now();
    upgradePasswordHashIfNeeded(password, user);
    db.sessions.push({
      token,
      userId: user.id,
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
    const verificationToken = makeEmailVerification(auth.user, targetEmail, purpose);
    const emailVerification = await sendVerificationEmail(req, auth.user, targetEmail, verificationToken, purpose).catch((error) => {
      recordSecurityEvent("email-verification-failed", auth.user.id, { email: targetEmail, error: error.message });
      return { sent: false, provider: "error", error: "Письмо подтверждения не отправилось. Проверь SMTP/Resend настройки на Render." };
    });
    saveStore();
    sendJson(res, 200, { ok: true, user: publicUser(auth.user, true), emailVerification });
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
      const verificationToken = makeEmailVerification(auth.user, newEmail, "change");
      emailVerification = await sendVerificationEmail(req, auth.user, newEmail, verificationToken, "change").catch((error) => {
        recordSecurityEvent("email-verification-failed", auth.user.id, { email: newEmail, error: error.message });
        return { sent: false, provider: "error", error: "Письмо подтверждения не отправилось. Проверь SMTP/Resend настройки на Render." };
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
    let users = db.users.filter((user) => user.id !== auth.user.id && !isBlockedBy(user.id, auth.user.id));
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

  if (url.pathname === "/api/messages" && req.method === "GET") {
    const roomId = url.searchParams.get("room") || "global";
    const after = Number(url.searchParams.get("after") || 0);
    const q = cleanText(url.searchParams.get("q") || "", 80).toLowerCase();
    if (!canUseRoom(auth.user.id, roomId)) return sendError(res, 403, "Нет доступа к этому чату.");
    let messages = db.messages.filter((message) => message.roomId === roomId && canSeeMessage(auth.user.id, message));
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
  server.listen(PORT, "0.0.0.0", () => {
    const storage = postgresReady ? "PostgreSQL + JSON backup" : "JSON";
    console.log(`Orbit Chat ${APP_VERSION} is running on http://127.0.0.1:${PORT} (${storage})`);
  });
}

startServer().catch((error) => {
  console.error("Orbit Chat failed to start:", error);
  process.exitCode = 1;
});
