const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { version: APP_VERSION } = require("./package.json");
let webPush = null;

try {
  webPush = require("web-push");
} catch {
  webPush = null;
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
let SESSION_SECRET = process.env.SESSION_SECRET || "";
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || "mailto:orbit-chat@example.com";
const ALLOWED_REACTIONS = new Set(["👍", "❤️", "😂", "🔥", "😮", "😢"]);
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
    const seed = {
      users: [],
      sessions: [],
      messages: [],
      groups: [],
      roomPins: {},
      callInvites: [],
      pushSubscriptions: [],
      vapidKeys: null,
      security: {},
      securityEvents: [],
      createdAt: new Date().toISOString()
    };
    fs.writeFileSync(DATA_FILE, JSON.stringify(seed, null, 2));
  }
}

function loadStore() {
  ensureStore();
  try {
    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    parsed.users ||= [];
    parsed.sessions ||= [];
    parsed.messages ||= [];
    parsed.groups ||= [];
    parsed.roomPins ||= {};
    parsed.callInvites ||= [];
    parsed.pushSubscriptions ||= [];
    parsed.security ||= {};
    parsed.securityEvents ||= [];
    for (const user of parsed.users) user.contactIds ||= [];
    for (const message of parsed.messages) {
      message.attachments ||= [];
      message.reactions ||= {};
      message.readBy ||= [];
    }
    return parsed;
  } catch (error) {
    const backup = `${DATA_FILE}.broken-${Date.now()}`;
    if (fs.existsSync(DATA_FILE)) fs.copyFileSync(DATA_FILE, backup);
    const fresh = { users: [], sessions: [], messages: [], groups: [], roomPins: {}, callInvites: [], pushSubscriptions: [], vapidKeys: null, security: {}, securityEvents: [], createdAt: new Date().toISOString() };
    fs.writeFileSync(DATA_FILE, JSON.stringify(fresh, null, 2));
    return fresh;
  }
}

let db = loadStore();

