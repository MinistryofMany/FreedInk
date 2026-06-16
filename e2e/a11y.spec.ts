// Automated accessibility audit with axe-core. Scans the main pages in BOTH
// the light and dark palettes (the redesign ships both) against WCAG 2.0/2.1
// A + AA. This complements the token-level contrast guard
// (src/lib/a11y/tokens.contrast.unit.test.ts) by checking the live DOM —
// landmarks, names/roles, form labels, and real rendered colour contrast.
import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { signInAsNewUser } from './_session';

const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const THEMES = ['light', 'dark'] as const;

async function applyTheme(page: Page, baseURL: string | undefined, theme: string) {
	await page
		.context()
		.addCookies([
			{ name: 'freedink_theme', value: theme, url: baseURL ?? 'http://localhost:5175' }
		]);
}

async function auditCurrentPage(page: Page, theme: string) {
	// The layout applies data-theme from the cookie on mount; wait for it so axe
	// scans the intended palette (matters for the colour-contrast rule).
	await page.waitForFunction((t) => document.documentElement.dataset.theme === t, theme, {
		timeout: 10_000
	});
	const { violations } = await new AxeBuilder({ page }).withTags(WCAG).analyze();
	const summary = violations
		.map(
			(v) =>
				`${v.id} [${v.impact}] ×${v.nodes.length}: ${v.help}\n    ${v.nodes[0]?.target.join(' ')}`
		)
		.join('\n');
	expect(violations, summary || 'no violations').toEqual([]);
}

// Pages that render meaningfully without seeded content.
const PUBLIC_PAGES = ['/', '/b', '/search', '/signup', '/status', '/legal/privacy'];

for (const theme of THEMES) {
	test.describe(`a11y · ${theme}`, () => {
		for (const path of PUBLIC_PAGES) {
			test(`${path}`, async ({ page, baseURL }) => {
				await applyTheme(page, baseURL, theme);
				await page.goto(path);
				await auditCurrentPage(page, theme);
			});
		}

		test('/signup/identity (authed)', async ({ page, baseURL }) => {
			await signInAsNewUser(page, { username: `axe${theme}i${Date.now()}`.slice(0, 32) });
			await applyTheme(page, baseURL, theme);
			await page.goto('/signup/identity');
			await auditCurrentPage(page, theme);
		});

		test('/settings (authed)', async ({ page, baseURL }) => {
			await signInAsNewUser(page, { username: `axe${theme}s${Date.now()}`.slice(0, 32) });
			await applyTheme(page, baseURL, theme);
			await page.goto('/settings');
			await auditCurrentPage(page, theme);
		});
	});
}
