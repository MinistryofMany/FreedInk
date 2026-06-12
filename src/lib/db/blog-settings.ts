// Settings mutations for a blog: title/description and the approval threshold
// (numerator/denominator). Threshold is stored as an exact ratio so the tally
// path can do `approves >= ceil(num/den * eligible)` without float drift.
//
// Validation rules:
//   1 <= numerator <= denominator <= 100
// Denominator > 100 is just a sanity cap — a board of 100 voters where you
// need >100/100 makes no sense. Keep both as small ints.
import { db, schema } from './client';
import { eq } from 'drizzle-orm';
import { sluggify } from '$lib/utils';
import { error } from '@sveltejs/kit';
import { isValidLanguageCode, normalizeLanguageCode } from '$lib/languages';

export type UpdateBlogSettingsPatch = {
	approvalNumerator?: number;
	approvalDenominator?: number;
	description?: string | null;
	title?: string;
	defaultLanguage?: string;
};

function isInt(n: unknown): n is number {
	return typeof n === 'number' && Number.isInteger(n);
}

export async function updateBlogSettings(blogId: string, patch: UpdateBlogSettingsPatch) {
	const before = await db
		.select()
		.from(schema.blogs)
		.where(eq(schema.blogs.id, blogId))
		.limit(1);
	if (before.length === 0) throw error(404, 'blog not found');
	const current = before[0];

	const nextNum = patch.approvalNumerator ?? current.approvalNumerator;
	const nextDen = patch.approvalDenominator ?? current.approvalDenominator;

	// Validate thresholds even if neither was sent — protects against a
	// historically bad row landing here via some other path.
	if (
		!isInt(nextNum) ||
		!isInt(nextDen) ||
		nextNum < 1 ||
		nextDen < 1 ||
		nextDen > 100 ||
		nextNum > nextDen
	) {
		throw error(422, 'invalid threshold: require 1 <= numerator <= denominator <= 100');
	}

	const update: Partial<typeof current> = {};
	if (patch.approvalNumerator !== undefined) update.approvalNumerator = nextNum;
	if (patch.approvalDenominator !== undefined) update.approvalDenominator = nextDen;
	if (patch.description !== undefined) update.description = patch.description;
	if (patch.title !== undefined) {
		const title = patch.title.trim();
		if (title.length === 0) throw error(422, 'title cannot be empty');
		update.title = title;
		update.slug = sluggify(title);
	}
	if (patch.defaultLanguage !== undefined) {
		if (!isValidLanguageCode(patch.defaultLanguage)) {
			throw error(422, 'unsupported language code');
		}
		update.defaultLanguage = normalizeLanguageCode(patch.defaultLanguage);
	}

	if (Object.keys(update).length === 0) return current;

	const [updated] = await db
		.update(schema.blogs)
		.set(update)
		.where(eq(schema.blogs.id, blogId))
		.returning();
	return updated;
}
