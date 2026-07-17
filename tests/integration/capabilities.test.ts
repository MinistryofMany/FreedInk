// Phase 1 — capabilities model. Verifies:
//   1. capabilitiesForRole maps each legacy role to the right boolean set
//      (and matches the 0007 migration backfill SQL).
//   2. Every blog_members insert path (createBlog owner, setRole) populates the
//      capability columns consistently with the role.
//   3. hasCapability is exactly equivalent to the legacy hasRole(ROLES_*) check.
//   4. setCapability flips one column in place, leaves the others, and reports
//      the before/after sets.
//   5. The raw migration backfill SQL produces the documented mapping when run
//      over a row that only had `role` set (simulating a pre-migration row).
import { describe, it, expect } from 'vitest';
import { createUserWithEmail } from '$lib/db/users';
import { createBlog } from '$lib/db/blogs';
import {
	setRole,
	setCapability,
	hasCapability,
	capabilitiesForRole,
	getActiveMember,
	roleLabelFor
} from '$lib/db/members';
import {
	hasRole,
	ROLES_WRITING,
	ROLES_REVIEWING,
	ROLES_COMMENTING,
	ROLES_MANAGING
} from '$lib/server/auth';
import { db, schema } from '$lib/db/client';
import { eq, sql } from 'drizzle-orm';
import type { MemberRole, Capability } from '$lib/db/schema';

// The authoritative role→capability table from the design (and the migration).
const EXPECTED: Record<
	MemberRole,
	{ author: boolean; review: boolean; comment: boolean; admin: boolean }
> = {
	owner: { author: true, review: true, comment: true, admin: true },
	editor: { author: true, review: true, comment: true, admin: false },
	reviewer: { author: false, review: true, comment: true, admin: false },
	author: { author: true, review: false, comment: true, admin: false },
	commenter: { author: false, review: false, comment: true, admin: false }
};

describe('capabilitiesForRole', () => {
	it.each(Object.keys(EXPECTED) as MemberRole[])('maps %s correctly', (role) => {
		const caps = capabilitiesForRole(role);
		expect(caps.canAuthor).toBe(EXPECTED[role].author);
		expect(caps.canReview).toBe(EXPECTED[role].review);
		expect(caps.canComment).toBe(EXPECTED[role].comment);
		expect(caps.canAdmin).toBe(EXPECTED[role].admin);
	});
});

describe('insert paths populate capabilities', () => {
	it('createBlog gives the owner all capabilities', async () => {
		const owner = await createUserWithEmail('cap-o@x.com', 'cap-owner');
		const { id: blogId } = await createBlog(owner.id, 'Cap Blog', null);
		const m = await getActiveMember(blogId, owner.id);
		expect(m?.canAuthor).toBe(true);
		expect(m?.canReview).toBe(true);
		expect(m?.canComment).toBe(true);
		expect(m?.canAdmin).toBe(true);
	});

	it.each(['editor', 'reviewer', 'author', 'commenter'] as MemberRole[])(
		'setRole(%s) populates the matching capability columns',
		async (role) => {
			const owner = await createUserWithEmail(`cap-${role}-o@x.com`, `cap-${role}-o`);
			const target = await createUserWithEmail(`cap-${role}-t@x.com`, `cap-${role}-t`);
			const { id: blogId } = await createBlog(owner.id, `Cap ${role}`, null);
			await setRole(blogId, target.id, role, owner.id);
			const m = await getActiveMember(blogId, target.id);
			expect(m?.canAuthor).toBe(EXPECTED[role].author);
			expect(m?.canReview).toBe(EXPECTED[role].review);
			expect(m?.canComment).toBe(EXPECTED[role].comment);
			expect(m?.canAdmin).toBe(EXPECTED[role].admin);
		}
	);
});

describe('hasCapability parity with hasRole(ROLES_*)', () => {
	it('agrees with the legacy role sets for every role', async () => {
		const owner = await createUserWithEmail('par-o@x.com', 'par-o');
		const { id: blogId } = await createBlog(owner.id, 'Parity', null);

		const roles: MemberRole[] = ['editor', 'reviewer', 'author', 'commenter'];
		let n = 0;
		for (const role of roles) {
			const u = await createUserWithEmail(`par-${n}@x.com`, `par-${n}`);
			await setRole(blogId, u.id, role, owner.id);

			// author capability ≡ ROLES_WRITING
			expect(await hasCapability(blogId, u.id, 'author')).toBe(
				await hasRole(blogId, u.id, ROLES_WRITING)
			);
			// review capability ≡ ROLES_REVIEWING
			expect(await hasCapability(blogId, u.id, 'review')).toBe(
				await hasRole(blogId, u.id, ROLES_REVIEWING)
			);
			// comment capability ≡ ROLES_COMMENTING
			expect(await hasCapability(blogId, u.id, 'comment')).toBe(
				await hasRole(blogId, u.id, ROLES_COMMENTING)
			);
			// admin capability ≡ ROLES_MANAGING
			expect(await hasCapability(blogId, u.id, 'admin')).toBe(
				await hasRole(blogId, u.id, ROLES_MANAGING)
			);
			n++;
		}
	});

	it('returns false for a non-member', async () => {
		const owner = await createUserWithEmail('nm-o@x.com', 'nm-o');
		const stranger = await createUserWithEmail('nm-s@x.com', 'nm-s');
		const { id: blogId } = await createBlog(owner.id, 'NM', null);
		for (const cap of ['author', 'review', 'comment', 'admin'] as Capability[]) {
			expect(await hasCapability(blogId, stranger.id, cap)).toBe(false);
		}
	});
});

