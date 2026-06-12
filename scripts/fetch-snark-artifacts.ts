// Download Semaphore proving artifacts (.wasm + .zkey) for every supported
// tree depth, save them under static/snark-artifacts/, and record SHA-256
// hashes in snark-artifacts.lock.json.
//
// Why we vendor these:
// • Removes the runtime dependency on snark-artifacts.pse.dev for the prover.
// • The .zkey for higher depths is ~tens of MB; serving from the app origin
//   beats first-load fetch latency through a CDN that may be cold.
// • If the CDN ever rotates artifacts (which would break in-flight proofs),
//   the lock file catches the drift and CI fails loudly instead of silently
//   producing proofs against a different zkey than verifiers expect.
//
// The client (src/lib/client/semaphore.ts) tries the local copy first and
// falls back to the CDN if local is missing or fails.
import { mkdir, writeFile, readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const CDN_BASE = 'https://snark-artifacts.pse.dev/semaphore/latest';
const OUT_DIR = join(process.cwd(), 'static', 'snark-artifacts', 'semaphore');
const LOCK_FILE = join(process.cwd(), 'snark-artifacts.lock.json');

// Cover blogs up to 2^16 = 65,536 members. Bigger groups exist but we'd want
// to revisit storage/UX before targeting them.
const DEPTHS = (() => {
	const v = process.env.SEMAPHORE_DEPTHS;
	if (v) return v.split(',').map((n) => Number(n.trim()));
	const range: number[] = [];
	for (let i = 1; i <= 16; i++) range.push(i);
	return range;
})();

type ArtifactRecord = {
	url: string;
	bytes: number;
	sha256: string;
};

type LockFile = {
	cdnBase: string;
	fetchedAt: string;
	artifacts: Record<string, { wasm: ArtifactRecord; zkey: ArtifactRecord }>;
};

function sha256(buf: Uint8Array): string {
	return createHash('sha256').update(buf).digest('hex');
}

async function exists(path: string): Promise<boolean> {
	try {
		await stat(path);
		return true;
	} catch {
		return false;
	}
}

async function loadLock(): Promise<LockFile | null> {
	if (!(await exists(LOCK_FILE))) return null;
	const raw = await readFile(LOCK_FILE, 'utf8');
	return JSON.parse(raw) as LockFile;
}

async function downloadOne(url: string): Promise<Uint8Array> {
	const res = await fetch(url);
	if (!res.ok) throw new Error(`fetch ${url} → ${res.status} ${res.statusText}`);
	return new Uint8Array(await res.arrayBuffer());
}

async function fetchArtifact(
	depth: number,
	kind: 'wasm' | 'zkey',
	knownHash: string | undefined,
	{ force }: { force: boolean }
): Promise<ArtifactRecord> {
	const url = `${CDN_BASE}/semaphore-${depth}.${kind}`;
	const outPath = join(OUT_DIR, String(depth), `semaphore-${depth}.${kind}`);

	if (!force && knownHash && (await exists(outPath))) {
		const onDisk = await readFile(outPath);
		const localHash = sha256(onDisk);
		if (localHash === knownHash) {
			return { url, bytes: onDisk.byteLength, sha256: localHash };
		}
		console.warn(
			`[depth ${depth}/${kind}] local hash mismatch (${localHash.slice(0, 8)} vs lock ${knownHash.slice(0, 8)}), redownloading`
		);
	}

	console.log(`[depth ${depth}/${kind}] downloading ${url}`);
	const buf = await downloadOne(url);
	const hash = sha256(buf);
	await mkdir(join(OUT_DIR, String(depth)), { recursive: true });
	await writeFile(outPath, buf);

	if (knownHash && knownHash !== hash && !force) {
		throw new Error(
			`CDN hash for depth ${depth}/${kind} drifted: lock=${knownHash} cdn=${hash}. ` +
				`Re-run with FORCE=1 if this is intentional (e.g. Semaphore released new artifacts).`
		);
	}

	const sizeKb = (buf.byteLength / 1024).toFixed(1);
	console.log(`[depth ${depth}/${kind}] ${sizeKb} KiB, sha256 ${hash.slice(0, 16)}…`);
	return { url, bytes: buf.byteLength, sha256: hash };
}

async function main() {
	const force = process.env.FORCE === '1';
	const onlyCheck = process.env.CHECK_ONLY === '1';
	if (onlyCheck) console.log('CHECK_ONLY=1 — failing if any artifact is missing or hashes drift');

	const prior = await loadLock();
	const next: LockFile = {
		cdnBase: CDN_BASE,
		fetchedAt: new Date().toISOString(),
		artifacts: {}
	};

	for (const depth of DEPTHS) {
		const priorRow = prior?.artifacts[String(depth)];
		if (onlyCheck && !priorRow) {
			throw new Error(`depth ${depth} missing from lock file but required`);
		}
		const wasm = await fetchArtifact(depth, 'wasm', priorRow?.wasm.sha256, { force });
		const zkey = await fetchArtifact(depth, 'zkey', priorRow?.zkey.sha256, { force });
		next.artifacts[String(depth)] = { wasm, zkey };
	}

	if (onlyCheck) {
		console.log('all artifacts present and match lockfile');
		return;
	}

	// Skip the rewrite when nothing actually changed, so `npm run build`
	// (which runs this as prebuild) doesn't dirty the tree just to bump
	// `fetchedAt`. Both sides come from the same record shape, so a JSON
	// comparison is a reliable deep-equal here.
	const unchanged =
		prior !== null &&
		prior.cdnBase === CDN_BASE &&
		JSON.stringify(prior.artifacts) === JSON.stringify(next.artifacts);
	if (unchanged) {
		console.log(`lock file unchanged — leaving ${LOCK_FILE} as-is`);
		return;
	}

	await writeFile(LOCK_FILE, JSON.stringify(next, null, 2) + '\n');
	const totalBytes = DEPTHS.reduce((acc, d) => {
		const r = next.artifacts[String(d)];
		return acc + r.wasm.bytes + r.zkey.bytes;
	}, 0);
	console.log(`wrote ${LOCK_FILE} · ${(totalBytes / 1024 / 1024).toFixed(1)} MiB total`);
}

await main();
