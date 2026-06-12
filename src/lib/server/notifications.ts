// Transactional notification emails.
//
// Why we only notify role groups, not "the author":
// Authors and commenters are pseudonymous via Semaphore. The server doesn't
// know who wrote a given post. The best we can do is:
//   • notify reviewers (owner/editor/reviewer) when something needs review
//   • notify the whole member set when something gets published
//
// Throttle: per-user, per-blog, per-event-bucket rate limit using the existing
// rate_limits table. Survives restart and works across replicas. We don't
// throw on throttle — we just skip the send for that recipient, log it, and
// move on (this is fire-and-forget code).
import { db, schema } from '$lib/db/client';
import { and, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import type { MemberRole } from '$lib/db/schema';
import { sendMail } from './email';
import { consume, buildKey, type RateLimitRule } from './rate-limit';
import { log } from './log';
import { env } from '$env/dynamic/private';
import webpush, { WebPushError } from 'web-push';
import { getOrCreateVapidKeys } from './vapid';

const NOTIFY_REVIEW_RULE: RateLimitRule = {
	bucket: 'notify:review',
	max: 1,
	windowSeconds: 60 * 60
};
const NOTIFY_PUBLISH_RULE: RateLimitRule = {
	bucket: 'notify:publish',
	max: 1,
	windowSeconds: 60 * 60
};

const REVIEWING: MemberRole[] = ['owner', 'editor', 'reviewer'];
const ANY_ACTIVE: MemberRole[] = ['owner', 'editor', 'reviewer', 'author', 'commenter'];

type Recipient = { id: string; email: string };

async function recipientsByRole(blogId: string, roles: MemberRole[]): Promise<Recipient[]> {
	const rows = await db
		.select({
			id: schema.users.id,
			email: schema.users.email
		})
		.from(schema.blogMembers)
		.innerJoin(schema.users, eq(schema.users.id, schema.blogMembers.userId))
		.where(
			and(
				eq(schema.blogMembers.blogId, blogId),
				isNull(schema.blogMembers.removedAt),
				inArray(schema.blogMembers.role, roles),
				isNotNull(schema.users.email),
				isNotNull(schema.users.emailVerifiedAt)
			)
		);
	// De-dupe by user id — a single user could in principle hold multiple
	// memberships if the schema ever loosens the unique constraint.
	const seen = new Set<string>();
	const out: Recipient[] = [];
	for (const r of rows) {
		if (!r.email || seen.has(r.id)) continue;
		seen.add(r.id);
		out.push({ id: r.id, email: r.email });
	}
	return out;
}

async function fetchBlogAndVersion(blogId: string, versionId: string) {
	const blog = await db
		.select({ title: schema.blogs.title, slug: schema.blogs.slug })
		.from(schema.blogs)
		.where(eq(schema.blogs.id, blogId))
		.limit(1);
	const version = await db
		.select({ title: schema.blogPostVersions.title, slug: schema.blogPostVersions.slug })
		.from(schema.blogPostVersions)
		.where(eq(schema.blogPostVersions.id, versionId))
		.limit(1);
	return { blog: blog[0] ?? null, version: version[0] ?? null };
}

function publicOrigin(): string {
	return env.PUBLIC_ORIGIN ?? 'https://freed.ink';
}

// Exported for tests: build the recipient list and shared subject/body
// without actually sending. Tests stub sendMail and assert recipients.
export async function previewNewSubmission(blogId: string, postVersionId: string) {
	const recipients = await recipientsByRole(blogId, REVIEWING);
	const meta = await fetchBlogAndVersion(blogId, postVersionId);
	return { recipients, meta };
}

export async function previewNewPublishedPost(blogId: string, postVersionId: string) {
	const recipients = await recipientsByRole(blogId, ANY_ACTIVE);
	const meta = await fetchBlogAndVersion(blogId, postVersionId);
	return { recipients, meta };
}

export async function notifyReviewersOfNewSubmission(
	blogId: string,
	postVersionId: string
): Promise<void> {
	try {
		const { recipients, meta } = await previewNewSubmission(blogId, postVersionId);
		if (recipients.length === 0 || !meta.blog) return;
		const subject = `[${meta.blog.title}] New post awaiting review`;
		const url = `${publicOrigin()}/admin/b/${meta.blog.slug}/review`;
		const body = [
			`A new post has been submitted for review on "${meta.blog.title}".`,
			meta.version ? `Title: ${meta.version.title}` : null,
			'',
			`Review it here: ${url}`
		]
			.filter((line) => line !== null)
			.join('\n');
		await Promise.allSettled(
			recipients.map(async (r) => {
				const decision = await consume(
					NOTIFY_REVIEW_RULE,
					buildKey(NOTIFY_REVIEW_RULE.bucket, `${r.id}:${blogId}`)
				);
				if (!decision.allowed) {
					log.info({ user: r.id, blog: blogId }, 'review notify throttled');
					return;
				}
				await sendMail({ to: r.email, subject, text: body });
			})
		);
		// Web Push: fire-and-forget per reviewer. Reuses the same rate-limit
		// decision logic isn't necessary here — push delivery is best-effort
		// and the throttle already covered the email path; sending a push to
		// the same person we just emailed is fine.
		const reviewerIds = await reviewerIdsWithPush(blogId);
		const pushTitle = 'New post under review';
		const pushBody = truncate(meta.version?.title ?? 'A new post is awaiting review', 140);
		for (const uid of reviewerIds) {
			void sendPushToUser(uid, {
				title: pushTitle,
				body: pushBody,
				url: `/admin/b/${meta.blog.slug}/review`,
				tag: `review:${blogId}`
			});
		}
	} catch (err) {
		log.error({ err, blogId, postVersionId }, 'notifyReviewersOfNewSubmission failed');
	}
}

export async function notifyMembersOfNewPublishedPost(
	blogId: string,
	postVersionId: string
): Promise<void> {
	try {
		const { recipients, meta } = await previewNewPublishedPost(blogId, postVersionId);
		if (recipients.length === 0 || !meta.blog || !meta.version) return;
		const subject = `[${meta.blog.title}] New post published: ${meta.version.title}`;
		const url = `${publicOrigin()}/b/${meta.blog.slug}/${meta.version.slug}`;
		const body = [
			`A new post is live on "${meta.blog.title}":`,
			'',
			`Title: ${meta.version.title}`,
			`Read it: ${url}`
		].join('\n');
		await Promise.allSettled(
			recipients.map(async (r) => {
				const decision = await consume(
					NOTIFY_PUBLISH_RULE,
					buildKey(NOTIFY_PUBLISH_RULE.bucket, `${r.id}:${blogId}`)
				);
				if (!decision.allowed) {
					log.info({ user: r.id, blog: blogId }, 'publish notify throttled');
					return;
				}
				await sendMail({ to: r.email, subject, text: body });
			})
		);
		// Web Push: fan out to every blog member who has a subscription —
		// not just those with verified email. The email recipient list filters
		// out unverified addresses; for push we just need an installed sub.
		const memberIds = await memberIdsWithPush(blogId);
		const pushTitle = `${meta.blog.title}: new post published`;
		const pushBody = truncate(meta.version.title, 140);
		for (const uid of memberIds) {
			void sendPushToUser(uid, {
				title: pushTitle,
				body: pushBody,
				url: `/b/${meta.blog.slug}/${meta.version.slug}`,
				tag: `publish:${blogId}`
			});
		}
	} catch (err) {
		log.error({ err, blogId, postVersionId }, 'notifyMembersOfNewPublishedPost failed');
	}
}

// ──────────────────────────── web push ────────────────────────────

export type PushPayload = {
	title: string;
	body: string;
	url?: string;
	tag?: string;
};

function truncate(s: string, max: number): string {
	if (s.length <= max) return s;
	return s.slice(0, Math.max(0, max - 1)) + '…';
}

// Fire web-push to every subscription owned by `userId`. Each send is
// fire-and-forget: the caller already `void`s the helper, and within the
// helper we don't await individual sendNotification calls. On 410 Gone we
// drop the dead subscription so it stops eating cycles.
export async function sendPushToUser(userId: string, payload: PushPayload): Promise<void> {
	let subs: Array<{
		id: string;
		endpoint: string;
		p256dh: string;
		auth: string;
	}> = [];
	try {
		subs = await db
			.select({
				id: schema.pushSubscriptions.id,
				endpoint: schema.pushSubscriptions.endpoint,
				p256dh: schema.pushSubscriptions.p256dh,
				auth: schema.pushSubscriptions.auth
			})
			.from(schema.pushSubscriptions)
			.where(eq(schema.pushSubscriptions.userId, userId));
	} catch (err) {
		log.error({ err, userId }, 'sendPushToUser: failed to load subscriptions');
		return;
	}
	if (subs.length === 0) return;

	let vapid;
	try {
		vapid = getOrCreateVapidKeys();
	} catch (err) {
		log.error({ err }, 'sendPushToUser: VAPID keys unavailable');
		return;
	}

	const json = JSON.stringify(payload);
	for (const sub of subs) {
		// fire-and-forget per the spec
		void webpush
			.sendNotification(
				{
					endpoint: sub.endpoint,
					keys: { p256dh: sub.p256dh, auth: sub.auth }
				},
				json,
				{
					vapidDetails: {
						subject: vapid.subject,
						publicKey: vapid.publicKey,
						privateKey: vapid.privateKey
					},
					TTL: 60 * 60 * 24
				}
			)
			.catch(async (err: unknown) => {
				const status =
					err instanceof WebPushError
						? err.statusCode
						: (err as { statusCode?: number })?.statusCode;
				if (status === 410 || status === 404) {
					// Gone / unknown — the push service has dropped the subscription.
					try {
						await db
							.delete(schema.pushSubscriptions)
							.where(eq(schema.pushSubscriptions.id, sub.id));
						log.info({ sub: sub.id, status }, 'pruned dead push subscription');
					} catch (delErr) {
						log.error({ err: delErr, sub: sub.id }, 'failed to prune dead push subscription');
					}
					return;
				}
				log.warn({ err, sub: sub.id, status }, 'push delivery failed');
			});
	}
}

// IDs of reviewers (owner/editor/reviewer) on a blog who have at least one
// push subscription. Distinct user IDs only.
async function reviewerIdsWithPush(blogId: string): Promise<string[]> {
	return userIdsWithPushForRoles(blogId, REVIEWING);
}

async function memberIdsWithPush(blogId: string): Promise<string[]> {
	return userIdsWithPushForRoles(blogId, ANY_ACTIVE);
}

async function userIdsWithPushForRoles(blogId: string, roles: MemberRole[]): Promise<string[]> {
	const rows = await db
		.select({ userId: schema.blogMembers.userId })
		.from(schema.blogMembers)
		.innerJoin(
			schema.pushSubscriptions,
			eq(schema.pushSubscriptions.userId, schema.blogMembers.userId)
		)
		.where(
			and(
				eq(schema.blogMembers.blogId, blogId),
				isNull(schema.blogMembers.removedAt),
				inArray(schema.blogMembers.role, roles)
			)
		);
	return Array.from(new Set(rows.map((r) => r.userId)));
}
