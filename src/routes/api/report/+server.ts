// Anonymous / authed abuse-reports endpoint. Sits in front of the
// public moderation pipeline; an operator triages whatever lands here at
// /admin/platform/reports.
//
// Rate limits:
//   - 5/hr per IP for anonymous reporters
//   - 20/hr per user for authed reporters
// IPs are still recorded for anonymous reports (only) so the operator can
// see clusters of spam reports from a single source.
import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import { createReport, targetExists } from '$lib/db/reports';
import { enforce, type RateLimitRule } from '$lib/server/rate-limit';
import { audit } from '$lib/server/audit';

const REASON_VALUES = ['spam', 'harassment', 'csam', 'malware', 'copyright', 'other'] as const;

const Body = z.object({
	target_type: z.enum(['post', 'comment', 'user', 'blog']),
	target_id: z.string().uuid(),
	reason: z.enum(REASON_VALUES),
	details: z.string().max(2000).optional()
});

// Buckets are isolated from RULES (which lives in rate-limit.ts) because
// the rules here are unique to abuse reporting and would clutter that
// common-bucket export. Keep them local.
const REPORT_LIMIT_ANON: RateLimitRule = {
	bucket: 'report:anon',
	max: 5,
	windowSeconds: 60 * 60
};
const REPORT_LIMIT_AUTHED: RateLimitRule = {
	bucket: 'report:authed',
	max: 20,
	windowSeconds: 60 * 60
};

export const POST: RequestHandler = async (event) => {
	const { request, locals } = event;
	const authed = !!locals.user;
	await enforce(authed ? REPORT_LIMIT_AUTHED : REPORT_LIMIT_ANON, event, {
		keyBy: authed ? 'user' : 'ip'
	});

	const parsed = Body.safeParse(await request.json().catch(() => null));
	if (!parsed.success) throw error(422, parsed.error.message);
	const { target_type, target_id, reason, details } = parsed.data;

	const exists = await targetExists(target_type, target_id);
	if (!exists) throw error(404, `${target_type} not found`);

	const row = await createReport({
		reporterUserId: locals.user?.id ?? null,
		reporterIp: locals.user ? null : event.getClientAddress(),
		targetType: target_type,
		targetId: target_id,
		reason,
		details: details ?? null
	});

	await audit(event, {
		event: 'abuse.reported',
		actorUserId: locals.user?.id ?? null,
		subjectUserId: target_type === 'user' ? target_id : null,
		metadata: {
			report_id: row.id,
			target_type,
			target_id,
			reason,
			anonymous: !locals.user
		}
	});

	return json({ ok: true, report_id: row.id });
};
