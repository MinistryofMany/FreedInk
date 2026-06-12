export function sluggify(name: string) {
	return name
		.toLowerCase()
		.replace(/ /g, '-') // Replace spaces with hyphens
		.replace(/[^a-z0-9-_]/g, ''); // Remove any non-alphanumeric character except hyphen and underscore
}

export function unslug(slug: string) {
	return slug.replace(/-/g, ' ');
}

// BN254 scalar field prime, the field Semaphore signals must live in.
const SEMAPHORE_FIELD =
	21888242871839275222246405745257275088548364400416034343698204186575808495617n;

// Hash an arbitrary string into a BigInt that fits in the Semaphore field.
// Used for `signal` and `scope` arguments to Semaphore proofs — must be
// deterministic, collision-resistant, and < SEMAPHORE_FIELD.
export async function hashToField(message: string): Promise<bigint> {
	const data = new TextEncoder().encode(message);
	const buf = await crypto.subtle.digest('SHA-256', data);
	const hex = [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
	return BigInt('0x' + hex) % SEMAPHORE_FIELD;
}
