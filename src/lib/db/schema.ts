import {
	pgTable,
	pgEnum,
	uuid,
	text,
	timestamp,
	integer,
	boolean,
	jsonb,
	primaryKey,
	uniqueIndex,
	index,
	customType
} from 'drizzle-orm/pg-core';
import { sql, relations } from 'drizzle-orm';

// Drizzle's bytea: not a first-class type yet.
const byteaType = customType<{ data: Uint8Array; default: false }>({
	dataType() {
		return 'bytea';
	}
});

const inetType = customType<{ data: string; default: false }>({
	dataType() {
		return 'inet';
	}
});

const tsvectorType = customType<{ data: string; default: false }>({
	dataType() {
		return 'tsvector';
	}
});

// ──────────────────────────── enums ────────────────────────────

export const postStatus = pgEnum('post_status', ['draft', 'under_review', 'published', 'rejected']);

export const memberRole = pgEnum('member_role', [
	'owner',
	'editor',
	'reviewer',
	'author',
	'commenter'
]);

export const identityStatus = pgEnum('identity_status', ['active', 'revoked']);

export const reviewVote = pgEnum('review_vote', ['approve', 'reject']);

export const auditEvent = pgEnum('audit_event', [
	'session.created',
	'session.destroyed',
	'session.revoked',
	'passkey.added',
	'passkey.removed',
	'wallet.linked',
	'wallet.unlinked',
	'email.changed',
	'email.verified',
	'identity.created',
	'identity.rotated',
	'identity.device_revoked',
	'blog.created',
	'blog.archived',
	'blog.unarchived',
	'blog.member_added',
	'blog.member_removed',
	'blog.member_role_changed',
	'blog.threshold_changed',
	'post.submitted',
	'post.edited',
	'post.published',
	'post.rejected',
	'post.deleted',
	'post.restored',
	'comment.posted',
	'comment.deleted',
	'review.cast',
	'recovery.requested',
	'recovery.completed',
	'gdpr.export',
	'gdpr.deletion',
	'user.suspended',
	'user.unsuspended',
	'abuse.reported',
	'abuse.resolved',
	'abuse.dismissed',
	'feature_flag.changed',
	'media.uploaded',
	'media.deleted',
	'push.subscribed',
	'push.unsubscribed',
	'incident.declared',
	'incident.updated',
	'incident.resolved'
]);

export const reportStatus = pgEnum('report_status', ['open', 'reviewing', 'resolved', 'dismissed']);

export const reportTarget = pgEnum('report_target', ['post', 'comment', 'user', 'blog']);

// Reasons a reviewer can attach to a reject vote. Authors see the aggregated
// counts (no per-reviewer attribution because Semaphore proofs are unlinkable
// across reviewers — votes are anonymous, only the tally is public).
export const rejectionReason = pgEnum('rejection_reason', [
	'low_quality',
	'bad_formatting',
	'ai_generated',
	'rage_bait',
	'off_topic',
	'duplicate',
	'factual_errors',
	'harassment',
	'legal',
	'other'
]);

// Self-hosted status page: scheduler container records a row every N seconds
// based on /healthz polling, operators manually post incidents on top.
export const statusLevel = pgEnum('status_level', [
	'operational',
	'degraded',
	'partial_outage',
	'major_outage'
]);

export const incidentStatus = pgEnum('incident_status', [
	'investigating',
	'identified',
	'monitoring',
	'resolved'
]);

// ──────────────────────────── users ────────────────────────────

export const users = pgTable(
	'users',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		username: text('username').notNull(),
		displayName: text('display_name'),
		// Optional contact address (notifications, blog invitations). Self-asserted
		// and unverified — sign-in is Minister-only, so there's no email-ownership
		// proof. Populated by the user in settings; null for fresh Minister accounts.
		email: text('email'),
		// Set by platform operators to ban a user. Checked in session loader;
		// suspended users can't acquire new sessions and existing ones are
		// rejected at hook time. `suspendedReason` is operator-visible only
		// (not surfaced to the suspended user in the UI to avoid arguing).
		suspendedAt: timestamp('suspended_at', { withTimezone: true }),
		suspendedReason: text('suspended_reason'),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => ({
		usernameIdx: uniqueIndex('users_username_key').on(t.username),
		emailIdx: uniqueIndex('users_email_key').on(t.email),
		suspendedIdx: index('users_suspended_idx').on(t.suspendedAt)
	})
);

