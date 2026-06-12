// FreedInk push service worker.
//
// Lives at /sw.js so its scope covers the whole origin. Two responsibilities:
//   1. Receive push events from the server and surface a notification.
//   2. On click, focus an existing tab if one is open, else open a new one.
//
// No precaching, no offline support — that's a separate concern, and adding
// it here would silently change the app's caching behaviour. The install /
// activate handlers exist only to skipWaiting / claim clients so updates to
// this file take effect on the next page load.

self.addEventListener('install', (event) => {
	event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
	event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
	let payload = {};
	if (event.data) {
		try {
			payload = event.data.json();
		} catch {
			// Server should always send JSON; if it didn't, surface the raw text.
			payload = { title: 'FreedInk', body: event.data.text() };
		}
	}
	const title = payload.title || 'FreedInk';
	const options = {
		body: payload.body || '',
		data: { url: payload.url || '/' },
		tag: payload.tag,
		icon: '/favicon.png',
		badge: '/favicon.png'
	};
	event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
	event.notification.close();
	const target = (event.notification.data && event.notification.data.url) || '/';
	// Resolve relative to the SW's origin so we always compare apples-to-apples
	// with existing client URLs.
	const targetUrl = new URL(target, self.location.origin).href;
	event.waitUntil(
		self.clients
			.matchAll({ type: 'window', includeUncontrolled: true })
			.then((clientList) => {
				for (const client of clientList) {
					// Same origin → reuse the tab. Navigate if it's pointing somewhere
					// else, then focus.
					try {
						const url = new URL(client.url);
						if (url.origin === self.location.origin && 'focus' in client) {
							if (client.url !== targetUrl && 'navigate' in client) {
								return client.navigate(targetUrl).then(() => client.focus());
							}
							return client.focus();
						}
					} catch {
						// ignore malformed client URL and keep looking
					}
				}
				if (self.clients.openWindow) {
					return self.clients.openWindow(targetUrl);
				}
				return null;
			})
	);
});
