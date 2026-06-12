// Append-only audit log writes. Call from auth / role / identity / blog code
// paths whenever something security-relevant happens. Never throw — auditing
// is best-effort relative to the action itself.
import { db, schema } from '$lib/db/client';
import type { RequestEvent } from '@sveltejs/kit';
import { log } from './log';

type AuditEvent = (typeof schema.auditEvent.enumValues)[number];

export type AuditInput = {
	event: AuditEvent;
	actorUserId?: string | null;
	subjectUserId?: string | null;
	subjectBlogId?: string | null;
	metadata?: Record<string, unknown>;
};

export async function audit(
	event_: RequestEvent | null,
	input: AuditInput
): Promise<void> {
	try {
		await db.insert(schema.auditLog).values({
			event: input.event,
			actorUserId: input.actorUserId ?? event_?.locals.user?.id ?? null,
			subjectUserId: input.subjectUserId ?? null,
			subjectBlogId: input.subjectBlogId ?? null,
			ip: event_?.getClientAddress() ?? null,
			userAgent: event_?.request.headers.get('user-agent') ?? null,
			metadata: input.metadata ?? null
		});
	} catch (err) {
		// Don't propagate audit failures into user-facing errors. Just log.
		log.error({ err, audit: input }, 'audit write failed');
	}
}

export type { AuditEvent };
