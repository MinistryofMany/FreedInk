import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import { finishRegistration } from '$lib/server/webauthn';
import { db, schema } from '$lib/db/client';
import { desc, eq } from 'drizzle-orm';
import { audit } from '$lib/server/audit';

const Body = z.object({
	response: z.any(),
	nickname: z.string().max(80).optional()
});

export const POST: RequestHandler = async (event) => {
	const { request, locals } = event;
	if (!locals.user) throw error(401, 'sign in required');
	const parsed = Body.safeParse(await request.json());
	if (!parsed.success) throw error(422, parsed.error.message);

	try {
		await finishRegistration({
			userId: locals.user.id,
			response: parsed.data.response,
			nickname: parsed.data.nickname
		});
	} catch (e) {
		throw error(400, (e as Error).message);
	}

	const [pk] = await db
		.select({
			id: schema.passkeyCredentials.id,
			nickname: schema.passkeyCredentials.nickname,
			createdAt: schema.passkeyCredentials.createdAt,
			lastUsedAt: schema.passkeyCredentials.lastUsedAt
		})
		.from(schema.passkeyCredentials)
		.where(eq(schema.passkeyCredentials.userId, locals.user.id))
		.orderBy(desc(schema.passkeyCredentials.createdAt))
		.limit(1);

	await audit(event, {
		event: 'passkey.added',
		actorUserId: locals.user.id,
		subjectUserId: locals.user.id,
		metadata: { passkey_id: pk?.id, nickname: pk?.nickname ?? null }
	});

	return json({ ok: true, passkey: pk });
};
