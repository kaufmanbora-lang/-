const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
let webPush = null;

try {
  webPush = require("web-push");
} catch {
  webPush = null;
}

const PORT = Number(process.env.PORT || 8790);
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const DATA_FILE = process.env.DATA_FILE || path.join(DATA_DIR, "orbit-chat-data.json");
const UPLOAD_DIR = path.join(DATA_DIR, "uploads");
const SESSION_DAYS = 30;
const MAX_BODY = 40 * 1024 * 1024;
const MAX_MESSAGES = 12000;
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_AVATAR_BYTES = 8 * 1024 * 1024;
const SESSION_SECRET = process.env.SESSION_SECRET || "orbit-chat-local-dev";
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || "mailto:orbit-chat@example.com";
const ALLOWED_REACTIONS = new Set(["👍", "❤️", "😂", "🔥", "😮", "😢"]);
const MIME_EXT = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/wav": "wav",
  "application/pdf": "pdf",
  "text/plain": "txt",
  "application/zip": "zip",
  "application/x-zip-compressed": "zip",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx"
};

const clients = new Map();
const rateBuckets = new Map();

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
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) {
    const seed = {
      users: [],
      sessions: [],
      messages: [],
      groups: [],
      roomPins: {},
      pushSubscriptions: [],
      vapidKeys: null,
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
    parsed.pushSubscriptions ||= [];
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
    const fresh = { users: [], sessions: [], messages: [], groups: [], roomPins: {}, pushSubscriptions: [], vapidKeys: null, createdAt: new Date().toISOString() };
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

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.pbkdf2Sync(String(password), salt, 120000, 32, "sha256").toString("hex");
  return { salt, hash };
}

function verifyPassword(password, user) {
  const { hash } = hashPassword(password, user.passwordSalt);
  const a = Buffer.from(hash, "hex");
  const b = Buffer.from(user.passwordHash, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
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
  return Boolean(raw && sig && signToken(raw) === sig);
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
  return String(mimeType || "").startsWith("image/");
}

function isAudioMime(mimeType) {
  return String(mimeType || "").startsWith("audio/");
}

function sanitizeFileName(fileName) {
  const cleaned = String(fileName || "file").replace(/[^\w.\-а-яА-ЯёЁ ]+/g, "").trim();
  return cleaned.slice(0, 80) || "file";
}

function uploadExt(mimeType, fileName) {
  if (MIME_EXT[mimeType]) return MIME_EXT[mimeType];
  const ext = path.extname(String(fileName || "")).replace(".", "").toLowerCase();
  return ext && ext.length <= 8 ? ext : "bin";
}

function decodeUpload(input) {
  const raw = String(input?.data || "");
  const match = raw.match(/^data:([^;,]+);base64,(.+)$/);
  const mimeType = String(input?.mimeType || match?.[1] || "application/octet-stream").toLowerCase();
  const base64 = match ? match[2] : raw;
  if (!/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(mimeType)) throw new Error("Неверный тип файла.");
  return { mimeType, buffer: Buffer.from(base64, "base64") };
}

function saveUpload(input, options = {}) {
  const { maxBytes = MAX_FILE_BYTES, imagesOnly = false } = options;
  const { mimeType, buffer } = decodeUpload(input);
  if (!buffer.length) throw new Error("Файл пустой.");
  if (buffer.length > maxBytes) throw new Error(`Файл слишком большой. Максимум ${Math.round(maxBytes / 1024 / 1024)} МБ.`);
  if (imagesOnly && !isImageMime(mimeType)) throw new Error("Для аватарки нужна картинка.");
  if (!imagesOnly && !MIME_EXT[mimeType] && !isImageMime(mimeType) && !isAudioMime(mimeType)) {
    throw new Error("Такой тип файла пока нельзя отправить.");
  }
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
    ".wav": "audio/wav",
    ".pdf": "application/pdf",
    ".txt": "text/plain; charset=utf-8",
    ".zip": "application/zip",
    ".doc": "application/msword",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  };
  return types[ext] || "application/octet-stream";
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type,authorization"
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
        reject(new Error("Слишком большой запрос."));
        req.destroy();
        return;
      }
      body += chunk;
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error("Неверный JSON."));
      }
    });
    req.on("error", reject);
  });
}

