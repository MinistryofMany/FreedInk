<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { browser } from '$app/environment';
	import { page } from '$app/stores';
	import { prewarmForAuthedUser } from '$lib/client/semaphore';
	import '$lib/styles/tokens.css';
	import '$lib/styles/base.css';
	import '$lib/styles/fonts.ts';
	// Side-effect import: registers locales and initializes svelte-i18n on
	// module load. Importing `_` and `locale` here gives us the translator
	// store + a way to flip languages at runtime.
	import { _, locale, SUPPORTED_LOCALES } from '$lib/i18n';

	export let data;
	$: signedIn = !!data.user;

	// Locale switcher: writes a year-long `locale` cookie so SSR (once
	// hooks.server.ts is wired — see lib/server/locale.ts) can pick it up on
	// subsequent requests. We also flip the live store immediately so the UI
	// updates without a reload.
	function setLocale(next: string) {
		if (browser) {
			document.cookie = `locale=${encodeURIComponent(next)}; path=/; max-age=31536000; SameSite=Lax`;
			document.documentElement.lang = next;
		}
		locale.set(next);
	}

	function onLocaleChange(ev: Event) {
		setLocale((ev.currentTarget as HTMLSelectElement).value);
	}

	// Keep <html lang> in sync with the active locale.
	$: if (browser && $locale) {
		document.documentElement.lang = $locale;
	}

	// Strategy: anonymous visitors never load the prover (saves ~370 KB of JS
	// + ~3-6 MB of wasm/zkey). The moment we know the user is authenticated,
	// kick off both the snarkjs+semaphore chunk download and an artifact
	// prefetch on idle time. First proof generation then hits warm cache.
	let prewarmedFor: string | null = null;
	$: if (browser && data.user && data.user.id !== prewarmedFor) {
		prewarmedFor = data.user.id;
		prewarmForAuthedUser();
	}

	// Mobile drawer state. The drawer holds the right-side nav (Dashboard /
	// username / Sign out, or the Sign in link). The brand + Blogs + Search stay
	// visible at the top so users always have the primary entry points.
	let drawerOpen = false;
	let drawerEl: HTMLElement | null = null;
	let hamburgerBtn: HTMLButtonElement | null = null;
	let previouslyFocused: HTMLElement | null = null;

	async function openDrawer() {
		previouslyFocused = (document.activeElement as HTMLElement) ?? null;
		drawerOpen = true;
		await tick();
		// Focus the first focusable element inside the drawer.
		const first = drawerEl?.querySelector<HTMLElement>(
			'a, button, input, select, textarea, [tabindex]:not([tabindex="-1"])'
		);
		first?.focus();
	}

	function closeDrawer() {
		drawerOpen = false;
		// Restore focus to whatever element opened the drawer (usually the
		// hamburger). tick() not strictly required — focus call queues fine.
		const target = previouslyFocused ?? hamburgerBtn;
		target?.focus();
	}

	// Keyboard handling: Esc closes, Tab cycles within the drawer to keep the
	// focus trap. Native focus order works for cycling; we just block escape
	// when at the boundary.
	function onDrawerKeydown(ev: KeyboardEvent) {
		if (!drawerOpen) return;
		if (ev.key === 'Escape') {
			ev.preventDefault();
			closeDrawer();
			return;
		}
		if (ev.key !== 'Tab' || !drawerEl) return;
		const focusables = Array.from(
			drawerEl.querySelectorAll<HTMLElement>(
				'a, button, input, select, textarea, [tabindex]:not([tabindex="-1"])'
			)
		).filter((el) => !el.hasAttribute('disabled'));
		if (focusables.length === 0) return;
		const first = focusables[0];
		const last = focusables[focusables.length - 1];
		if (ev.shiftKey && document.activeElement === first) {
			ev.preventDefault();
			last.focus();
		} else if (!ev.shiftKey && document.activeElement === last) {
			ev.preventDefault();
			first.focus();
		}
	}

	// Close the drawer on navigation. Subscribe to page; when the URL changes
	// while the drawer is open, dismiss it so the user lands on the next page
	// without an open overlay.
	let lastPath = '';
	$: if (browser && $page.url.pathname !== lastPath) {
		lastPath = $page.url.pathname;
		if (drawerOpen) drawerOpen = false;
	}

	// aria-current="page" helper — exact-match for /, prefix-match for the rest
	// so nested admin/blog pages still highlight the parent link.
	function isCurrent(href: string): 'page' | undefined {
		const path = $page.url.pathname;
		if (href === '/') return path === '/' ? 'page' : undefined;
		return path === href || path.startsWith(href + '/') ? 'page' : undefined;
	}

	// Theme handling. The initial value is taken from the SSR-served cookie so
	// the very first paint already matches user preference. If no cookie is
	// set, `theme` is null and we fall back to the OS via prefers-color-scheme
	// in the CSS — no data-theme attribute on <html>.
	const initialTheme: 'light' | 'dark' | null = data.theme ?? null;

	onMount(() => {
		if (data.user) {
			prewarmedFor = data.user.id;
			prewarmForAuthedUser();
		}
		// Re-apply the theme attribute from cookie on mount. The cookie is the
		// source of truth; SSR may render without an attribute (when no
		// preference is stored), in which case the CSS media query takes over
		// automatically — nothing for us to do.
		applyThemeAttribute(initialTheme);
	});

	function applyThemeAttribute(theme: 'light' | 'dark' | null) {
		if (typeof document === 'undefined') return;
		const html = document.documentElement;
		if (theme === 'light' || theme === 'dark') {
			html.setAttribute('data-theme', theme);
		} else {
			html.removeAttribute('data-theme');
		}
	}

	async function signOut() {
		await fetch('/api/signout', { method: 'POST' });
		window.location.href = '/';
	}
