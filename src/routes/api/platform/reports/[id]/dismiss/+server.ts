// Operator-only: dismiss an abuse report (no action). Mirrors the resolve
// endpoint but audits as `abuse.dismissed`.
import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import { isPlatformOperator } from '$lib/server/operators';
import { getReportById, setReportStatus } from '$lib/db/reports';
import { audit } from '$lib/server/audit';

const Body = z.object({
	notes: z.string().max(2000).optional()
});

export const POST: RequestHandler = async (event) => {
	const { request, locals, params } = event;
	if (!locals.user) throw error(401, 'sign in required');
	if (!isPlatformOperator(locals.user)) throw error(403, 'platform operator only');

	const id = z.string().uuid().safeParse(params.id);
	if (!id.success) throw error(404, 'invalid report id');

	const existing = await getReportById(id.data);
	if (!existing) throw error(404, 'report not found');

	const parsed = Body.safeParse(await request.json().catch(() => ({})));
	if (!parsed.success) throw error(422, parsed.error.message);

	const updated = await setReportStatus({
		id: existing.id,
		status: 'dismissed',
		resolvedByUserId: locals.user.id,
		resolutionNotes: parsed.data.notes ?? null
	});
	if (!updated) throw error(404, 'report not found');

	await audit(event, {
		event: 'abuse.dismissed',
		actorUserId: locals.user.id,
		subjectUserId: updated.targetType === 'user' ? updated.targetId : null,
		metadata: {
			report_id: updated.id,
			target_type: updated.targetType,
			target_id: updated.targetId,
			notes: parsed.data.notes ?? null
		}
	});

	return json({ ok: true });
};
