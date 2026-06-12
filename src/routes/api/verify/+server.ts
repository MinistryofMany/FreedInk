import type { RequestHandler } from './$types';
import { SiweMessage } from 'siwe';
import { z } from 'zod';
import { db, schema } from '$lib/db/client';
import { and, eq, isNull, gt } from 'drizzle-orm';
import { getUserByWalletAddress, createUserWithWallet, linkWalletToUser } from '$lib/db/users';
import { createSession, setSessionCookie } from '$lib/server/session';
import { enforce, RULES } from '$lib/server/rate-limit';
import { audit } from '$lib/server/audit';

const Body = z.object({
	message: z.union([z.string(), z.record(z.any())]),
	signature: z.string()
});

export const POST: RequestHandler = async (event) => {
	await enforce(RULES.authFinish, event, { keyBy: 'ip' });
	const { request, cookies, locals, getClientAddress } = event;
	const parsed = Body.safeParse(await request.json());
	if (!parsed.success) {
		return new Response(JSON.stringify({ message: 'invalid body' }), { status: 422 });
	}

	const siwe = new SiweMessage(parsed.data.message as string);

	// Validate nonce against the persisted (unconsumed, unexpired) set.
	const nonceRow = await db
		.select()
		.from(schema.siweNonces)
		.where(
			and(
				eq(schema.siweNonces.nonce, siwe.nonce),
				isNull(schema.siweNonces.consumedAt),
				gt(schema.siweNonces.expiresAt, new Date())
			)
		)
		.limit(1);
	if (nonceRow.length === 0) {
		return new Response(JSON.stringify({ message: 'invalid or expired nonce' }), { status: 422 });
	}

	try {
		await siwe.verify({ signature: parsed.data.signature, nonce: siwe.nonce });
	} catch (err) {
		const e = err as { name?: string; message?: string };
		const statusCode = e.name === 'ExpiredMessage' ? 440 : 422;
		return new Response(JSON.stringify({ message: e.message ?? 'verification failed' }), {
			status: statusCode
		});
	}

	// Consume the nonce so it can't be reused.
	await db
		.update(schema.siweNonces)
		.set({ consumedAt: new Date() })
		.where(eq(schema.siweNonces.nonce, siwe.nonce));

	const address = siwe.address.toLowerCase();
	let user = await getUserByWalletAddress(address);
	let newUser = false;
	let linkedNewWallet = false;
	if (!user) {
		if (locals.user) {
			// Authenticated user is linking a new wallet.
			await linkWalletToUser(locals.user.id, address);
			user = locals.user;
			linkedNewWallet = true;
		} else {
			user = await createUserWithWallet(address);
			newUser = true;
		}
	}

	const needsProfile =
		!user.username || user.username.startsWith('0x') || user.username.length < 3;
	const needsIdentity = await hasNoActiveIdentity(user.id);

	const sessionId = await createSession(user.id, {
		userAgent: request.headers.get('user-agent'),
		ip: getClientAddress()
	});
	setSessionCookie(cookies, sessionId);

	if (linkedNewWallet) {
		await audit(event, {
			event: 'wallet.linked',
			actorUserId: user.id,
			subjectUserId: user.id,
			metadata: { address }
		});
	}
	await audit(event, {
		event: 'session.created',
		actorUserId: user.id,
		subjectUserId: user.id,
		metadata: { method: 'siwe', new_user: newUser }
	});

	return new Response(
		JSON.stringify({ ok: true, new_user: newUser || needsProfile, needs_identity: needsIdentity }),
		{ status: 200 }
	);
};

async function hasNoActiveIdentity(userId: string): Promise<boolean> {
	const rows = await db
		.select({ id: schema.userIdentities.id })
		.from(schema.userIdentities)
		.where(
			and(
				eq(schema.userIdentities.userId, userId),
				eq(schema.userIdentities.status, 'active')
			)
		)
		.limit(1);
	return rows.length === 0;
}
