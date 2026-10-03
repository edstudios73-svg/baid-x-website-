/* BAID X service worker: shows phone notifications sent by the server, even when the site is closed. */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch { d = { title: "BAID X", body: event.data ? event.data.text() : "" }; }
  const title = d.title || "BAID X";
  event.waitUntil(self.registration.showNotification(title, {
    body: d.body || "",
    icon: "/assets/icon-192.png",
    badge: "/assets/favicon-32.png",
    tag: d.tag || undefined,
    renotify: !!d.tag,
    data: { href: d.href || "#/notifications" },
    vibrate: [80, 40, 80],
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const href = (event.notification.data && event.notification.data.href) || "#/notifications";
  const url = new URL("/" + (href.startsWith("#") ? href : "#/notifications"), self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
    for (const c of list) { if ("focus" in c) { c.navigate(url).catch(() => {}); return c.focus(); } }
    return self.clients.openWindow(url);
  }));
});
