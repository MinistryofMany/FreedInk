// Build-time stub for the OPTIONAL peer dependency @ministryofmany/rln, which
// FreedInk deliberately does NOT install: FreedInk is Semaphore-only and never
// selects the RLN proof engine.
//
// WHY THIS EXISTS: @ministryofmany/membership keeps its RLN engine behind a lazy
// dynamic import, so at Node RUNTIME a semaphore-only consumer never loads the
// RLN island (the integration tests confirm this). But a BUNDLER (rolldown, via
// Vite) still walks that lazy chunk to emit it, and the chunk statically imports
// named exports from @ministryofmany/rln. With the peer absent, Vite's automatic
// optional-peer stub has NO named exports, so the production build fails with
// MISSING_EXPORT for each name. Aliasing @ministryofmany/rln to this module (see
// vite.config.ts resolve.alias) provides those names so the lazy chunk builds.
//
// None of these ever execute: FreedInk's provider.engine is always 'semaphore',
// so membership's loadRlnEngine() (the only path that dynamically imports the RLN
// chunk) is never called. They throw loudly if that assumption is ever violated.
//
// FOLLOW-UP (packaging): ideally @ministryofmany/membership marks @ministryofmany/rln
// external in its own tsup build (so the lazy chunk keeps a runtime-only bare
// import a bundler won't resolve), or fully isolates the RLN chunk, removing the
// need for this consumer-side stub. Tracked as a Stage 0 packaging gap.

function absent(name: string): never {
	throw new Error(
		`@ministryofmany/rln.${name} was invoked, but FreedInk is Semaphore-only and ` +
			`does not install the RLN engine. This stub must never execute.`
	);
}

export const computeRoot = (): never => absent('computeRoot');
export const getRateCommitmentHash = (): never => absent('getRateCommitmentHash');
export const calculateSignalHash = (): never => absent('calculateSignalHash');
export const generateRlnProof = (): never => absent('generateRlnProof');
export const verifyRlnProof = (): never => absent('verifyRlnProof');
export const staticArtifactSource = (): never => absent('staticArtifactSource');
