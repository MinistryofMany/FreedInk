import { test, expect } from '@playwright/test';

test.describe('public pages render', () => {
	test('home page', async ({ page }) => {
		await page.goto('/');
		await expect(
			page.getByRole('heading', { name: /put your name on the masthead/i })
		).toBeVisible();
		await expect(page.getByRole('link', { name: 'Start a collective' })).toBeVisible();
	});

	test('blogs index', async ({ page }) => {
		await page.goto('/b');
		await expect(page.getByRole('heading', { name: /featured blogs/i })).toBeVisible();
	});

	test('search page renders the search form', async ({ page }) => {
		await page.goto('/search');
		await expect(page.getByRole('searchbox')).toBeVisible();
		await expect(page.getByRole('combobox')).toBeVisible();
		await expect(page.getByRole('button', { name: 'Search' })).toBeVisible();
	});

	test('signup page offers Sign in with Minister', async ({ page }) => {
		await page.goto('/signup');
		await expect(page.getByRole('link', { name: /sign in with minister/i })).toBeVisible();
	});

	test('admin route redirects to /signup when unauthenticated', async ({ page }) => {
		const res = await page.goto('/admin');
		expect(page.url()).toContain('/signup');
		expect(res?.ok()).toBe(true);
	});

	test('navigation links present in header', async ({ page }) => {
		await page.goto('/');
		// exact:true so the header nav links don't also match the landing CTAs
		// ("Browse blogs" contains "Blogs" under the default substring match).
		await expect(page.getByRole('link', { name: 'Blogs', exact: true })).toBeVisible();
		await expect(page.getByRole('link', { name: 'Search', exact: true })).toBeVisible();
	});
});
