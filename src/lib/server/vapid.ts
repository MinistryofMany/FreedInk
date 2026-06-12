// VAPID key bootstrap.
//
// Web Push requires a stable application-server key pair: the browser stores
// the public half against each subscription, and we sign push requests with
// the private half. We generate the pair on first server start and persist
// it to `data/vapid.json` (gitignored), so subsequent boots reuse the same
// keys. Rotating keys would invalidate every existing subscription, so we
// don't expose a programmatic regenerate; delete the file by hand if you
// really need to start fresh.
//
// We intentionally avoid putting the keys in env vars: ops would have to
// remember to set them before first boot, and a missing var would silently
// disable push for every user.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import webpush from 'web-push';
import { env } from '$env/dynamic/private';
import { log } from './log';

export type VapidKeys = {
	publicKey: string;
	privateKey: string;
	subject: string;
};

const DEFAULT_PATH = resolve(process.cwd(), 'data', 'vapid.json');

let cached: VapidKeys | null = null;

function subjectFromEnv(): string {
	// SMTP_FROM may be `Name <addr@host>` or just `addr@host`. Pull the address.
	const raw = env.SMTP_FROM ?? '';
	const match = raw.match(/<([^>]+)>/);
	const addr = (match ? match[1] : raw).trim();
	if (addr && addr.includes('@')) return `mailto:${addr}`;
	return 'mailto:noreply@freed.ink';
}

export function getOrCreateVapidKeys(path: string = DEFAULT_PATH): VapidKeys {
	if (cached) return cached;

	if (existsSync(path)) {
		try {
			const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<VapidKeys>;
			if (parsed.publicKey && parsed.privateKey) {
				cached = {
					publicKey: parsed.publicKey,
					privateKey: parsed.privateKey,
					// Subject may legitimately change between boots (operator updates
					// SMTP_FROM); always recompute from env.
					subject: subjectFromEnv()
				};
				return cached;
			}
			log.warn({ path }, 'vapid.json present but missing keys; regenerating');
		} catch (err) {
			log.warn({ err, path }, 'vapid.json unreadable; regenerating');
		}
	}

	const generated = webpush.generateVAPIDKeys();
	const keys: VapidKeys = {
		publicKey: generated.publicKey,
		privateKey: generated.privateKey,
		subject: subjectFromEnv()
	};
	try {
		mkdirSync(dirname(path), { recursive: true });
		// Don't persist the subject — it's env-derived and may change.
		writeFileSync(
			path,
			JSON.stringify({ publicKey: keys.publicKey, privateKey: keys.privateKey }, null, 2),
			{ mode: 0o600 }
		);
		log.info({ path }, 'generated new VAPID keys');
	} catch (err) {
		// Persisting failed — we still return the in-memory pair so the current
		// process can send push. Subscribers will need to re-subscribe on the
		// next boot if the keys aren't actually persisted.
		log.error({ err, path }, 'failed to persist VAPID keys; will regenerate next boot');
	}
	cached = keys;
	return keys;
}

// Test-only: clear the in-process cache so a fresh path is re-read.
export function _resetVapidCacheForTests(): void {
	cached = null;
}