function saveStore() {
  const temp = `${DATA_FILE}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(db, null, 2));
  fs.renameSync(temp, DATA_FILE);
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

initSecurityState();

function initWebPush() {
  if (!webPush) return;
  if (!db.vapidKeys?.publicKey || !db.vapidKeys?.privateKey) {
    db.vapidKeys = webPush.generateVAPIDKeys();
    saveStore();
  }
  webPush.setVapidDetails(VAPID_SUBJECT, db.vapidKeys.publicKey, db.vapidKeys.privateKey);
}

initWebPush();

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function cleanText(text, max = 1000) {
  return String(text || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function validateEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
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
    nickname: user.nickname,
    avatarColor: user.avatarColor,
    avatarUrl: user.avatarUrl || "",
    contactIds: includeEmail ? (user.contactIds || []) : undefined,
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
  }
  return data;
}

function onlineUserIds() {
  const ids = new Set();
  for (const client of clients.values()) ids.add(client.userId);
  return ids;
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
  return {
    id: message.id,
    roomId: message.roomId,
    senderId: message.senderId,
    sender: publicUser(db.users.find((user) => user.id === message.senderId)),
    text: message.deletedAt ? "" : message.text,
    attachments: message.attachments || [],
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

function publicGroup(group) {
  if (!group) return null;
  return {
    id: group.id,
    roomId: groupRoom(group.id),
    name: group.name,
    ownerId: group.ownerId,
    memberIds: group.memberIds || [],
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

function findMessageForUser(messageId, userId) {
  const message = db.messages.find((item) => item.id === messageId);
  if (!message || !canUseRoom(userId, message.roomId)) return null;
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
  pushEvent("message-update", { message: serializeMessage(message) }, roomTargets(message.roomId));
}

function cleanPinList(roomId) {
  const ids = db.roomPins?.[roomId] || [];
  db.roomPins[roomId] = ids.filter((id) => db.messages.some((message) => message.id === id && !message.deletedAt));
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
  return ids.filter((id) => id && id !== senderId);
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
  )).length;
}

function unreadCountForRoom(userId, roomId) {
  return db.messages.filter((message) => (
    message.roomId === roomId
    && message.senderId !== userId
    && !message.deletedAt
    && !message.readBy?.includes(userId)
    && canUseRoom(userId, message.roomId)
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
    lastMessage: lastMessageFor("global"),
    unreadCount: unreadCountForRoom(userId, "global")
  }];
  for (const roomId of directRoomIds) {
    const otherId = dmParticipants(roomId).find((id) => id !== userId);
    const other = db.users.find((user) => user.id === otherId);
    rooms.push({
      id: roomId,
      type: "direct",
      title: other?.nickname || "Личный чат",
      user: publicUser(other),
      lastMessage: lastMessageFor(roomId),
      unreadCount: unreadCountForRoom(userId, roomId)
    });
  }
  for (const group of db.groups.filter((item) => item.memberIds.includes(userId))) {
    rooms.push({
      id: groupRoom(group.id),
      type: "group",
      title: group.name,
      group: publicGroup(group),
      subtitle: `${group.memberIds.length} участников`,
      lastMessage: lastMessageFor(groupRoom(group.id)),
      unreadCount: unreadCountForRoom(userId, groupRoom(group.id))
    });
  }
  rooms.sort((a, b) => (b.lastMessage?.createdAt || 0) - (a.lastMessage?.createdAt || 0));
  return rooms;
}

function lastMessageFor(roomId) {
  for (let index = db.messages.length - 1; index >= 0; index -= 1) {
    if (db.messages[index].roomId === roomId) return serializeMessage(db.messages[index]);
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
    && (message.attachments || []).some((file) => file.url === uploadPath)
  ));
}

function shouldDownloadUpload(fileName) {
  const type = contentTypeForUpload(fileName);
  return !type.startsWith("image/") && !type.startsWith("audio/");
}

function serveUpload(req, res, url) {
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
  if (!normalized.startsWith(`${uploadRoot}${path.sep}`) || !fs.existsSync(normalized)) {
    res.writeHead(404, { ...SECURITY_HEADERS, "content-type": "text/plain; charset=utf-8" });
    res.end("Not found");
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
      dataDir: DATA_DIR,
      persistentDisk: DATA_DIR === "/var/data"
    });
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
      lastSeen: now(),
      createdAt: now()
    };
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
    pushEvent("users", { users: db.users.map((item) => publicUser(item)) });
    sendJson(res, 201, { ok: true, token, user: publicUser(user, true), rooms: listRoomsFor(user.id) }, {
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
    pushEvent("users", { users: db.users.map((item) => publicUser(item)) });
    sendJson(res, 200, { ok: true, token, user: publicUser(user, true), rooms: listRoomsFor(user.id) }, {
      "set-cookie": sessionCookie(req, token)
    });
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
      users: db.users.map((user) => publicUserFor(user, auth.user)),
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
    if (nickname.length < 2) return sendError(res, 400, "Ник должен быть минимум 2 символа.");
    const nicknameBusy = db.users.some((user) => user.id !== auth.user.id && user.nickname.toLowerCase() === nickname.toLowerCase());
    if (nicknameBusy) return sendError(res, 409, "Такой ник уже занят.");
    auth.user.nickname = nickname;
    auth.user.bio = bio;
    if (body.removeAvatar) auth.user.avatarUrl = "";
    if (body.avatar) auth.user.avatarUrl = saveUpload(body.avatar, { maxBytes: MAX_AVATAR_BYTES, imagesOnly: true }).url;
    saveStore();
    pushEvent("users", { users: db.users.map((item) => publicUser(item)) });
    sendJson(res, 200, { ok: true, user: publicUser(auth.user, true) });
    return;
  }

  if (url.pathname === "/api/contacts" && req.method === "POST") {
    if (!rateLimit(req, `contacts:${auth.user.id}`, 80)) return sendError(res, 429, "Слишком много действий с контактами.");
    const body = await readBody(req);
    const userId = String(body.userId || "");
    const target = db.users.find((user) => user.id === userId);
    if (!target || target.id === auth.user.id) return sendError(res, 404, "Пользователь не найден.");
    auth.user.contactIds ||= [];
    const exists = auth.user.contactIds.includes(target.id);
    const shouldAdd = body.action !== "remove";
    if (shouldAdd && !exists) auth.user.contactIds.push(target.id);
    if (!shouldAdd && exists) auth.user.contactIds = auth.user.contactIds.filter((id) => id !== target.id);
    saveStore();
    sendJson(res, 200, {
      ok: true,
      user: publicUser(auth.user, true),
      users: db.users.map((user) => publicUserFor(user, auth.user))
    });
    return;
  }

  if (url.pathname === "/api/groups" && req.method === "POST") {
    if (!rateLimit(req, `groups:${auth.user.id}`, 20)) return sendError(res, 429, "Слишком много групп за минуту.");
    const body = await readBody(req);
    const name = cleanText(body.name, 32);
    const requestedMembers = Array.isArray(body.memberIds) ? body.memberIds.map(String) : [];
    const memberIds = Array.from(new Set([auth.user.id, ...requestedMembers]))
      .filter((id) => db.users.some((user) => user.id === id))
      .slice(0, 30);
    if (name.length < 2) return sendError(res, 400, "Название группы должно быть минимум 2 символа.");
    if (memberIds.length < 2) return sendError(res, 400, "Для группы нужен хотя бы один участник кроме тебя.");
    const group = {
      id: uid("group"),
      name,
      ownerId: auth.user.id,
      memberIds,
      createdAt: now()
    };
    db.groups.push(group);
    saveStore();
    pushEvent("rooms", { roomIds: [groupRoom(group.id)] }, memberIds);
    sendJson(res, 201, {
      ok: true,
      group: publicGroup(group),
      rooms: listRoomsFor(auth.user.id)
    });
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
    let users = db.users.filter((user) => user.id !== auth.user.id);
    if (q) users = users.filter((user) => user.nickname.toLowerCase().includes(q));
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
    let messages = db.messages.filter((message) => message.roomId === roomId);
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

  if (url.pathname === "/api/messages" && req.method === "POST") {
    if (!rateLimit(req, `message:${auth.user.id}`, 120)) return sendError(res, 429, "Слишком много сообщений. Подожди минуту.");
    const body = await readBody(req);
    let roomId = String(body.roomId || "global");
    const text = cleanText(body.text, 1200);
    if (body.toUserId) roomId = dmRoom(auth.user.id, String(body.toUserId));
    if (!text && !body.attachment) return sendError(res, 400, "Сообщение пустое.");
    if (!canUseRoom(auth.user.id, roomId)) return sendError(res, 403, "Нет доступа к этому чату.");
    if (roomId.startsWith("dm:")) {
      const parts = dmParticipants(roomId);
      if (parts.length !== 2 || !parts.every((id) => db.users.some((user) => user.id === id))) {
        return sendError(res, 404, "Пользователь не найден.");
      }
    }
    const attachments = body.attachment ? [saveUpload(body.attachment, { maxBytes: MAX_FILE_BYTES })] : [];
    const message = {
      id: uid("msg"),
      roomId,
      senderId: auth.user.id,
      text,
      attachments,
      reactions: {},
      readBy: [],
      createdAt: now()
    };
    db.messages.push(message);
    if (db.messages.length > MAX_MESSAGES) db.messages = db.messages.slice(-MAX_MESSAGES);
    auth.user.lastSeen = now();
    saveStore();
    const payload = {
      message: serializeMessage(message),
      rooms: roomTargets(roomId) === "all" ? null : roomTargets(roomId)
    };
    pushEvent("message", payload, roomTargets(roomId));
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
    pushEvent("pins", { roomId: message.roomId, pins: pinnedMessages(message.roomId) }, roomTargets(message.roomId));
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
    const payload = { roomId: message.roomId, pins: pinnedMessages(message.roomId) };
    pushEvent("pins", payload, roomTargets(message.roomId));
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
      if (message.roomId !== roomId || message.senderId === auth.user.id || message.createdAt > maxTime) continue;
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
    if (!canUseRoom(auth.user.id, roomId)) return sendError(res, 403, "Нет доступа к этому чату.");
    pushEvent("typing", {
      roomId,
      user: publicUser(auth.user),
      expiresAt: now() + 3200
    }, roomTargetsExcept(roomId, auth.user.id));
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
    for (const invite of db.callInvites.filter((item) => item.targetUserId === auth.user.id)) {
      res.write(`event: call\ndata: ${safeJson(invite)}\n\n`);
    }
    auth.user.lastSeen = now();
    saveStore();
    pushEvent("users", { users: db.users.map((item) => publicUser(item)) });
    req.on("close", () => {
      clients.delete(clientId);
      pushEvent("users", { users: db.users.map((item) => publicUser(item)) });
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
      serveUpload(req, res, url);
      return;
    }
    serveStatic(req, res, decodeURIComponent(url.pathname));
  } catch (error) {
    console.error(error);
    if (!res.headersSent) {
      const status = Number(error.statusCode || 500);
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

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Orbit Chat ${APP_VERSION} is running on http://127.0.0.1:${PORT}`);
});
