import { test, expect } from '@playwright/test';

// Hue-agnostic brightness check: take the computed background, parse the RGB
// triplet, and assert it's below a brightness threshold. Light bg ~ #e6f5f2
// (avg ≈ 235), dark bg ~ #1a1f1f (avg ≈ 30). A 100-ish midpoint is comfortably
// far from both.
function avgChannel(rgb: string): number {
	const m = rgb.match(/(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)/);
	if (!m) throw new Error(`could not parse color: ${rgb}`);
	return (parseFloat(m[1]) + parseFloat(m[2]) + parseFloat(m[3])) / 3;
}

test.describe('dark mode', () => {
	test.use({ colorScheme: 'dark' });

	test('OS dark preference renders dark body background', async ({ page }) => {
		await page.goto('/');
		const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
		const brightness = avgChannel(bg);
		expect(brightness, `body bg=${bg}`).toBeLessThan(100);
	});
});

test.describe('manual theme override', () => {
	test.use({ colorScheme: 'dark' });

	test('freedink_theme=light cookie wins over OS dark', async ({ page, context, baseURL }) => {
		await context.addCookies([
			{
				name: 'freedink_theme',
				value: 'light',
				url: baseURL ?? 'http://localhost:5175'
			}
		]);
		await page.goto('/');
		// data-theme attribute applied by the layout's onMount.
		await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
		const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
		const brightness = avgChannel(bg);
		expect(brightness, `body bg=${bg}`).toBeGreaterThan(180);
	});
});
