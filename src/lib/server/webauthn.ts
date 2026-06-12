import {
	generateRegistrationOptions,
	generateAuthenticationOptions,
	verifyRegistrationResponse,
	verifyAuthenticationResponse,
	type GenerateRegistrationOptionsOpts,
	type GenerateAuthenticationOptionsOpts
} from '@simplewebauthn/server';
import type {
	RegistrationResponseJSON,
	AuthenticationResponseJSON,
	AuthenticatorTransportFuture
} from '@simplewebauthn/types';
import { db, schema } from '$lib/db/client';
import { and, eq, gt } from 'drizzle-orm';
import { env as publicEnv } from '$env/dynamic/public';

// SvelteKit's `$env/dynamic/private` *excludes* anything starting with the
// PUBLIC_ prefix; the PUBLIC_* names live in `$env/dynamic/public` instead.
const RP_ID = publicEnv.PUBLIC_RP_ID ?? 'localhost';
const RP_NAME = publicEnv.PUBLIC_RP_NAME ?? 'Freed Ink';
const ORIGIN = publicEnv.PUBLIC_ORIGIN ?? 'http://localhost:5173';
const CHALLENGE_TTL_MS = 5 * 60 * 1000;

function expiresAt(): Date {
	return new Date(Date.now() + CHALLENGE_TTL_MS);
}

function b64urlBytes(s: string): Uint8Array {
	const pad = '='.repeat((4 - (s.length % 4)) % 4);
	return new Uint8Array(Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64'));
}

function bytesB64url(b: Uint8Array): string {
	return Buffer.from(b).toString('base64url');
}

export async function startRegistration(opts: {
	userId: string;
	username: string;
	excludeCredentialIds?: Uint8Array[];
}) {
	const options = await generateRegistrationOptions({
		rpName: RP_NAME,
		rpID: RP_ID,
		userID: new TextEncoder().encode(opts.userId),
		userName: opts.username,
		attestationType: 'none',
		authenticatorSelection: {
			residentKey: 'preferred',
			userVerification: 'preferred'
		},
		excludeCredentials: (opts.excludeCredentialIds ?? []).map((id) => ({
			id: bytesB64url(id)
		}))
	} satisfies GenerateRegistrationOptionsOpts);

	await db.insert(schema.webauthnChallenges).values({
		userId: opts.userId,
		challenge: options.challenge,
		kind: 'register',
		expiresAt: expiresAt()
	});

	return options;
}

export async function finishRegistration(opts: {
	userId: string;
	response: RegistrationResponseJSON;
	nickname?: string;
}): Promise<{ ok: true }> {
	const challengeRows = await db
		.select()
		.from(schema.webauthnChallenges)
		.where(
			and(
				eq(schema.webauthnChallenges.userId, opts.userId),
				eq(schema.webauthnChallenges.kind, 'register'),
				gt(schema.webauthnChallenges.expiresAt, new Date())
			)
		)
		.orderBy(schema.webauthnChallenges.expiresAt);
	const challenge = challengeRows.at(-1);
	if (!challenge) throw new Error('no pending challenge');

	const verification = await verifyRegistrationResponse({
		response: opts.response,
		expectedChallenge: challenge.challenge,
		expectedOrigin: ORIGIN,
		expectedRPID: RP_ID
	});
	if (!verification.verified || !verification.registrationInfo) {
		throw new Error('registration failed');
	}

	const info = verification.registrationInfo;
	const credential = info.credential;

	await db.insert(schema.passkeyCredentials).values({
		userId: opts.userId,
		credentialId: b64urlBytes(credential.id),
		publicKey: credential.publicKey,
		counter: credential.counter,
		transports: (credential.transports ?? []) as string[],
		aaguid:
			info.aaguid && info.aaguid !== '00000000-0000-0000-0000-000000000000' ? info.aaguid : null,
		nickname: opts.nickname ?? null
	});

	await db.delete(schema.webauthnChallenges).where(eq(schema.webauthnChallenges.id, challenge.id));
	return { ok: true };
}

export async function startAuthentication(opts: { userId?: string; email?: string | null }) {
	let userId = opts.userId;
	if (!userId && opts.email) {
		const u = await db
			.select({ id: schema.users.id })
			.from(schema.users)
			.where(eq(schema.users.email, opts.email.toLowerCase()))
			.limit(1);
		userId = u[0]?.id;
	}

	let allowCredentials: Array<{ id: string; transports?: AuthenticatorTransportFuture[] }> = [];
	if (userId) {
		const creds = await db
			.select()
			.from(schema.passkeyCredentials)
			.where(eq(schema.passkeyCredentials.userId, userId));
		allowCredentials = creds.map((c) => ({
			id: bytesB64url(c.credentialId),
			transports: (c.transports ?? []) as AuthenticatorTransportFuture[]
		}));
	}

	const options = await generateAuthenticationOptions({
		rpID: RP_ID,
		userVerification: 'preferred',
		allowCredentials
	} satisfies GenerateAuthenticationOptionsOpts);

	await db.insert(schema.webauthnChallenges).values({
		userId: userId ?? null,
		email: opts.email ?? null,
		challenge: options.challenge,
		kind: 'auth',
		expiresAt: expiresAt()
	});

	return options;
}

export async function finishAuthentication(opts: {
	response: AuthenticationResponseJSON;
	email?: string | null;
}): Promise<{ userId: string }> {
	const credentialIdBytes = b64urlBytes(opts.response.id);

	const credRows = await db
		.select()
		.from(schema.passkeyCredentials)
		.where(eq(schema.passkeyCredentials.credentialId, credentialIdBytes))
		.limit(1);
	const credential = credRows[0];
	if (!credential) throw new Error('unknown credential');

	const challengeRows = await db
		.select()
		.from(schema.webauthnChallenges)
		.where(
			and(
				eq(schema.webauthnChallenges.kind, 'auth'),
				gt(schema.webauthnChallenges.expiresAt, new Date())
			)
		);
	const candidate = challengeRows.find(
		(c) =>
			(c.userId && c.userId === credential.userId) ||
			(opts.email && c.email === opts.email.toLowerCase())
	);
	if (!candidate) throw new Error('no matching challenge');

	const verification = await verifyAuthenticationResponse({
		response: opts.response,
		expectedChallenge: candidate.challenge,
		expectedOrigin: ORIGIN,
		expectedRPID: RP_ID,
		credential: {
			id: bytesB64url(credential.credentialId),
			publicKey: credential.publicKey,
			counter: Number(credential.counter),
			transports: (credential.transports ?? undefined) as AuthenticatorTransportFuture[] | undefined
		}
	});
	if (!verification.verified) throw new Error('authentication failed');

	await db
		.update(schema.passkeyCredentials)
		.set({
			counter: Number(verification.authenticationInfo.newCounter),
			lastUsedAt: new Date()
		})
		.where(eq(schema.passkeyCredentials.id, credential.id));
	await db.delete(schema.webauthnChallenges).where(eq(schema.webauthnChallenges.id, candidate.id));

	return { userId: credential.userId };
}
