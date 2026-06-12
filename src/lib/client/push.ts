// Browser-side Web Push wrapper.
//
// Three things the calling UI cares about:
//   1. Whether the browser supports push at all (no on iOS PWAs older than
//      16.4, no in private windows on Firefox, etc).
//   2. The current permission/subscription state, so we render the right
//      button label.
//   3. A subscribe() / unsubscribe() pair that hides the service-worker
//      registration + push-manager dance.
//
// We intentionally keep this module thin and synchronous-where-possible so
// SSR can import it without choking — every function that touches `window`
// or `navigator` is guarded.

export type PushStatus = 'unsupported' | 'denied' | 'unsubscribed' | 'subscribed';

const SW_PATH = '/sw.js';

export function isPushSupported(): boolean {
	if (typeof window === 'undefined') return false;
	return (
		'serviceWorker' in navigator &&
		'PushManager' in window &&
		typeof Notification !== 'undefined'
	);
}

export async function getSubscriptionStatus(): Promise<PushStatus> {
	if (!isPushSupported()) return 'unsupported';
	if (Notification.permission === 'denied') return 'denied';
	// We avoid registering the SW just to read state — checking for an existing
	// registration first keeps "have I ever asked?" cheap.
	const reg = await navigator.serviceWorker.getRegistration(SW_PATH);
	if (!reg) return 'unsubscribed';
	const sub = await reg.pushManager.getSubscription();
	return sub ? 'subscribed' : 'unsubscribed';
}

// URL-safe base64 → ArrayBuffer. PushManager.subscribe wants the application
// server key in raw bytes; the server returns it as a base64url string. We
// return an ArrayBuffer (not Uint8Array) because TS's BufferSource ⊂ DOM
// typings is fussy about backing-store covariance.
function urlBase64ToBuffer(base64String: string): ArrayBuffer {
	const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
	const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
	const raw = atob(base64);
	const out = new Uint8Array(raw.length);
	for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
	return out.buffer;
}

async function registerSW(): Promise<ServiceWorkerRegistration> {
	const existing = await navigator.serviceWorker.getRegistration(SW_PATH);
	if (existing) return existing;
	return navigator.serviceWorker.register(SW_PATH);
}

export async function subscribe(): Promise<void> {
	if (!isPushSupported()) throw new Error('Push is not supported in this browser');
	// Permission might already be 'granted', in which case requestPermission
	// resolves instantly. If it's 'denied' there's no recovery — the user has
	// to fix it in browser settings.
	const perm = await Notification.requestPermission();
	if (perm !== 'granted') throw new Error('Notification permission was not granted');

	const reg = await registerSW();
	// Wait for the SW to be ready so pushManager.subscribe has something to
	// hand the subscription back to. .ready resolves on the active worker.
	await navigator.serviceWorker.ready;

	const vapidRes = await fetch('/api/push/vapid');
	if (!vapidRes.ok) throw new Error('Failed to fetch VAPID key');
	const { publicKey } = (await vapidRes.json()) as { publicKey: string };

	const sub = await reg.pushManager.subscribe({
		userVisibleOnly: true,
		applicationServerKey: urlBase64ToBuffer(publicKey)
	});

	const subJson = sub.toJSON() as {
		endpoint?: string;
		keys?: { p256dh?: string; auth?: string };
	};
	if (!subJson.endpoint || !subJson.keys?.p256dh || !subJson.keys?.auth) {
		throw new Error('Subscription is missing required keys');
	}

	const res = await fetch('/api/push/subscribe', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({
			endpoint: subJson.endpoint,
			keys: { p256dh: subJson.keys.p256dh, auth: subJson.keys.auth },
			userAgent: navigator.userAgent
		})
	});
	if (!res.ok) {
		// Roll back the browser-side subscription so we don't leave an orphan
		// the server doesn't know about.
		await sub.unsubscribe().catch(() => {});
		throw new Error(`Subscribe failed (${res.status})`);
	}
}

export async function unsubscribe(): Promise<void> {
	if (!isPushSupported()) return;
	const reg = await navigator.serviceWorker.getRegistration(SW_PATH);
	if (!reg) return;
	const sub = await reg.pushManager.getSubscription();
	if (!sub) return;
	// Tell the server first — if its delete fails we still want the browser to
	// hold the subscription so we can retry. After the server acks, drop the
	// local subscription so the push service stops trying to deliver.
	const res = await fetch('/api/push/unsubscribe', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ endpoint: sub.endpoint })
	});
	if (!res.ok) throw new Error(`Unsubscribe failed (${res.status})`);
	await sub.unsubscribe();
}
