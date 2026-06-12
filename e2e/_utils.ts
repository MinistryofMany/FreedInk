// Shared helpers for Playwright tests.
import type { Page, CDPSession } from '@playwright/test';

// Attach a Chromium "virtual authenticator" so WebAuthn (passkey) ceremonies
// complete without a real device. Default config = an internal, resident,
// user-verified authenticator (matches what a Mac Touch ID does).
export async function attachVirtualAuthenticator(
	page: Page
): Promise<{ session: CDPSession; authenticatorId: string }> {
	const client = await page.context().newCDPSession(page);
	await client.send('WebAuthn.enable');
	const { authenticatorId } = await client.send('WebAuthn.addVirtualAuthenticator', {
		options: {
			protocol: 'ctap2',
			transport: 'internal',
			hasResidentKey: true,
			hasUserVerification: true,
			isUserVerified: true,
			automaticPresenceSimulation: true
		}
	});
	return { session: client, authenticatorId };
}

export async function detachVirtualAuthenticator(session: CDPSession, authenticatorId: string) {
	try {
		await session.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId });
	} catch {
		// ignore
	}
}
