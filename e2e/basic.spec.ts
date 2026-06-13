import { test, expect } from '@playwright/test';

test.describe('public pages render', () => {
	test('home page', async ({ page }) => {
		await page.goto('/');
		await expect(page.getByRole('heading', { name: /welcome to freed ink/i })).toBeVisible();
		await expect(page.getByRole('link', { name: 'Free Your Ink' })).toBeVisible();
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

	test('signup page offers Sign in with Tessera', async ({ page }) => {
		await page.goto('/signup');
		await expect(page.getByRole('link', { name: /sign in with tessera/i })).toBeVisible();
	});

	test('admin route redirects to /signup when unauthenticated', async ({ page }) => {
		const res = await page.goto('/admin');
		expect(page.url()).toContain('/signup');
		expect(res?.ok()).toBe(true);
	});

	test('navigation links present in header', async ({ page }) => {
		await page.goto('/');
		await expect(page.getByRole('link', { name: 'Blogs' })).toBeVisible();
		await expect(page.getByRole('link', { name: 'Search' })).toBeVisible();
	});
});