function getToken(req, url) {
  const auth = req.headers.authorization || "";
  if (auth.startsWith("Bearer ")) return auth.slice(7).trim();
  if (url.searchParams.has("token")) return url.searchParams.get("token");
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

async function sendPushNotifications(message) {
  if (!webPushReady()) return;
  const targetIds = usersForRoom(message.roomId, message.senderId);
  if (!targetIds.length) return;
  const subscriptions = db.pushSubscriptions.filter((item) => targetIds.includes(item.userId));
  if (!subscriptions.length) return;
  const payload = safeJson({
    title: pushTitleFor(message),
    body: pushBodyFor(message),
    url: "/",
    roomId: message.roomId
  });
  const expired = new Set();
  await Promise.all(subscriptions.map(async (item) => {
    try {
      await webPush.sendNotification(item.subscription, payload);
    } catch (error) {
      if (error.statusCode === 404 || error.statusCode === 410) expired.add(item.endpoint);
    }
  }));
  if (expired.size) {
    db.pushSubscriptions = db.pushSubscriptions.filter((item) => !expired.has(item.endpoint));
    saveStore();
  }
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
    lastMessage: lastMessageFor("global")
  }];
  for (const roomId of directRoomIds) {
    const otherId = dmParticipants(roomId).find((id) => id !== userId);
    const other = db.users.find((user) => user.id === otherId);
    rooms.push({
      id: roomId,
      type: "direct",
      title: other?.nickname || "Личный чат",
      user: publicUser(other),
      lastMessage: lastMessageFor(roomId)
    });
  }
  for (const group of db.groups.filter((item) => item.memberIds.includes(userId))) {
    rooms.push({
      id: groupRoom(group.id),
      type: "group",
      title: group.name,
      group: publicGroup(group),
      subtitle: `${group.memberIds.length} участников`,
      lastMessage: lastMessageFor(groupRoom(group.id))
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
  const filePath = pathname === "/" ? path.join(__dirname, "index.html") : path.join(__dirname, pathname);
  const normalized = path.normalize(filePath);
  if (!normalized.startsWith(__dirname)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  fs.readFile(normalized, (error, content) => {
    if (error) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
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
    res.writeHead(200, { "content-type": type, "cache-control": "no-store" });
    res.end(content);
  });
}

function serveUpload(req, res, pathname) {
  const fileName = path.basename(pathname.slice("/uploads/".length));
  const filePath = path.join(UPLOAD_DIR, fileName);
  const normalized = path.normalize(filePath);
  if (!normalized.startsWith(UPLOAD_DIR) || !fs.existsSync(normalized)) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not found");
    return;
  }
  res.writeHead(200, {
    "content-type": contentTypeForUpload(fileName),
    "cache-control": "public, max-age=31536000, immutable"
  });
  fs.createReadStream(normalized).pipe(res);
}

async function handleApi(req, res, url) {
  if (req.method === "OPTIONS") {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (url.pathname === "/api/register" && req.method === "POST") {
    if (!rateLimit(req, "register", 15)) return sendError(res, 429, "Слишком много попыток. Подожди минуту.");
    const body = await readBody(req);
    const email = normalizeEmail(body.email);
    const nickname = cleanText(body.nickname, 24);
    const password = String(body.password || "");
    if (!validateEmail(email)) return sendError(res, 400, "Введи нормальную почту.");
    if (nickname.length < 2) return sendError(res, 400, "Ник должен быть минимум 2 символа.");
    if (password.length < 6) return sendError(res, 400, "Пароль должен быть минимум 6 символов.");
    if (db.users.some((user) => user.email === email)) return sendError(res, 409, "Такой email уже зарегистрирован.");
    if (db.users.some((user) => user.nickname.toLowerCase() === nickname.toLowerCase())) {
      return sendError(res, 409, "Такой ник уже занят.");
    }
    const { salt, hash } = hashPassword(password);
    const user = {
      id: uid("user"),
      email,
      nickname,
      passwordSalt: salt,
      passwordHash: hash,
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
    saveStore();
    pushEvent("users", { users: db.users.map((item) => publicUser(item)) });
    sendJson(res, 201, { ok: true, token, user: publicUser(user, true), rooms: listRoomsFor(user.id) });
    return;
  }

  if (url.pathname === "/api/login" && req.method === "POST") {
    if (!rateLimit(req, "login", 30)) return sendError(res, 429, "Слишком много попыток. Подожди минуту.");
    const body = await readBody(req);
    const email = normalizeEmail(body.email);
    const password = String(body.password || "");
    const user = db.users.find((item) => item.email === email);
    if (!user || !verifyPassword(password, user)) return sendError(res, 401, "Почта или пароль неверные.");
    const token = makeToken();
    user.lastSeen = now();
    db.sessions.push({
      token,
      userId: user.id,
      createdAt: now(),
      expiresAt: now() + SESSION_DAYS * 24 * 60 * 60 * 1000
    });
    db.sessions = db.sessions.filter((session) => session.expiresAt > now());
    saveStore();
    pushEvent("users", { users: db.users.map((item) => publicUser(item)) });
    sendJson(res, 200, { ok: true, token, user: publicUser(user, true), rooms: listRoomsFor(user.id) });
    return;
  }

  const auth = requireAuth(req, res, url);
  if (!auth) return;

  if (url.pathname === "/api/logout" && req.method === "POST") {
    db.sessions = db.sessions.filter((session) => session.token !== auth.token);
    saveStore();
    sendJson(res, 200, { ok: true });
    return;
  }

  if (url.pathname === "/api/me" && req.method === "GET") {
    sendJson(res, 200, {
      ok: true,
      user: publicUser(auth.user, true),
      users: db.users.map((user) => publicUserFor(user, auth.user)),
      rooms: listRoomsFor(auth.user.id)
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

  if (url.pathname === "/api/push-subscriptions" && req.method === "POST") {
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
    saveStore();
    sendJson(res, 200, { ok: true });
    return;
  }

  if (url.pathname === "/api/profile" && req.method === "POST") {
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
    const payload = {
      type,
      callId: cleanText(body.callId || uid("call"), 80),
      from: publicUser(auth.user),
      targetUserId,
      payload: body.payload || {},
      createdAt: now()
    };
    pushEvent("call", payload, [targetUserId]);
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
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "connection": "keep-alive",
      "access-control-allow-origin": "*"
    });
    res.write(`event: hello\ndata: ${safeJson({ ok: true, time: now() })}\n\n`);
    clients.set(clientId, { id: clientId, userId: auth.user.id, res });
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
      serveUpload(req, res, decodeURIComponent(url.pathname));
      return;
    }
    serveStatic(req, res, decodeURIComponent(url.pathname));
  } catch (error) {
    if (!res.headersSent) sendError(res, 500, error.message || "Ошибка сервера.");
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Orbit Chat is running on http://127.0.0.1:${PORT}`);
});