describe('setCapability', () => {
	it('flips one column in place and reports before/after', async () => {
		const owner = await createUserWithEmail('sc-o@x.com', 'sc-o');
		const target = await createUserWithEmail('sc-t@x.com', 'sc-t');
		const { id: blogId } = await createBlog(owner.id, 'SC', null);
		await setRole(blogId, target.id, 'commenter', owner.id);

		// Grant review to a commenter.
		const res = await setCapability(blogId, target.id, 'review', true);
		expect(res).not.toBeNull();
		expect(res!.before.canReview).toBe(false);
		expect(res!.after.canReview).toBe(true);
		// Other capabilities untouched.
		expect(res!.after.canAuthor).toBe(false);
		expect(res!.after.canComment).toBe(true);
		expect(res!.after.canAdmin).toBe(false);

		const m = await getActiveMember(blogId, target.id);
		expect(m?.canReview).toBe(true);
		expect(m?.canAuthor).toBe(false);
		expect(await hasCapability(blogId, target.id, 'review')).toBe(true);
	});

	it('is a no-op when the value already matches', async () => {
		const owner = await createUserWithEmail('sc2-o@x.com', 'sc2-o');
		const { id: blogId } = await createBlog(owner.id, 'SC2', null);
		// Owner already can_admin; setting it true again must be a clean no-op.
		const res = await setCapability(blogId, owner.id, 'admin', true);
		expect(res!.before.canAdmin).toBe(true);
		expect(res!.after.canAdmin).toBe(true);
	});

	it('returns null for a non-member', async () => {
		const owner = await createUserWithEmail('sc3-o@x.com', 'sc3-o');
		const stranger = await createUserWithEmail('sc3-s@x.com', 'sc3-s');
		const { id: blogId } = await createBlog(owner.id, 'SC3', null);
		expect(await setCapability(blogId, stranger.id, 'author', true)).toBeNull();
	});
});

describe('roleLabelFor', () => {
	it('round-trips each role through capabilitiesForRole', () => {
		// roleLabelFor picks the closest legacy union; it is exact for the five
		// canonical roles since those are the unions it recognizes.
		for (const role of Object.keys(EXPECTED) as MemberRole[]) {
			expect(roleLabelFor(capabilitiesForRole(role))).toBe(role);
		}
	});
});

describe('migration backfill SQL (0007)', () => {
	it('maps a raw role-only row to the documented capabilities', async () => {
		// Simulate a pre-migration row: insert with role set but capability columns
		// left at their false defaults, then run the EXACT backfill UPDATE from the
		// 0007 migration and assert the resulting columns.
		const owner = await createUserWithEmail('mig-o@x.com', 'mig-o');
		const { id: blogId } = await createBlog(owner.id, 'Mig', null);

		// Insert one bare member per role with capabilities deliberately wrong
		// (all false) to prove the backfill sets them.
		const ids: Record<MemberRole, string> = {} as Record<MemberRole, string>;
		let i = 0;
		for (const role of Object.keys(EXPECTED) as MemberRole[]) {
			if (role === 'owner') {
				ids[role] = owner.id;
				continue;
			}
			const u = await createUserWithEmail(`mig-${i}@x.com`, `mig-${i}`);
			ids[role] = u.id;
			await db.insert(schema.blogMembers).values({
				blogId,
				userId: u.id,
				role,
				canAuthor: false,
				canReview: false,
				canComment: false,
				canAdmin: false
			});
			i++;
		}

		// Run the exact backfill statement from migrations/0007 (scoped to this
		// blog so the per-test data is isolated).
		await db.execute(
			sql.raw(
				`UPDATE "blog_members" SET
        "can_author"  = "role" IN ('owner','editor','author'),
        "can_review"  = "role" IN ('owner','editor','reviewer'),
        "can_comment" = "role" IN ('owner','editor','reviewer','author','commenter'),
        "can_admin"   = "role" = 'owner'
       WHERE "blog_id" = '${blogId}'`
			)
		);

		for (const role of Object.keys(EXPECTED) as MemberRole[]) {
			const rows = await db
				.select()
				.from(schema.blogMembers)
				.where(eq(schema.blogMembers.userId, ids[role]));
			const m = rows.find((r) => r.blogId === blogId)!;
			expect(m.canAuthor, `${role}.author`).toBe(EXPECTED[role].author);
			expect(m.canReview, `${role}.review`).toBe(EXPECTED[role].review);
			expect(m.canComment, `${role}.comment`).toBe(EXPECTED[role].comment);
			expect(m.canAdmin, `${role}.admin`).toBe(EXPECTED[role].admin);
		}
	});
});
