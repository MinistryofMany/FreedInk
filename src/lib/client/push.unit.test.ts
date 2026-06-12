// @vitest-environment jsdom
//
// Unit tests for the browser push helper. We can't actually exercise the
// real PushManager under jsdom, so we stub the bits the helper touches:
// Notification, navigator.serviceWorker, PushManager. The fetch global is
// also mocked so we can assert the helper hit the right URLs with the right
// payloads.
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// Capture state so individual tests can tweak what the stubs return.
let permission: NotificationPermission = 'default';
let subscriptionJson: {
	endpoint: string;
	keys: { p256dh: string; auth: string };
} | null = null;
const subscribeMock = vi.fn();
const unsubscribeMock = vi.fn();
const registerMock = vi.fn();
const getRegistrationMock = vi.fn();
const getSubscriptionMock = vi.fn();
const requestPermissionMock = vi.fn();
let fetchMock: ReturnType<typeof vi.fn>;

function installGlobals() {
	// Notification: a function-shaped object so `typeof Notification !==
	// 'undefined'` is true and `Notification.permission` is readable.
	const NotificationStub = function () {} as unknown as typeof Notification & {
		permission: NotificationPermission;
		requestPermission: typeof Notification.requestPermission;
	};
	Object.defineProperty(NotificationStub, 'permission', {
		get: () => permission,
		configurable: true
	});
	NotificationStub.requestPermission = requestPermissionMock as unknown as typeof Notification.requestPermission;
	(globalThis as unknown as { Notification: unknown }).Notification = NotificationStub;
	(window as unknown as { Notification: unknown }).Notification = NotificationStub;

	// PushManager presence is feature-detected with `'PushManager' in window`.
	(window as unknown as { PushManager: unknown }).PushManager = function () {};

	// navigator.serviceWorker: register() / getRegistration() / ready.
	const fakeSubscription = {
		toJSON: () => subscriptionJson,
		unsubscribe: unsubscribeMock,
		get endpoint() {
			return subscriptionJson?.endpoint ?? '';
		}
	};
	const fakeRegistration = {
		pushManager: {
			subscribe: subscribeMock,
			getSubscription: getSubscriptionMock
		}
	};
	subscribeMock.mockResolvedValue(fakeSubscription);
	getSubscriptionMock.mockResolvedValue(null);
	registerMock.mockResolvedValue(fakeRegistration);
	getRegistrationMock.mockResolvedValue(undefined);

	Object.defineProperty(navigator, 'serviceWorker', {
		configurable: true,
		value: {
			register: registerMock,
			getRegistration: getRegistrationMock,
			ready: Promise.resolve(fakeRegistration)
		}
	});

	fetchMock = vi.fn();
	globalThis.fetch = fetchMock as unknown as typeof fetch;
}

function uninstallGlobals() {
	delete (globalThis as unknown as { Notification?: unknown }).Notification;
	delete (window as unknown as { Notification?: unknown }).Notification;
	delete (window as unknown as { PushManager?: unknown }).PushManager;
	// navigator.serviceWorker can't always be deleted under jsdom — leave it
	// in place; each test reinstalls it fresh.
}

