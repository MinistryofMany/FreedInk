// @vitest-environment jsdom

import { describe, it, expect, afterEach, vi } from 'vitest';
import { mount } from 'svelte';
import Pagination from './Pagination.svelte';

afterEach(() => {
	while (document.body.firstChild) {
		document.body.removeChild(document.body.firstChild);
	}
});

describe('Pagination', () => {
	it('renders the "Page X of Y" label', () => {
		const target = document.createElement('div');
		document.body.appendChild(target);
		mount(Pagination, { target, props: { page: 3, pageCount: 10 } });
		expect(target.textContent).toContain('Page 3 of 10');
	});

	it('Prev is disabled at page 1', () => {
		const target = document.createElement('div');
		document.body.appendChild(target);
		mount(Pagination, { target, props: { page: 1, pageCount: 5 } });
		const btns = target.querySelectorAll('button') as NodeListOf<HTMLButtonElement>;
		const prev = btns[0];
		expect(prev.disabled).toBe(true);
	});

	it('Next is disabled at last page', () => {
		const target = document.createElement('div');
		document.body.appendChild(target);
		mount(Pagination, { target, props: { page: 5, pageCount: 5 } });
		const btns = target.querySelectorAll('button') as NodeListOf<HTMLButtonElement>;
		const next = btns[1];
		expect(next.disabled).toBe(true);
	});

	it('clicking Next calls onchange(page+1)', async () => {
		const target = document.createElement('div');
		document.body.appendChild(target);
		const onchange = vi.fn();
		mount(Pagination, { target, props: { page: 3, pageCount: 10, onchange } });
		const btns = target.querySelectorAll('button') as NodeListOf<HTMLButtonElement>;
		const next = btns[1];
		next.click();
		await new Promise((r) => setTimeout(r, 0));
		expect(onchange).toHaveBeenCalledWith(4);
	});

	it('clicking Prev calls onchange(page-1)', async () => {
		const target = document.createElement('div');
		document.body.appendChild(target);
		const onchange = vi.fn();
		mount(Pagination, { target, props: { page: 3, pageCount: 10, onchange } });
		const btns = target.querySelectorAll('button') as NodeListOf<HTMLButtonElement>;
		const prev = btns[0];
		prev.click();
		await new Promise((r) => setTimeout(r, 0));
		expect(onchange).toHaveBeenCalledWith(2);
	});

	it('uses <a> elements when makeHref is provided', () => {
		const target = document.createElement('div');
		document.body.appendChild(target);
		mount(Pagination, {
			target,
			props: { page: 3, pageCount: 10, makeHref: (p) => `/posts?page=${p}` }
		});
		const links = target.querySelectorAll('a.page-ctrl');
		expect(links.length).toBe(2);
		expect(links[0].getAttribute('href')).toBe('/posts?page=2');
		expect(links[1].getAttribute('href')).toBe('/posts?page=4');
	});

	it('Next link is aria-disabled at last page with makeHref', () => {
		const target = document.createElement('div');
		document.body.appendChild(target);
		mount(Pagination, {
			target,
			props: { page: 5, pageCount: 5, makeHref: (p) => `/posts?page=${p}` }
		});
		const links = target.querySelectorAll('a.page-ctrl') as NodeListOf<HTMLAnchorElement>;
		const next = links[1];
		expect(next.getAttribute('aria-disabled')).toBe('true');
		expect(next.getAttribute('tabindex')).toBe('-1');
	});

	it('has aria-label="Pagination" on nav', () => {
		const target = document.createElement('div');
		document.body.appendChild(target);
		mount(Pagination, { target, props: { page: 1, pageCount: 3 } });
		const nav = target.querySelector('nav');
		expect(nav!.getAttribute('aria-label')).toBe('Pagination');
	});
});
