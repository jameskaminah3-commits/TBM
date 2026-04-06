self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

function normalizeNotificationPayload(rawPayload) {
  return {
    title: rawPayload?.title || "Tembea Bila Matata",
    body: rawPayload?.body || "You have a new update.",
    icon: rawPayload?.icon || "/favicon.png",
    badge: rawPayload?.badge || "/favicon.png",
    tag: rawPayload?.tag || undefined,
    renotify: Boolean(rawPayload?.renotify),
    requireInteraction: Boolean(rawPayload?.requireInteraction),
    data: {
      url: rawPayload?.data?.url || "/inbox",
      inboxItemId: rawPayload?.data?.inboxItemId || null,
      bookingId: rawPayload?.data?.bookingId || null,
      assignmentId: rawPayload?.data?.assignmentId || null,
      threadKey: rawPayload?.data?.threadKey || null,
      priority: rawPayload?.data?.priority || "normal",
    },
  };
}

self.addEventListener("push", (event) => {
  let payload = {};

  if (event.data) {
    try {
      payload = event.data.json();
    } catch (_error) {
      payload = {
        title: "Tembea Bila Matata",
        body: event.data.text(),
      };
    }
  }

  event.waitUntil(self.registration.showNotification(
    normalizeNotificationPayload(payload).title,
    normalizeNotificationPayload(payload),
  ));
});

self.addEventListener("message", (event) => {
  if (event.data?.type !== "SHOW_LOCAL_NOTIFICATION") {
    return;
  }

  const payload = normalizeNotificationPayload(event.data.payload);
  event.waitUntil(self.registration.showNotification(payload.title, payload));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = event.notification?.data?.url || "/inbox";

  event.waitUntil((async () => {
    const allClients = await self.clients.matchAll({
      type: "window",
      includeUncontrolled: true,
    });

    for (const client of allClients) {
      if ("focus" in client) {
        const clientUrl = new URL(client.url);
        const destinationUrl = new URL(targetUrl, self.location.origin);
        if (clientUrl.origin === destinationUrl.origin) {
          if ("navigate" in client) {
            await client.navigate(destinationUrl.href);
          }
          await client.focus();
          return;
        }
      }
    }

    await self.clients.openWindow(targetUrl);
  })());
});