describe('client push helper', () => {
	beforeEach(() => {
		permission = 'default';
		subscriptionJson = {
			endpoint: 'https://fcm.example/abc',
			keys: { p256dh: 'p256dh-bytes', auth: 'auth-bytes' }
		};
		subscribeMock.mockReset();
		unsubscribeMock.mockReset();
		unsubscribeMock.mockResolvedValue(undefined);
		registerMock.mockReset();
		getRegistrationMock.mockReset();
		getSubscriptionMock.mockReset();
		requestPermissionMock.mockReset();
		installGlobals();
	});

	afterEach(() => {
		uninstallGlobals();
	});

	it('isPushSupported reflects the presence of SW / PushManager / Notification', async () => {
		const { isPushSupported } = await import('./push');
		expect(isPushSupported()).toBe(true);
	});

	it('getSubscriptionStatus returns "denied" when permission is denied', async () => {
		permission = 'denied';
		const { getSubscriptionStatus } = await import('./push');
		expect(await getSubscriptionStatus()).toBe('denied');
	});

	it('getSubscriptionStatus returns "unsubscribed" with no registration', async () => {
		permission = 'default';
		getRegistrationMock.mockResolvedValueOnce(undefined);
		const { getSubscriptionStatus } = await import('./push');
		expect(await getSubscriptionStatus()).toBe('unsubscribed');
	});

	it('subscribe() fetches VAPID, calls pushManager.subscribe, POSTs to /api/push/subscribe', async () => {
		permission = 'default';
		requestPermissionMock.mockResolvedValueOnce('granted');
		// VAPID key needs to be URL-safe base64; "test" decodes fine via atob.
		fetchMock.mockImplementation(async (url: string) => {
			if (url === '/api/push/vapid') {
				return new Response(JSON.stringify({ publicKey: 'AAEC' }), {
					status: 200,
					headers: { 'content-type': 'application/json' }
				});
			}
			if (url === '/api/push/subscribe') {
				return new Response(JSON.stringify({ ok: true }), { status: 200 });
			}
			throw new Error('unexpected fetch ' + url);
		});

		const { subscribe } = await import('./push');
		await subscribe();

		expect(requestPermissionMock).toHaveBeenCalledOnce();
		expect(registerMock).toHaveBeenCalledWith('/sw.js');
		expect(subscribeMock).toHaveBeenCalledOnce();
		const subscribeArg = subscribeMock.mock.calls[0][0];
		expect(subscribeArg.userVisibleOnly).toBe(true);
		// The helper hands the push manager an ArrayBuffer (the raw bytes
		// behind the base64-decoded VAPID key); Uint8Array is also fine in
		// practice but we standardised on ArrayBuffer to satisfy the DOM types.
		expect(subscribeArg.applicationServerKey).toBeInstanceOf(ArrayBuffer);

		const subscribeCall = fetchMock.mock.calls.find(
			(c) => c[0] === '/api/push/subscribe'
		);
		expect(subscribeCall).toBeDefined();
		const body = JSON.parse(subscribeCall![1].body);
		expect(body.endpoint).toBe('https://fcm.example/abc');
		expect(body.keys).toEqual({ p256dh: 'p256dh-bytes', auth: 'auth-bytes' });
	});

	it('subscribe() throws if permission is denied', async () => {
		requestPermissionMock.mockResolvedValueOnce('denied');
		const { subscribe } = await import('./push');
		await expect(subscribe()).rejects.toThrow(/permission/i);
	});

	it('subscribe() rolls back browser subscription if the server rejects', async () => {
		requestPermissionMock.mockResolvedValueOnce('granted');
		fetchMock.mockImplementation(async (url: string) => {
			if (url === '/api/push/vapid') {
				return new Response(JSON.stringify({ publicKey: 'AAEC' }), { status: 200 });
			}
			if (url === '/api/push/subscribe') {
				return new Response('boom', { status: 500 });
			}
			throw new Error('unexpected fetch ' + url);
		});
		const { subscribe } = await import('./push');
		await expect(subscribe()).rejects.toThrow(/Subscribe failed/);
		expect(unsubscribeMock).toHaveBeenCalledOnce();
	});

	it('unsubscribe() POSTs to /api/push/unsubscribe and calls subscription.unsubscribe()', async () => {
		const fakeSub = {
			endpoint: 'https://fcm.example/abc',
			unsubscribe: unsubscribeMock
		};
		const fakeReg = {
			pushManager: { getSubscription: getSubscriptionMock }
		};
		getRegistrationMock.mockResolvedValueOnce(fakeReg);
		getSubscriptionMock.mockResolvedValueOnce(fakeSub);

		fetchMock.mockResolvedValueOnce(
			new Response(JSON.stringify({ ok: true }), { status: 200 })
		);

		const { unsubscribe } = await import('./push');
		await unsubscribe();

		const unsubCall = fetchMock.mock.calls[0];
		expect(unsubCall[0]).toBe('/api/push/unsubscribe');
		const body = JSON.parse(unsubCall[1].body);
		expect(body.endpoint).toBe('https://fcm.example/abc');
		expect(unsubscribeMock).toHaveBeenCalledOnce();
	});

	it('unsubscribe() is a no-op when there is no registration', async () => {
		getRegistrationMock.mockResolvedValueOnce(undefined);
		const { unsubscribe } = await import('./push');
		await unsubscribe();
		expect(fetchMock).not.toHaveBeenCalled();
	});
});
