import { test, expect } from '@playwright/test';
import { attachVirtualAuthenticator, detachVirtualAuthenticator } from './_utils';

test.describe('passkey register + identity create', () => {
	test('full registration flow lands on /admin with the identity present', async ({ page }) => {
		const { session, authenticatorId } = await attachVirtualAuthenticator(page);
		try {
			await page.goto('/signup');

			// Default tab is "Create account". Fill email + username and submit.
			const stamp = Date.now();
			const email = `pk${stamp}@example.com`;
			const username = `pk${stamp}`.slice(0, 32);
			await page.getByLabel('Email').fill(email);
			await page.getByLabel('Username').fill(username);
			await page.getByRole('button', { name: /register with passkey/i }).click();

			// Should be redirected to /signup/identity.
			await page.waitForURL('**/signup/identity', { timeout: 15_000 });
			await expect(page.getByRole('heading', { name: /set your identity password/i })).toBeVisible();

			// Set a password and create the identity.
			const password = 'aVeryStrongPassword12345';
			await page.getByLabel('Password', { exact: true }).fill(password);
			await page.getByLabel('Confirm', { exact: true }).fill(password);
			await page.getByRole('button', { name: /create identity/i }).click();

			// Land on /admin.
			await page.waitForURL('**/admin', { timeout: 15_000 });
			await expect(page.getByText(/welcome/i)).toBeVisible();
			await expect(page.getByRole('link', { name: /dashboard/i })).toBeVisible();
		} finally {
			await detachVirtualAuthenticator(session, authenticatorId);
		}
	});

	test('settings page lists the newly-added passkey and the active identity', async ({ page }) => {
		const { session, authenticatorId } = await attachVirtualAuthenticator(page);
		try {
			const stamp = Date.now();
			const email = `s${stamp}@example.com`;
			const username = `s${stamp}`.slice(0, 32);

			await page.goto('/signup');
			await page.getByLabel('Email').fill(email);
			await page.getByLabel('Username').fill(username);
			await page.getByRole('button', { name: /register with passkey/i }).click();
			await page.waitForURL('**/signup/identity', { timeout: 15_000 });
			await page.getByLabel('Password', { exact: true }).fill('aVeryStrongPassword12345');
			await page.getByLabel('Confirm', { exact: true }).fill('aVeryStrongPassword12345');
			await page.getByRole('button', { name: /create identity/i }).click();
			await page.waitForURL('**/admin', { timeout: 15_000 });

			await page.goto('/settings');
			await expect(page.getByRole('heading', { name: 'Passkeys' })).toBeVisible();
			await expect(page.getByRole('heading', { name: 'Identity' })).toBeVisible();
			await expect(page.getByText(/· active/)).toBeVisible();
			await expect(page.getByText('default')).toBeVisible();
		} finally {
			await detachVirtualAuthenticator(session, authenticatorId);
		}
	});
});
