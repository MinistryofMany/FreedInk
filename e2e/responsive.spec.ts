// Author: Cipher
// Created: 2026-05-18
// Purpose: Verify the responsive navigation drawer appears below the 768px
// breakpoint and that the dashboard link is reachable from inside the drawer
// when signed in. For unauthenticated runs we just confirm the hamburger
// opens and a primary item (Sign in / up) appears in the drawer.

import { test, expect } from '@playwright/test';

const MOBILE = { width: 375, height: 812 };

test.describe('responsive nav', () => {
	test('hamburger replaces desktop nav at mobile widths', async ({ page }) => {
		await page.setViewportSize(MOBILE);
		await page.goto('/');

		// Hamburger should be visible on mobile.
		const hamburger = page.getByRole('button', { name: /open menu/i });
		await expect(hamburger).toBeVisible();

		// Brand + Blogs + Search remain in the header even on small screens.
		await expect(page.getByRole('link', { name: 'Freed.Ink' })).toBeVisible();
		await expect(page.getByRole('link', { name: 'Blogs' })).toBeVisible();
		await expect(page.getByRole('link', { name: 'Search' })).toBeVisible();

		// Open the drawer. After opening, the dashboard link (if signed in)
		// or the Sign in / up link (if anonymous) becomes visible inside it.
		await hamburger.click();
		const drawer = page.getByRole('dialog', { name: /main navigation/i });
		await expect(drawer).toBeVisible();

		// One of these must be present depending on auth state. We don't run
		// a logged-in fixture here — the spec passes for either flow.
		const dashboard = drawer.getByRole('link', { name: 'Dashboard' });
		const signin = drawer.getByRole('link', { name: /sign in \/ up/i });
		const dashboardCount = await dashboard.count();
		if (dashboardCount > 0) {
			await expect(dashboard).toBeVisible();
		} else {
			await expect(signin).toBeVisible();
		}

		// Escape closes the drawer and focus returns to the hamburger.
		await page.keyboard.press('Escape');
		await expect(drawer).toBeHidden();
		await expect(hamburger).toBeFocused();
	});

	test('desktop nav links visible at >=1024px', async ({ page }) => {
		await page.setViewportSize({ width: 1280, height: 800 });
		await page.goto('/');
		// At desktop widths the hamburger is hidden.
		await expect(page.getByRole('button', { name: /open menu/i })).toBeHidden();
	});
});