export const sessions = pgTable(
	'sessions',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		userId: uuid('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
		lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
		userAgent: text('user_agent'),
		ip: inetType('ip')
	},
	(t) => ({
		userIdx: index('sessions_user_idx').on(t.userId),
		expiresIdx: index('sessions_expires_idx').on(t.expiresAt)
	})
);

// ──────────────────────────── identities ────────────────────────────

export const userIdentities = pgTable(
	'user_identities',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		userId: uuid('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		idc: text('idc').notNull(),
		publicKey: text('public_key').notNull(),
		ciphertext: byteaType('ciphertext').notNull(),
		kdf: text('kdf').notNull().default('pbkdf2-sha256'),
		kdfSalt: byteaType('kdf_salt').notNull(),
		kdfParams: jsonb('kdf_params').notNull(),
		nonce: byteaType('nonce').notNull(),
		status: identityStatus('status').notNull().default('active'),
		// Optional human label for the device this commitment belongs to ("laptop",
		// "phone"). Per-device model (Phase 3): a user may hold several active
		// commitments, one per enrolled device. Null for pre-Phase-3 rows and when
		// the user doesn't name the device.
		deviceLabel: text('device_label'),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		revokedAt: timestamp('revoked_at', { withTimezone: true })
	},
	(t) => ({
		idcIdx: uniqueIndex('user_identities_idc_key').on(t.idc),
		userIdx: index('user_identities_user_idx').on(t.userId),
		userActiveIdx: index('user_identities_user_status_idx').on(t.userId, t.status)
	})
);

// ──────────────────────────── oidc (sign in with minister) ────────────────────────────

// Short-lived pending OIDC authorizations. One row per "start": carries the
// PKCE verifier + nonce until the IdP redirects back with a code. Resolved by
// `state` and deleted on use; expired rows reaped by the cleanup job.
export const oidcSessions = pgTable(
	'oidc_sessions',
	{
		state: text('state').primaryKey(),
		nonce: text('nonce').notNull(),
		codeVerifier: text('code_verifier').notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		expiresAt: timestamp('expires_at', { withTimezone: true }).notNull()
	},
	(t) => ({
		expiresIdx: index('oidc_sessions_expires_idx').on(t.expiresAt)
	})
);

// Links an external OIDC identity (issuer + pairwise subject) to a FreedInk
// user. An OIDC `sub` is unique only per (issuer, client), so we key on the
// pair. A user can hold several identities at once (Minister, passkey, wallet).
export const oidcIdentities = pgTable(
	'oidc_identities',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		userId: uuid('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		issuer: text('issuer').notNull(),
		subject: text('subject').notNull(),
		linkedAt: timestamp('linked_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => ({
		issuerSubjectIdx: uniqueIndex('oidc_identities_issuer_subject_key').on(t.issuer, t.subject),
		userIdx: index('oidc_identities_user_idx').on(t.userId)
	})
);

// ──────────────────────────── blogs ────────────────────────────

