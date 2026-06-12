// User-facing labels + descriptions for the rejection_reason enum. Shared
// between the reviewer UI (multi-select checkboxes when voting reject) and
// the author-facing rejected-post page (aggregated counts).
//
// Edit the order to control the order they're presented to reviewers.
// Severity is a hint for sorting in the aggregate view — high-severity reasons
// like harassment/legal float above quality/format complaints.

export const REJECTION_REASONS = [
	{
		key: 'low_quality',
		label: 'Low quality',
		description: 'Unclear, sloppy, or below the bar this blog publishes.',
		severity: 'low' as const
	},
	{
		key: 'bad_formatting',
		label: 'Formatting',
		description: 'Hard to read, broken markdown, missing structure.',
		severity: 'low' as const
	},
	{
		key: 'ai_generated',
		label: 'AI-generated',
		description: 'Reads as machine-written without disclosure or human edit.',
		severity: 'medium' as const
	},
	{
		key: 'rage_bait',
		label: 'Rage-bait',
		description: 'Designed to provoke outrage more than inform.',
		severity: 'medium' as const
	},
	{
		key: 'off_topic',
		label: 'Off-topic',
		description: "Doesn't fit this blog's stated focus.",
		severity: 'low' as const
	},
	{
		key: 'duplicate',
		label: 'Duplicate',
		description: 'Already covered by an existing published post.',
		severity: 'low' as const
	},
	{
		key: 'factual_errors',
		label: 'Factual errors',
		description: 'Contains claims that are demonstrably wrong.',
		severity: 'medium' as const
	},
	{
		key: 'harassment',
		label: 'Harassment',
		description: 'Targets a person or group in a way that crosses the line.',
		severity: 'high' as const
	},
	{
		key: 'legal',
		label: 'Legal concern',
		description: 'Copyright violation, defamation, or other legal risk.',
		severity: 'high' as const
	},
	{
		key: 'other',
		label: 'Other',
		description: 'Use the comment field to explain.',
		severity: 'low' as const
	}
] as const;

export type RejectionReasonKey = (typeof REJECTION_REASONS)[number]['key'];

const KEYS = new Set(REJECTION_REASONS.map((r) => r.key));

export function isValidRejectionReason(s: string): s is RejectionReasonKey {
	return KEYS.has(s as RejectionReasonKey);
}

export function labelForReason(key: string): string {
	return REJECTION_REASONS.find((r) => r.key === key)?.label ?? key;
}
