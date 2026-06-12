const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = Number(process.env.PORT || 8790);
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const DATA_FILE = process.env.DATA_FILE || path.join(DATA_DIR, "orbit-chat-data.json");
const SESSION_DAYS = 30;
const MAX_BODY = 1024 * 1024;
const MAX_MESSAGES = 12000;
const SESSION_SECRET = process.env.SESSION_SECRET || "orbit-chat-local-dev";

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
  if (!fs.existsSync(DATA_FILE)) {
    const seed = {
      users: [],
      sessions: [],
      messages: [],
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
    return parsed;
  } catch (error) {
    const backup = `${DATA_FILE}.broken-${Date.now()}`;
    if (fs.existsSync(DATA_FILE)) fs.copyFileSync(DATA_FILE, backup);
    const fresh = { users: [], sessions: [], messages: [], createdAt: new Date().toISOString() };
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
    bio: user.bio || "",
    status: onlineUserIds().has(user.id) ? "online" : "offline",
    lastSeen: user.lastSeen,
    createdAt: user.createdAt
  };
}

function onlineUserIds() {
  const ids = new Set();
  for (const client of clients.values()) ids.add(client.userId);
  return ids;
}

function serializeMessage(message) {
  return {
    id: message.id,
    roomId: message.roomId,
    senderId: message.senderId,
    sender: publicUser(db.users.find((user) => user.id === message.senderId)),
    text: message.text,
    createdAt: message.createdAt
  };
}

function dmRoom(userA, userB) {
  return `dm:${[userA, userB].sort().join(":")}`;
}

function dmParticipants(roomId) {
  if (!roomId || !roomId.startsWith("dm:")) return [];
  return roomId.slice(3).split(":").filter(Boolean);
}

function canUseRoom(userId, roomId) {
  if (roomId === "global") return true;
  const parts = dmParticipants(roomId);
  return parts.length === 2 && parts.includes(userId);
}

function roomTargets(roomId) {
  if (roomId === "global") return "all";
  return dmParticipants(roomId);
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
      users: db.users.map((user) => publicUser(user)),
      rooms: listRoomsFor(auth.user.id)
    });
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
    saveStore();
    pushEvent("users", { users: db.users.map((item) => publicUser(item)) });
    sendJson(res, 200, { ok: true, user: publicUser(auth.user, true) });
    return;
  }

  if (url.pathname === "/api/users" && req.method === "GET") {
    const q = cleanText(url.searchParams.get("q") || "", 40).toLowerCase();
    let users = db.users.filter((user) => user.id !== auth.user.id);
    if (q) users = users.filter((user) => user.nickname.toLowerCase().includes(q));
    sendJson(res, 200, { ok: true, users: users.map((user) => publicUser(user)) });
    return;
  }

  if (url.pathname === "/api/rooms" && req.method === "GET") {
    sendJson(res, 200, { ok: true, rooms: listRoomsFor(auth.user.id) });
    return;
  }

  if (url.pathname === "/api/messages" && req.method === "GET") {
    const roomId = url.searchParams.get("room") || "global";
    const after = Number(url.searchParams.get("after") || 0);
    if (!canUseRoom(auth.user.id, roomId)) return sendError(res, 403, "Нет доступа к этому чату.");
    let messages = db.messages.filter((message) => message.roomId === roomId);
    if (Number.isFinite(after) && after > 0) messages = messages.filter((message) => message.createdAt > after);
    messages = messages.slice(-100);
    sendJson(res, 200, { ok: true, messages: messages.map(serializeMessage) });
    return;
  }

  if (url.pathname === "/api/messages" && req.method === "POST") {
    if (!rateLimit(req, `message:${auth.user.id}`, 120)) return sendError(res, 429, "Слишком много сообщений. Подожди минуту.");
    const body = await readBody(req);
    let roomId = String(body.roomId || "global");
    const text = cleanText(body.text, 1200);
    if (body.toUserId) roomId = dmRoom(auth.user.id, String(body.toUserId));
    if (!text) return sendError(res, 400, "Сообщение пустое.");
    if (!canUseRoom(auth.user.id, roomId)) return sendError(res, 403, "Нет доступа к этому чату.");
    if (roomId.startsWith("dm:")) {
      const parts = dmParticipants(roomId);
      if (parts.length !== 2 || !parts.every((id) => db.users.some((user) => user.id === id))) {
        return sendError(res, 404, "Пользователь не найден.");
      }
    }
    const message = {
      id: uid("msg"),
      roomId,
      senderId: auth.user.id,
      text,
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
    sendJson(res, 201, { ok: true, message: serializeMessage(message), rooms: listRoomsFor(auth.user.id) });
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
    serveStatic(req, res, decodeURIComponent(url.pathname));
  } catch (error) {
    if (!res.headersSent) sendError(res, 500, error.message || "Ошибка сервера.");
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Orbit Chat is running on http://127.0.0.1:${PORT}`);
});
