// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { mount, flushSync, createRawSnippet } from 'svelte';
import Table from './Table.svelte';

// The component reads `browser` to decide whether to attach the media query.
vi.mock('$app/environment', () => ({ browser: true }));

const columns = [
	{ key: 'name', label: 'Name' },
	{ key: 'role', label: 'Role', align: 'right' as const }
];

const rows = [
	{ name: 'Alice', role: 'Admin' },
	{ name: 'Bob', role: 'Member' }
];

type RowData = Record<string, string>;

const makeCellSnippet = () =>
	createRawSnippet<[RowData, { key: string; label: string }]>((getRow, getCol) => ({
		render: () => {
			const row = getRow();
			const col = getCol();
			return `<span class="cell-value">${row[col.key]}</span>`;
		}
	}));

/** Stub window.matchMedia so the component's viewport effect is deterministic. */
function setViewport(mobile: boolean) {
	window.matchMedia = ((query: string) => ({
		matches: mobile,
		media: query,
		addEventListener: () => {},
		removeEventListener: () => {},
		addListener: () => {},
		removeListener: () => {},
		dispatchEvent: () => false,
		onchange: null
	})) as unknown as typeof window.matchMedia;
}

function mountTable(props: Record<string, unknown> = {}) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	mount(Table, {
		target,
		props: { columns, rows, cell: makeCellSnippet(), ...props }
	});
	flushSync(); // run the viewport $effect so isMobile settles
	return target;
}

beforeEach(() => setViewport(false));
afterEach(() => {
	while (document.body.firstChild) document.body.removeChild(document.body.firstChild);
});

describe('Table (desktop viewport)', () => {
	it('renders a <th> per column', () => {
		const target = mountTable();
		const ths = target.querySelectorAll('table.t-desktop thead th');
		expect(ths.length).toBe(columns.length);
		expect(ths[0].textContent).toBe('Name');
		expect(ths[1].textContent).toBe('Role');
	});

	it('renders a <tr> per row', () => {
		const target = mountTable();
		expect(target.querySelectorAll('table.t-desktop tbody tr').length).toBe(rows.length);
	});

	it('invokes the cell snippet and shows its output', () => {
		const target = mountTable();
		const texts = Array.from(target.querySelectorAll('table.t-desktop .cell-value')).map(
			(el) => el.textContent
		);
		expect(texts).toEqual(expect.arrayContaining(['Alice', 'Bob', 'Admin', 'Member']));
	});

	it('applies right-align class to th and td when align is right', () => {
		const target = mountTable();
		const ths = target.querySelectorAll('table.t-desktop thead th');
		expect(ths[1].classList.contains('right')).toBe(true);
		const firstRowTds = target.querySelectorAll('table.t-desktop tbody tr:first-child td');
		expect(firstRowTds[1].classList.contains('right')).toBe(true);
	});

	it('does NOT also render the mobile card list (single DOM copy)', () => {
		const target = mountTable();
		expect(target.querySelector('ul.t-mobile')).toBeNull();
	});
});

describe('Table (mobile viewport)', () => {
	beforeEach(() => setViewport(true));

	it('renders one .t-card per row with the cell output and dt labels', () => {
		const target = mountTable();
		expect(target.querySelectorAll('ul.t-mobile li.t-card').length).toBe(rows.length);
		const dds = Array.from(target.querySelectorAll('ul.t-mobile dd .cell-value')).map(
			(el) => el.textContent
		);
		expect(dds).toEqual(expect.arrayContaining(['Alice', 'Bob']));
		const dts = Array.from(target.querySelectorAll('ul.t-mobile dt')).map((el) => el.textContent);
		expect(dts).toEqual(expect.arrayContaining(['Name', 'Role']));
	});

	it('does NOT also render the desktop table (single DOM copy)', () => {
		const target = mountTable();
		expect(target.querySelector('table.t-desktop')).toBeNull();
	});
});

describe('Table (empty + props)', () => {
	it('shows the default "No items." fallback when rows is empty', () => {
		const target = mountTable({ rows: [] });
		const p = target.querySelector('p.t-empty');
		expect(p).not.toBeNull();
		expect(p!.textContent).toBe('No items.');
	});

	it('shows a custom empty snippet when provided', () => {
		const emptySnippet = createRawSnippet(() => ({
			render: () => '<span class="custom-empty">Nothing here</span>'
		}));
		const target = mountTable({ rows: [], empty: emptySnippet });
		expect(target.querySelector('.custom-empty')!.textContent).toBe('Nothing here');
		expect(target.querySelector('p.t-empty')).toBeNull();
	});

	it('renders neither table nor list when empty', () => {
		const target = mountTable({ rows: [] });
		expect(target.querySelector('table')).toBeNull();
		expect(target.querySelector('ul.t-mobile')).toBeNull();
	});

	it('applies the class prop to the root wrapper', () => {
		const target = mountTable({ class: 'extra-class' });
		expect(target.querySelector('.fi-table')!.classList.contains('extra-class')).toBe(true);
	});
});
