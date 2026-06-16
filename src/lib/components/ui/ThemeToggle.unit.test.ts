// @vitest-environment jsdom

import { describe, it, expect, afterEach } from 'vitest';
import { mount } from 'svelte';
import ThemeToggle from './ThemeToggle.svelte';

afterEach(() => {
	while (document.body.firstChild) {
		document.body.removeChild(document.body.firstChild);
	}
	// Clean up data-theme and cookie between tests
	document.documentElement.removeAttribute('data-theme');
	document.cookie = 'freedink_theme=; path=/; max-age=0';
});

describe('ThemeToggle', () => {
	it('mounting with initial="light" shows aria-label targeting dark', () => {
		const target = document.createElement('div');
		document.body.appendChild(target);
		mount(ThemeToggle, { target, props: { initial: 'light' } });
		const btn = target.querySelector('button')!;
		expect(btn.getAttribute('aria-label')).toBe('Switch to dark theme');
	});

	it('clicking from light advances to dark, sets data-theme and cookie', async () => {
		const target = document.createElement('div');
		document.body.appendChild(target);
		mount(ThemeToggle, { target, props: { initial: 'light' } });
		const btn = target.querySelector('button') as HTMLButtonElement;
		btn.click();
		await new Promise((r) => setTimeout(r, 0));

		expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
		expect(document.cookie).toContain('freedink_theme=dark');
		// label now points at auto
		expect(btn.getAttribute('aria-label')).toBe('Switch to auto theme');
	});

	it('clicking from dark to auto removes data-theme attribute', async () => {
		const target = document.createElement('div');
		document.body.appendChild(target);
		mount(ThemeToggle, { target, props: { initial: 'dark' } });
		const btn = target.querySelector('button') as HTMLButtonElement;
		btn.click();
		await new Promise((r) => setTimeout(r, 0));

		expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
		expect(btn.getAttribute('aria-label')).toBe('Switch to light theme');
	});

	it('mounting with no initial shows aria-label targeting light (auto mode)', () => {
		const target = document.createElement('div');
		document.body.appendChild(target);
		mount(ThemeToggle, { target, props: {} });
		const btn = target.querySelector('button')!;
		expect(btn.getAttribute('aria-label')).toBe('Switch to light theme');
	});
});