export const blogs = pgTable(
	'blogs',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		slug: text('slug').notNull(),
		title: text('title').notNull(),
		description: text('description'),
		// Default language for new posts in this blog. Authors can override
		// per post via blog_post_versions.language. ISO 639-1 (with optional
		// region: `pt-br`) — validated at the API boundary.
		defaultLanguage: text('default_language').notNull().default('en'),
		approvalNumerator: integer('approval_numerator').notNull().default(2),
		approvalDenominator: integer('approval_denominator').notNull().default(3),
		archivedAt: timestamp('archived_at', { withTimezone: true }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => ({
		slugIdx: uniqueIndex('blogs_slug_key').on(t.slug),
		titleIdx: uniqueIndex('blogs_title_key').on(t.title)
	})
);

export const blogMembers = pgTable(
	'blog_members',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		blogId: uuid('blog_id')
			.notNull()
			.references(() => blogs.id, { onDelete: 'cascade' }),
		userId: uuid('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		role: memberRole('role').notNull(),
		// Independent boolean capabilities — the source of truth for what a member
		// may do. `role` is kept during the migration as a derived display label
		// (RSS/llms.txt/roster want one word) and is dropped once nothing reads it.
		// Capabilities back the per-capability Semaphore trees (can_author /
		// can_comment) and gate vote-token issuance (can_review) and admin actions
		// (can_admin). Backfilled from `role` in the migration:
		//   owner→all; editor→author+review+comment; reviewer→review+comment;
		//   author→author+comment; commenter→comment.
		canAuthor: boolean('can_author').notNull().default(false),
		canReview: boolean('can_review').notNull().default(false),
		canComment: boolean('can_comment').notNull().default(false),
		canAdmin: boolean('can_admin').notNull().default(false),
		addedBy: uuid('added_by').references(() => users.id, { onDelete: 'set null' }),
		addedAt: timestamp('added_at', { withTimezone: true }).notNull().defaultNow(),
		removedAt: timestamp('removed_at', { withTimezone: true })
	},
	(t) => ({
		blogUserActiveIdx: uniqueIndex('blog_members_blog_user_active_key')
			.on(t.blogId, t.userId)
			.where(sql`${t.removedAt} IS NULL`),
		blogIdx: index('blog_members_blog_idx').on(t.blogId),
		userIdx: index('blog_members_user_idx').on(t.userId)
	})
);

// One row per change to a capability's eligible set; identities frozen at that
// point. The proof verification path looks up snapshots by (blog, capability,
// root). A blog has independent trees per proving capability — today that is
// `author` (writers) and `comment` (commenters). Votes do NOT use a tree (they
// are blind tokens), so there is no `review` tree.
export const blogMemberSnapshots = pgTable(
	'blog_member_snapshots',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		blogId: uuid('blog_id')
			.notNull()
			.references(() => blogs.id, { onDelete: 'cascade' }),
		// Which capability tree this snapshot belongs to: 'author' | 'comment'.
		// Stored as text (matches Capability/TreeCapability) — kept un-enum'd so a
		// future tree capability doesn't need an enum migration. Backfilled on the
		// legacy mixed rows in migration 0008 (see R4: legacy rows are recomputed,
		// not reinterpreted).
		capability: text('capability').notNull(),
		root: text('root').notNull(),
		identities: text('identities').array().notNull(),
		eligibleCount: integer('eligible_count').notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => ({
		// Per-(blog, capability) uniqueness so each tree has its own row even when
		// two trees of the same blog share an identity set (e.g. a single owner is
		// in both the author and comment trees → same root, two rows). Replaces the
		// old (blog_id, root) unique — that could not hold two capabilities at one
		// root for the same blog.
		blogCapRootKey: uniqueIndex('blog_member_snapshots_blog_cap_root_key').on(
			t.blogId,
			t.capability,
			t.root
		),
		blogIdx: index('blog_member_snapshots_blog_idx').on(t.blogId),
		blogCapIdx: index('blog_member_snapshots_blog_cap_idx').on(t.blogId, t.capability)
	})
);

// ──────────────────────────── posts ────────────────────────────

export const blogPosts = pgTable(
	'blog_posts',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		blogId: uuid('blog_id')
			.notNull()
			.references(() => blogs.id, { onDelete: 'cascade' }),
		currentVersionId: uuid('current_version_id'),
		status: postStatus('status').notNull().default('draft'),
		// Moderation "delete" = unpublish/archive: hide from all public surfaces
		// while preserving content + version history, fully restorable. Never a
		// hard delete. Public reads must filter `archivedAt IS NULL`.
		archivedAt: timestamp('archived_at', { withTimezone: true }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => ({
		blogIdx: index('blog_posts_blog_idx').on(t.blogId),
		statusIdx: index('blog_posts_status_idx').on(t.blogId, t.status)
	})
);

export const blogPostVersions = pgTable(
	'blog_post_versions',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		postId: uuid('post_id')
			.notNull()
			.references(() => blogPosts.id, { onDelete: 'cascade' }),
		version: integer('version').notNull().default(1),
		title: text('title').notNull(),
		content: text('content').notNull(),
		slug: text('slug').notNull(),
		// ISO 639-1 (or with region, e.g. 'pt-br'). Lets the public page
		// stamp <html lang> correctly, lets search/RSS filter by language,
		// and lets readers spot non-default-language posts in listings.
		// Defaults to the blog's defaultLanguage at insert time.
		language: text('language').notNull().default('en'),
		proof: jsonb('proof'),
		// Root of the blog_member_snapshots row this post was proven against.
		// Validation that the root belongs to the same blog happens in the
		// application layer (verifyMembership) — there's no FK because the
		// root is unique per-blog, not globally.
		snapshotRoot: text('snapshot_root'),
		nullifier: text('nullifier'),
		// Quorum denominator FROZEN at the moment this version entered under_review:
		// the count of active can_review members at that instant. The tally uses
		// this (not the live can_review count) as the threshold denominator, so an
		// operator cannot lower the bar mid-review by demoting reviewers, nor can the
		// bar drift as membership changes during a round. Null for legacy rows /
		// versions that never entered review; the tally falls back to the live count
		// only then. See evaluatePostReview.
		eligibleReviewersAtReview: integer('eligible_reviewers_at_review'),
		status: postStatus('status').notNull().default('draft'),
		searchTsv: tsvectorType('search_tsv'),
		submittedAt: timestamp('submitted_at', { withTimezone: true }),
		publishedAt: timestamp('published_at', { withTimezone: true }),
		deletedAt: timestamp('deleted_at', { withTimezone: true }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => ({
		postIdx: index('blog_post_versions_post_idx').on(t.postId),
		nullifierIdx: uniqueIndex('blog_post_versions_post_nullifier_key').on(t.postId, t.nullifier),
		slugIdx: index('blog_post_versions_slug_idx').on(t.slug),
		languageIdx: index('blog_post_versions_language_idx').on(t.language)
	})
);

// Server-issued one-shot nonces for post submissions. The client requests one
// before generating a Semaphore proof; the nonce becomes part of the proof's
// scope, so a captured proof can't be replayed against the same blog twice.
// Consumed-or-expired rows can be reaped by the cleanup job.
export const postSubmissionNonces = pgTable(
	'post_submission_nonces',
	{
		nonce: text('nonce').primaryKey(),
		blogId: uuid('blog_id')
			.notNull()
			.references(() => blogs.id, { onDelete: 'cascade' }),
		userId: uuid('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
		consumedAt: timestamp('consumed_at', { withTimezone: true })
	},
	(t) => ({
		blogIdx: index('post_submission_nonces_blog_idx').on(t.blogId),
		expiresIdx: index('post_submission_nonces_expires_idx').on(t.expiresAt)
	})
);

export const postReviews = pgTable(
	'post_reviews',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		postVersionId: uuid('post_version_id')
			.notNull()
			.references(() => blogPostVersions.id, { onDelete: 'cascade' }),
		vote: reviewVote('vote').notNull(),
		// Blind-token vote model (Phase 5): the anonymous per-voter-per-version
		// handle is the token nonce (a hash of the redeemed token's prepared
		// message), NOT a Semaphore nullifier. Re-submitting the same
		// (version, token_nonce) with a different vote UPSERTs (vote-flip). Unique
		// (post_version_id, token_nonce) blocks double-spend. The legacy proof /
		// snapshot_root / nullifier columns are nullable and unused for new
		// token-based votes (kept for historical rows + a clean migration).
		tokenNonce: text('token_nonce'),
		proof: jsonb('proof'),
		snapshotRoot: text('snapshot_root'),
		nullifier: text('nullifier'),
		comment: text('comment'),
		// Only meaningful for vote='reject'. Multi-select from the
		// rejection_reason enum — a post can be both rage_bait AND
		// ai_generated. Stored as text[] (not a join table) because the
		// values are fixed and we always read all of them together.
		rejectionReasons: rejectionReason('rejection_reasons').array(),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => ({
		// Legacy Semaphore-nullifier uniqueness (kept for historical rows).
		nullifierIdx: uniqueIndex('post_reviews_version_nullifier_key').on(
			t.postVersionId,
			t.nullifier
		),
		// Token-nonce uniqueness: one vote per redeemed token per version
		// (double-spend guard). Partial so only token-based rows are constrained.
		tokenNonceIdx: uniqueIndex('post_reviews_version_token_nonce_key')
			.on(t.postVersionId, t.tokenNonce)
			.where(sql`${t.tokenNonce} IS NOT NULL`),
		versionIdx: index('post_reviews_version_idx').on(t.postVersionId)
	})
);

// Per-blog blind-signature voting-token ISSUER key. The signing key blind-signs
// vote tokens; the public key verifies redeemed tokens. Operator-held signing
// material. `retiredAt` supports per-round key rotation (auditor note): retire a
// key when a round closes so a token issued but never spent can't be redeemed in
// a later round.
export const blogVoteTokenKeys = pgTable(
	'blog_vote_token_keys',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		blogId: uuid('blog_id')
			.notNull()
			.references(() => blogs.id, { onDelete: 'cascade' }),
		publicKeySpki: byteaType('public_key_spki').notNull(),
		privateKeyPkcs8: byteaType('private_key_pkcs8').notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		retiredAt: timestamp('retired_at', { withTimezone: true })
	},
	(t) => ({
		// One active (non-retired) key per blog.
		blogActiveIdx: uniqueIndex('blog_vote_token_keys_blog_active_key')
			.on(t.blogId)
			.where(sql`${t.retiredAt} IS NULL`),
		blogIdx: index('blog_vote_token_keys_blog_idx').on(t.blogId)
	})
);

// Records that a user was ISSUED a vote token for a version. Enforces one token
// per (user, version). This is the only participation signal the server keeps —
// it reveals "user asked for a token for version V", never the vote.
//
// CRITICAL (auditor R-replaces-R2): this table MUST NEVER be joined with
// post_reviews. Doing so would link a voter to their vote and break the
// unlinkability the blind signature provides. It is write-on-issue, read-only to
// answer "has this user already been issued a token for this version".
export const voteTokenIssuances = pgTable(
	'vote_token_issuances',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		blogId: uuid('blog_id')
			.notNull()
			.references(() => blogs.id, { onDelete: 'cascade' }),
		postVersionId: uuid('post_version_id')
			.notNull()
			.references(() => blogPostVersions.id, { onDelete: 'cascade' }),
		userId: uuid('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		// Written COARSENED to the start of the UTC hour (see recordIssuance /
		// truncateToHour), not at default now() resolution, so an operator cannot
		// pin an issuance to a precise instant and pair it with a redemption by
		// timestamp. The DB default is still now() for any path that bypasses
		// recordIssuance; the app always overrides it with the truncated value.
		// Residual leak (small-reviewer blogs) is documented at recordIssuance.
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => ({
		// One issuance per (version, user). The unique constraint is the
		// server-side enforcement of "one token per (user, version)".
		versionUserIdx: uniqueIndex('vote_token_issuances_version_user_key').on(
			t.postVersionId,
			t.userId
		),
		versionIdx: index('vote_token_issuances_version_idx').on(t.postVersionId)
	})
);

export const postComments = pgTable(
	'post_comments',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		postVersionId: uuid('post_version_id')
			.notNull()
			.references(() => blogPostVersions.id, { onDelete: 'cascade' }),
		body: text('body').notNull(),
		deletedAt: timestamp('deleted_at', { withTimezone: true }),
		proof: jsonb('proof').notNull(),
		// See note on blog_post_versions.snapshotRoot — no FK, validated in app.
		snapshotRoot: text('snapshot_root').notNull(),
		nullifier: text('nullifier').notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => ({
		nullifierIdx: uniqueIndex('post_comments_version_nullifier_key').on(
			t.postVersionId,
			t.nullifier
		),
		versionIdx: index('post_comments_version_idx').on(t.postVersionId)
	})
);

// ──────────────────────────── audit log ────────────────────────────

// Append-only record of security-relevant events. We never UPDATE or DELETE
// rows here — older entries can be pruned by the cleanup job past a retention
// horizon (90d by default) once we have one. Actor may be null for
// system-initiated events (cron, GDPR ops); subject is the target (a different
// user, a blog, etc.) when meaningful.
export const auditLog = pgTable(
	'audit_log',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		event: auditEvent('event').notNull(),
		actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
		subjectUserId: uuid('subject_user_id').references(() => users.id, { onDelete: 'set null' }),
		subjectBlogId: uuid('subject_blog_id').references(() => blogs.id, { onDelete: 'set null' }),
		ip: inetType('ip'),
		userAgent: text('user_agent'),
		metadata: jsonb('metadata'),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => ({
		actorIdx: index('audit_log_actor_idx').on(t.actorUserId, t.createdAt),
		subjectUserIdx: index('audit_log_subject_user_idx').on(t.subjectUserId, t.createdAt),
		subjectBlogIdx: index('audit_log_subject_blog_idx').on(t.subjectBlogId, t.createdAt),
		eventIdx: index('audit_log_event_idx').on(t.event, t.createdAt),
		createdAtIdx: index('audit_log_created_at_idx').on(t.createdAt)
	})
);

// Member-visible, ATTRIBUTED permission change log — distinct from the internal
// audit_log (which is operator-only, carries IP/UA, and prunes at 90 days). This
// is a product surface shown to ALL members of a blog: "Bob changed George's
// permissions: +review, −author". These admin actions are deliberately
// non-anonymous — attribution is the feature.
//
// CRITICAL (design R8): this table MUST NEVER carry IP, user-agent, or any
// operator-only field. The member-facing loader selects only the safe columns.
// Both this AND audit_log are written on a capability change.
export const permissionChanges = pgTable(
	'permission_changes',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		blogId: uuid('blog_id')
			.notNull()
			.references(() => blogs.id, { onDelete: 'cascade' }),
		// Who made the change / whom it was made to. SET NULL on user delete so the
		// log survives account deletion (shows as "a former member").
		actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
		subjectUserId: uuid('subject_user_id').references(() => users.id, { onDelete: 'set null' }),
		// {canAuthor, canReview, canComment, canAdmin} before and after the change.
		oldCaps: jsonb('old_caps').notNull(),
		newCaps: jsonb('new_caps').notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => ({
		blogIdx: index('permission_changes_blog_idx').on(t.blogId, t.createdAt)
	})
);

// Owner-issued invitations to join a blog by email. The invitee follows the
// link in the email, signs up (or signs in), and the role assignment lands on
// accept. One-shot tokens; consumed/expired rows reaped by cleanup.
export const blogInvitations = pgTable(
	'blog_invitations',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		blogId: uuid('blog_id')
			.notNull()
			.references(() => blogs.id, { onDelete: 'cascade' }),
		invitedByUserId: uuid('invited_by_user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		email: text('email').notNull(),
		role: memberRole('role').notNull(),
		token: text('token').notNull(),
		expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
		acceptedAt: timestamp('accepted_at', { withTimezone: true }),
		acceptedByUserId: uuid('accepted_by_user_id').references(() => users.id, {
			onDelete: 'set null'
		}),
		revokedAt: timestamp('revoked_at', { withTimezone: true }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => ({
		tokenIdx: uniqueIndex('blog_invitations_token_key').on(t.token),
		blogIdx: index('blog_invitations_blog_idx').on(t.blogId),
		emailIdx: index('blog_invitations_email_idx').on(t.email)
	})
);

// Token-bucket-ish rate limit counters. Each (key, window_start) is one row;
// the limiter increments .count atomically. Cheap because the cleanup job
// reaps anything past its window.
export const rateLimits = pgTable(
	'rate_limits',
	{
		key: text('key').notNull(),
		windowStart: timestamp('window_start', { withTimezone: true }).notNull(),
		count: integer('count').notNull().default(0),
		expiresAt: timestamp('expires_at', { withTimezone: true }).notNull()
	},
	(t) => ({
		pk: primaryKey({ columns: [t.key, t.windowStart] }),
		expiresIdx: index('rate_limits_expires_idx').on(t.expiresAt)
	})
);

// ──────────────────────────── tags ────────────────────────────

export const tags = pgTable(
	'tags',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		name: text('name').notNull(),
		slug: text('slug').notNull()
	},
	(t) => ({
		nameIdx: uniqueIndex('tags_name_key').on(t.name),
		slugIdx: uniqueIndex('tags_slug_key').on(t.slug)
	})
);

export const blogPostTags = pgTable(
	'blog_post_tags',
	{
		postId: uuid('post_id')
			.notNull()
			.references(() => blogPosts.id, { onDelete: 'cascade' }),
		tagId: uuid('tag_id')
			.notNull()
			.references(() => tags.id, { onDelete: 'cascade' })
	},
	(t) => ({
		pk: primaryKey({ columns: [t.postId, t.tagId] }),
		tagIdx: index('blog_post_tags_tag_idx').on(t.tagId)
	})
);

// ──────────────────────────── media ────────────────────────────

// Tracked uploads — replaces the file-system-only metadata of the earlier
// stop-gap. Storing rows lets us list-by-uploader, reap orphans, and tell the
// frontend about EXIF-stripped variants.
export const mediaUploads = pgTable(
	'media_uploads',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		uploaderUserId: uuid('uploader_user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		// sha256(file) — also the on-disk filename, so duplicate uploads dedupe.
		sha256: text('sha256').notNull(),
		mimeType: text('mime_type').notNull(),
		byteSize: integer('byte_size').notNull(),
		width: integer('width'),
		height: integer('height'),
		// True once we've stripped EXIF / re-encoded via sharp. Old rows from
		// before EXIF stripping shipped will have this NULL.
		exifStripped: timestamp('exif_stripped_at', { withTimezone: true }),
		// Soft-delete: keeps the file referenced by old posts working until the
		// scheduler reaps orphaned rows.
		deletedAt: timestamp('deleted_at', { withTimezone: true }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => ({
		uploaderIdx: index('media_uploads_uploader_idx').on(t.uploaderUserId, t.createdAt),
		sha256Idx: uniqueIndex('media_uploads_sha256_uploader_key').on(t.uploaderUserId, t.sha256)
	})
);

// ──────────────────────────── web push ────────────────────────────

export const pushSubscriptions = pgTable(
	'push_subscriptions',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		userId: uuid('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		// Endpoint is the unique key from the browser's push service.
		endpoint: text('endpoint').notNull(),
		p256dh: text('p256dh').notNull(),
		auth: text('auth').notNull(),
		userAgent: text('user_agent'),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => ({
		endpointIdx: uniqueIndex('push_subscriptions_endpoint_key').on(t.endpoint),
		userIdx: index('push_subscriptions_user_idx').on(t.userId)
	})
);

// ──────────────────────────── feature flags ────────────────────────────

// Simple boolean + rollout-percentage flag system. The operator dashboard
// toggles flags from /admin/platform/flags; the app reads via a tiny helper
// that hashes (user_id, flag_key) → [0,100) to make a per-user decision when
// rollout is partial. Per-user `feature_flag_overrides` rows trump the global
// flag for that user.
export const featureFlags = pgTable(
	'feature_flags',
	{
		key: text('key').primaryKey(),
		description: text('description'),
		enabled: boolean('enabled').notNull().default(false),
		rolloutPercentage: integer('rollout_percentage').notNull().default(0),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
		updatedByUserId: uuid('updated_by_user_id').references(() => users.id, {
			onDelete: 'set null'
		})
	},
	(t) => ({
		enabledIdx: index('feature_flags_enabled_idx').on(t.enabled)
	})
);

export const featureFlagOverrides = pgTable(
	'feature_flag_overrides',
	{
		flagKey: text('flag_key')
			.notNull()
			.references(() => featureFlags.key, { onDelete: 'cascade' }),
		userId: uuid('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		enabled: boolean('enabled').notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => ({
		pk: primaryKey({ columns: [t.flagKey, t.userId] }),
		userIdx: index('feature_flag_overrides_user_idx').on(t.userId)
	})
);

// ──────────────────────────── abuse reports ────────────────────────────

export const abuseReports = pgTable(
	'abuse_reports',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		reporterUserId: uuid('reporter_user_id').references(() => users.id, {
			onDelete: 'set null'
		}),
		// Anonymous reports are allowed for public content — reporter_user_id
		// is null and we capture IP for rate limiting only.
		reporterIp: inetType('reporter_ip'),
		targetType: reportTarget('target_type').notNull(),
		// UUID of the target; FK is not enforced because target_type varies.
		// Validated at insert time by the API endpoint.
		targetId: uuid('target_id').notNull(),
		reason: text('reason').notNull(),
		details: text('details'),
		status: reportStatus('status').notNull().default('open'),
		resolvedByUserId: uuid('resolved_by_user_id').references(() => users.id, {
			onDelete: 'set null'
		}),
		resolvedAt: timestamp('resolved_at', { withTimezone: true }),
		resolutionNotes: text('resolution_notes'),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => ({
		statusIdx: index('abuse_reports_status_idx').on(t.status, t.createdAt),
		targetIdx: index('abuse_reports_target_idx').on(t.targetType, t.targetId),
		reporterIdx: index('abuse_reports_reporter_idx').on(t.reporterUserId)
	})
);

// ──────────────────────────── status page ────────────────────────────

// One row per probe iteration recorded by the scheduler container. Used to
// render the 90-day uptime grid on the public /status page and the operator
// dashboard. Polled at ~30s by default — keeps cardinality bounded (~2.6M
// rows/year) and the cleanup job reaps anything older than 90 days.
export const statusChecks = pgTable(
	'status_checks',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		checkedAt: timestamp('checked_at', { withTimezone: true }).notNull().defaultNow(),
		// 'app' is the only component today; future probes (db, push gateway,
		// CDN) can land here without a schema change.
		component: text('component').notNull(),
		level: statusLevel('level').notNull(),
		latencyMs: integer('latency_ms'),
		error: text('error')
	},
	(t) => ({
		componentTimeIdx: index('status_checks_component_time_idx').on(t.component, t.checkedAt),
		timeIdx: index('status_checks_time_idx').on(t.checkedAt)
	})
);

// Operator-declared incidents. Multiple updates per incident as the situation
// evolves. The public /status page shows active incidents at the top and
// recent resolved ones in a history below.
export const statusIncidents = pgTable(
	'status_incidents',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		title: text('title').notNull(),
		level: statusLevel('level').notNull(),
		status: incidentStatus('status').notNull().default('investigating'),
		startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
		resolvedAt: timestamp('resolved_at', { withTimezone: true }),
		declaredByUserId: uuid('declared_by_user_id').references(() => users.id, {
			onDelete: 'set null'
		}),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => ({
		statusIdx: index('status_incidents_status_idx').on(t.status, t.startedAt),
		startedIdx: index('status_incidents_started_idx').on(t.startedAt)
	})
);

export const statusIncidentUpdates = pgTable(
	'status_incident_updates',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		incidentId: uuid('incident_id')
			.notNull()
			.references(() => statusIncidents.id, { onDelete: 'cascade' }),
		status: incidentStatus('status').notNull(),
		body: text('body').notNull(),
		postedByUserId: uuid('posted_by_user_id').references(() => users.id, {
			onDelete: 'set null'
		}),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => ({
		incidentIdx: index('status_incident_updates_incident_idx').on(t.incidentId, t.createdAt)
	})
);

// ──────────────────────────── relations ────────────────────────────

export const usersRelations = relations(users, ({ many }) => ({
	identities: many(userIdentities),
	oidcIdentities: many(oidcIdentities),
	sessions: many(sessions),
	memberships: many(blogMembers)
}));

export const blogsRelations = relations(blogs, ({ many }) => ({
	members: many(blogMembers),
	snapshots: many(blogMemberSnapshots),
	posts: many(blogPosts)
}));

export const blogMembersRelations = relations(blogMembers, ({ one }) => ({
	blog: one(blogs, { fields: [blogMembers.blogId], references: [blogs.id] }),
	user: one(users, { fields: [blogMembers.userId], references: [users.id] })
}));

export const blogPostsRelations = relations(blogPosts, ({ one, many }) => ({
	blog: one(blogs, { fields: [blogPosts.blogId], references: [blogs.id] }),
	versions: many(blogPostVersions),
	currentVersion: one(blogPostVersions, {
		fields: [blogPosts.currentVersionId],
		references: [blogPostVersions.id]
	}),
	tags: many(blogPostTags)
}));

export const blogPostVersionsRelations = relations(blogPostVersions, ({ one, many }) => ({
	post: one(blogPosts, { fields: [blogPostVersions.postId], references: [blogPosts.id] }),
	reviews: many(postReviews),
	comments: many(postComments)
}));

export const blogPostTagsRelations = relations(blogPostTags, ({ one }) => ({
	post: one(blogPosts, { fields: [blogPostTags.postId], references: [blogPosts.id] }),
	tag: one(tags, { fields: [blogPostTags.tagId], references: [tags.id] })
}));

// ──────────────────────────── type aliases ────────────────────────────

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Blog = typeof blogs.$inferSelect;
export type BlogMember = typeof blogMembers.$inferSelect;
export type BlogMemberSnapshot = typeof blogMemberSnapshots.$inferSelect;
export type BlogPost = typeof blogPosts.$inferSelect;
export type BlogPostVersion = typeof blogPostVersions.$inferSelect;
export type UserIdentity = typeof userIdentities.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type PostReview = typeof postReviews.$inferSelect;
export type PostComment = typeof postComments.$inferSelect;
export type Tag = typeof tags.$inferSelect;
export type MemberRole = (typeof memberRole.enumValues)[number];
export type PostStatus = (typeof postStatus.enumValues)[number];

// Independent member capabilities (the source of truth replacing the single
// role enum). The three *proving* capabilities (author, review, comment) plus
// admin. Only author + comment back a Semaphore tree (review gates blind
// vote-token issuance, admin gates non-anonymous admin actions). The DB columns
// are can_author / can_review / can_comment / can_admin on blog_members.
export type Capability = 'author' | 'review' | 'comment' | 'admin';

// Capabilities that have their own per-capability Semaphore membership tree.
// Only 'author' (writers) and 'comment' (commenters). Votes use blind-signature
// tokens (Phase 5), NOT a reviewers tree, and 'admin' actions are
// session-authenticated (never proof-anonymous), so neither is a tree.
export type TreeCapability = 'author' | 'comment';
