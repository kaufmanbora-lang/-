const APP_CACHE = "orbit-chat-shell-v7-canvas-dice-wheel";
const SHELL_ASSETS = [
  "/",
  "/index.html",
  "/manifest.json",
  "/icon.svg",
  "/icon-192.png",
  "/icon-512.png",
  "/maskable-icon.svg",
  "/maskable-icon-512.png"
];

function readPushData(event) {
  if (!event.data) return {};
  try {
    return event.data.json();
  } catch {
    try {
      return { body: event.data.text() };
    } catch {
      return {};
    }
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(APP_CACHE);
    await cache.addAll(SHELL_ASSETS);
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key !== APP_CACHE).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/events") || url.pathname.startsWith("/uploads/")) return;

  event.respondWith((async () => {
    try {
      const response = await fetch(request);
      const cache = await caches.open(APP_CACHE);
      cache.put(request, response.clone()).catch(() => {});
      return response;
    } catch {
      const cached = await caches.match(request);
      return cached || caches.match("/");
    }
  })());
});

self.addEventListener("push", (event) => {
  const data = readPushData(event);
  const title = data.title || "Orbit Chat";
  const options = {
    body: data.body || "Новое сообщение",
    tag: data.tag || data.roomId || "orbit-chat-message",
    icon: data.icon || "/icon-192.png",
    badge: data.badge || "/maskable-icon-512.png",
    image: data.image || undefined,
    vibrate: [80, 40, 80],
    renotify: true,
    requireInteraction: Boolean(data.requireInteraction),
    timestamp: data.timestamp || Date.now(),
    data: {
      url: data.url || "/",
      roomId: data.roomId || "",
      messageId: data.messageId || ""
    },
    actions: [
      { action: "open", title: "Открыть" }
    ]
  };

  event.waitUntil((async () => {
    if ("setAppBadge" in navigator && data.badgeCount) {
      await navigator.setAppBadge(Number(data.badgeCount)).catch(() => {});
    }
    await self.registration.showNotification(title, options);
  })());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || "/";
  event.waitUntil((async () => {
    const allClients = await clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of allClients) {
      if ("focus" in client) {
        if ("navigate" in client) await client.navigate(targetUrl).catch(() => {});
        return client.focus();
      }
    }
    if (clients.openWindow) return clients.openWindow(targetUrl);
  })());
});
