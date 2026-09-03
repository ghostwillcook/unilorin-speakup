/**
 * UNILORIN Student Connect service worker — the browser half of the Web Push channel.
 *
 * Registered from the client (see lib/push.ts's usage of
 * navigator.serviceWorker), this file receives the pushes the server sends
 * through web-push (pages/api/admin/notifications.ts and server/socket.mjs)
 * and turns them into visible notifications, even when the app tab is closed.
 *
 * Deliberately plain JS, no build step: Next serves /public verbatim, and a
 * service worker must be served from the site root scope to control the
 * whole origin.
 */

/* ------------------------------------------------------------------ push-in */

/**
 * A push arrived. The server sends `JSON.stringify({ title, body })` as the
 * payload — both sender paths agree on that shape — so parse it and show it.
 *
 * A missing/invalid payload (or a data-less push) still shows a generic
 * notification: Chrome requires every push to surface something visible
 * ("userVisibleOnly"), and silently swallowing one puts the subscription at
 * risk of being revoked by the browser.
 */
self.addEventListener("push", (event) => {
  var payload = { title: "UNILORIN Student Connect", body: "You have a new notification." };
  try {
    if (event.data) {
      var data = event.data.json();
      if (data && typeof data.title === "string" && data.title) {
        payload.title = data.title;
      }
      if (data && typeof data.body === "string" && data.body) {
        payload.body = data.body;
      }
    }
  } catch {
    // Malformed JSON — keep the fallback payload above.
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      // Same mark as the app's favicon/tab identity.
      icon: "/unilorin-logo.jpeg",
      badge: "/unilorin-logo.jpeg",
      // Collapses repeats: a burst of sends replaces the previous
      // notification instead of stacking five identical ones.
      tag: "speakup-notification",
    })
  );
});

/* --------------------------------------------------------- click-through */

/**
 * The user clicked a notification. Close it, then take them to the app:
 * focus an already-open SpeakUp window if there is one (no duplicate tabs),
 * otherwise open a new one at the dashboard, where the bell dropdown shows
 * the full notification.
 */
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  event.waitUntil(
    clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then(function (windowClients) {
        for (var i = 0; i < windowClients.length; i++) {
          var client = windowClients[i];
          if (client.url.includes(self.location.origin) && "focus" in client) {
            return client.focus();
          }
        }
        return clients.openWindow("/");
      })
  );
});
