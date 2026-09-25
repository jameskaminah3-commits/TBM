// zaina-platform/web/console/sw.ts
//
// The console's service worker: shows the platform's alerts as notifications,
// and opens the chat when one is tapped. It caches nothing.

/// <reference lib="webworker" />

const worker = self as unknown as ServiceWorkerGlobalScope;

type Alert = { title?: string; body?: string; url?: string; tag?: string };

worker.addEventListener("install", () => {
  void worker.skipWaiting();
});

worker.addEventListener("activate", (event) => {
  event.waitUntil(worker.clients.claim());
});

worker.addEventListener("push", (event) => {
  let alert: Alert = {};
  try {
    alert = event.data?.json() ?? {};
  } catch {
    alert = { title: "Zaina", body: event.data?.text() ?? "" };
  }
  event.waitUntil(worker.registration.showNotification(alert.title ?? "Zaina", {
    body: alert.body ?? "",
    tag: alert.tag,
    icon: "icon.svg",
    badge: "icon.svg",
    data: { url: alert.url ?? "./" },
  }));
});

worker.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL((event.notification.data?.url as string) ?? "./", worker.registration.scope);
  // Only the console's own pages open from an alert.
  const url = target.origin === location.origin ? target.href : worker.registration.scope;
  event.waitUntil((async () => {
    const windows = await worker.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of windows) {
      if (client.url.startsWith(worker.registration.scope) && "focus" in client) {
        await (client as WindowClient).navigate(url).catch(() => {});
        return (client as WindowClient).focus();
      }
    }
    return worker.clients.openWindow(url);
  })());
});

export {};