</script>

<svelte:window on:keydown={onDrawerKeydown} />

<!-- Skip-to-content target jumped to from the .skip-link below. -->
<a class="skip-link" href="#main-content">{$_('a11y.skip_to_content')}</a>

<header>
	<nav aria-label={$_('a11y.nav_primary')}>
		<div class="brand">
			<a href="/" class="nav-title" aria-current={isCurrent('/')}>{$_('nav.brand')}</a>
			<a href="/b" aria-current={isCurrent('/b')}>{$_('nav.blogs')}</a>
			<a href="/search" aria-current={isCurrent('/search')}>{$_('nav.search')}</a>
		</div>

		<!-- Desktop right nav. Hidden below 768px in favor of the hamburger. -->
		<div class="nav-right desktop-only">
			{#if signedIn}
				<a href="/admin" aria-current={isCurrent('/admin')}>{$_('nav.dashboard')}</a>
				<a href="/settings" aria-current={isCurrent('/settings')}
					>{data.user?.displayName?.trim() || data.user?.username}</a
				>
				<button type="button" on:click={signOut}>{$_('nav.sign_out')}</button>
			{:else}
				<a href="/signup" class="btn" aria-current={isCurrent('/signup')}>{$_('nav.sign_in_up')}</a>
			{/if}
		</div>

		<!-- Hamburger toggle, only visible on narrow viewports. -->
		<button
			type="button"
			class="hamburger mobile-only"
			aria-label={$_('a11y.open_menu')}
			aria-expanded={drawerOpen}
			aria-controls="mobile-drawer"
			bind:this={hamburgerBtn}
			on:click={openDrawer}
		>
			<span aria-hidden="true">
				<svg viewBox="0 0 24 24" width="24" height="24" focusable="false">
					<path
						d="M3 6h18M3 12h18M3 18h18"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
					/>
				</svg>
			</span>
		</button>
	</nav>
</header>

<!-- Drawer + scrim. Rendered in the markup at all times so SSR can serve it,
     but visually hidden until `drawerOpen` flips. -->
{#if drawerOpen}
	<div
		class="drawer-scrim"
		role="presentation"
		on:click={closeDrawer}
		on:keydown={(e) => e.key === 'Enter' && closeDrawer()}
	></div>
{/if}

<div
	id="mobile-drawer"
	class="drawer"
	class:open={drawerOpen}
	bind:this={drawerEl}
	role="dialog"
	aria-modal="true"
	aria-label={$_('a11y.main_navigation')}
	aria-hidden={!drawerOpen}
>
	<div class="drawer-header">
		<span class="drawer-title">{$_('nav.menu')}</span>
		<button
			type="button"
			class="drawer-close"
			aria-label={$_('a11y.close_menu')}
			on:click={closeDrawer}
		>
			<span aria-hidden="true">&times;</span>
		</button>
	</div>
	<nav class="drawer-nav" aria-label={$_('a11y.nav_mobile')}>
		{#if signedIn}
			<a href="/admin" aria-current={isCurrent('/admin')}>{$_('nav.dashboard')}</a>
			<a href="/settings" aria-current={isCurrent('/settings')}>{data.user?.username}</a>
			<button type="button" on:click={signOut}>{$_('nav.sign_out')}</button>
		{:else}
			<a href="/signup" class="btn" aria-current={isCurrent('/signup')}>{$_('nav.sign_in_up')}</a>
		{/if}
	</nav>
</div>

<main id="main-content" tabindex="-1">
	<slot></slot>
</main>

<!-- Footer with locale switcher + status link. Always rendered (the status
     link is universally useful); the locale picker is only shown when more
     than one locale is shipped to avoid noise from a single-option select. -->
<footer class="site-footer">
	<a href="/status" class="footer-link">Status</a>
	{#if SUPPORTED_LOCALES.length > 1}
		<label class="locale-picker">
			<span>{$_('footer.language')}:</span>
			<select value={$locale ?? 'en'} on:change={onLocaleChange}>
				{#each SUPPORTED_LOCALES as code}
					<option value={code}>{$_(`locales.${code}`)}</option>
				{/each}
			</select>
		</label>
	{/if}
</footer>

<style global>
	/* Layout-scoped global styles. The design tokens (colors, typography scale,
	   focus ring) live in src/lib/styles/tokens.css and the element/a11y base in
	   src/lib/styles/base.css, both imported at the top of this component. Keep
	   this block focused on the navigation, drawer, and a few global element
	   styles that need to reference layout-specific selectors. */

	:global(a, a:visited) {
		color: var(--color-link);
		text-decoration: none;
		text-shadow: none;
	}

	:global(a:hover) {
		color: var(--color-link-hover);
		text-decoration: underline;
	}

	:global(h1, h2, h3, h4, h5, h6) {
		font-family: var(--heading-font);
		color: var(--color-text);
		line-height: 1.2;
		margin: 0.6em 0 0.4em;
	}
	:global(h1) {
		font-size: var(--text-3xl);
	}
	:global(h2) {
		font-size: var(--text-2xl);
	}
	:global(h3) {
		font-size: var(--text-xl);
	}
	:global(h4) {
		font-size: var(--text-lg);
	}
	:global(h5),
	:global(h6) {
		font-size: var(--text-base);
	}

	:global(nav > a, button) {
		font-family: var(--heading-font);
		text-decoration: none !important;
	}

	main {
		margin: 1rem;
		display: flex;
		flex-direction: column;
		min-height: 60vh;
	}
	main:focus {
		outline: none;
	}

	.nav-title {
		font-size: var(--text-lg);
		font-weight: 600;
		margin-right: 1.5rem;
	}

	nav {
		background-color: var(--nav-bg);
		color: var(--nav-fg);
		padding: 0.5rem 1rem;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	nav a {
		color: var(--nav-fg);
		margin-right: 1rem;
		text-shadow: none;
		padding: 0.6rem 0.4rem;
		display: inline-flex;
		align-items: center;
		min-height: var(--touch-target);
	}
	nav a:hover {
		color: var(--nav-fg);
		text-decoration: underline;
	}
	nav a[aria-current='page'] {
		text-decoration: underline;
		text-underline-offset: 4px;
		font-weight: 700;
	}

	nav .brand,
	nav .nav-right {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		flex-wrap: wrap;
	}

	/* Legacy global button styling for not-yet-redesigned pages. NOT !important
	   so the new src/lib/components/ui/Button (and other scoped components) win
	   on specificity. Removed entirely when the layout is redesigned (Plan 3). */
	:global(button, .btn) {
		background-color: var(--color-green);
		color: var(--color-green-white);
		border: 1px solid var(--color-green-light);
		border-radius: 0.3rem;
		padding: 0.55rem 0.9rem;
		cursor: pointer;
		font-weight: 500;
		font-size: var(--text-base);
		min-height: var(--touch-target);
		line-height: 1.2;
	}

	:global(button:hover, .btn:hover) {
		background-color: var(--color-green-light);
		color: var(--color-green);
	}

	:global(button:disabled, .btn:disabled) {
		opacity: 0.6;
		cursor: not-allowed;
	}

	/* Hamburger button styles — only rendered on narrow viewports via the
	   mobile-only class. Uses inherited nav fg color for the icon. */
	.hamburger {
		background: transparent !important;
		color: var(--nav-fg) !important;
		border: 1px solid transparent !important;
		padding: 0.5rem !important;
		min-width: var(--touch-target);
		min-height: var(--touch-target);
		display: inline-flex;
		align-items: center;
		justify-content: center;
	}
	.hamburger:hover {
		background: hsla(0, 0%, 100%, 0.08) !important;
		color: var(--nav-fg) !important;
	}

	/* Drawer — slides in from the right. role=dialog with aria-modal. */
	.drawer {
		position: fixed;
		top: 0;
		right: 0;
		bottom: 0;
		width: min(86vw, 360px);
		background: var(--color-surface);
		color: var(--color-text);
		box-shadow: var(--shadow-elev-2);
		transform: translateX(100%);
		transition: transform 180ms ease-out;
		z-index: 100;
		display: flex;
		flex-direction: column;
		padding: 0.75rem;
		visibility: hidden;
	}
	.drawer.open {
		transform: translateX(0);
		visibility: visible;
	}
	.drawer-scrim {
		position: fixed;
		inset: 0;
		background: hsla(0, 0%, 0%, 0.45);
		z-index: 99;
	}
	.drawer-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.25rem 0.5rem 0.75rem;
		border-bottom: 1px solid var(--color-border);
		margin-bottom: 0.75rem;
	}
	.drawer-title {
		font-family: var(--heading-font);
		font-weight: 600;
		font-size: var(--text-lg);
	}
	.drawer-close {
		background: transparent !important;
		color: var(--color-text) !important;
		border: 1px solid transparent !important;
		font-size: var(--text-2xl) !important;
		line-height: 1 !important;
		padding: 0.25rem 0.75rem !important;
		min-width: var(--touch-target);
		min-height: var(--touch-target);
	}
	.drawer-nav {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.drawer-nav :global(a),
	.drawer-nav :global(button) {
		display: flex;
		align-items: center;
		min-height: var(--touch-target);
		padding: 0.75rem 0.6rem;
		color: var(--color-text);
		font-size: var(--text-base);
		text-decoration: none;
		border-radius: 0.4rem;
	}
	.drawer-nav :global(a:hover),
	.drawer-nav :global(button:hover) {
		background: var(--color-surface-alt);
		text-decoration: none;
	}
	.drawer-nav :global(a[aria-current='page']) {
		font-weight: 700;
		background: var(--color-surface-alt);
	}

	/* Visibility helpers. Default to desktop layout; flip at 768px so the
	   hamburger only shows on phones / narrow tablets. */
	.mobile-only {
		display: none;
	}
	.desktop-only {
		display: flex;
	}

	@media (max-width: 767px) {
		.mobile-only {
			display: inline-flex;
		}
		.desktop-only {
			display: none;
		}
		nav {
			padding: 0.5rem 0.75rem;
		}
		.nav-title {
			margin-right: 0.75rem;
		}
		nav a {
			margin-right: 0.5rem;
		}
		main {
			margin: 0.75rem;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.drawer {
			transition: none;
		}
		.skip-link {
			transition: none;
		}
	}

	/* Site footer — currently only hosts the locale picker. Plain & quiet so
	   it doesn't compete with content above. */
	.site-footer {
		padding: 1rem;
		border-top: 1px solid var(--color-border);
		display: flex;
		justify-content: flex-end;
		align-items: center;
		gap: 1rem;
		font-size: var(--text-sm, 0.85rem);
	}
	.footer-link {
		color: var(--color-link);
		text-decoration: none;
	}
	.footer-link:hover {
		text-decoration: underline;
	}
	.locale-picker {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
	}
	.locale-picker select {
		padding: 0.25rem 0.5rem;
		font-family: inherit;
		font-size: inherit;
		background: var(--color-surface, transparent);
		color: var(--color-text);
		border: 1px solid var(--color-border);
		border-radius: 0.25rem;
	}
</style>
