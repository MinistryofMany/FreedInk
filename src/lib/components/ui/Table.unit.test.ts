// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { mount, createRawSnippet } from 'svelte';
import Table from './Table.svelte';

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

function mountTable(props: Record<string, unknown> = {}) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	mount(Table, {
		target,
		props: {
			columns,
			rows,
			cell: makeCellSnippet(),
			...props
		}
	});
	return target;
}

afterEach(() => {
	while (document.body.firstChild) document.body.removeChild(document.body.firstChild);
});

describe('Table', () => {
	it('renders a <th> per column in the desktop table', () => {
		const target = mountTable();
		const ths = target.querySelectorAll('table.t-desktop thead th');
		expect(ths.length).toBe(columns.length);
		expect(ths[0].textContent).toBe('Name');
		expect(ths[1].textContent).toBe('Role');
	});

	it('renders a <tr> per row in the desktop tbody', () => {
		const target = mountTable();
		const trs = target.querySelectorAll('table.t-desktop tbody tr');
		expect(trs.length).toBe(rows.length);
	});

	it('cell snippet is invoked and its output appears in the table', () => {
		const target = mountTable();
		const cells = target.querySelectorAll('table.t-desktop tbody .cell-value');
		const texts = Array.from(cells).map((el) => el.textContent);
		expect(texts).toContain('Alice');
		expect(texts).toContain('Bob');
		expect(texts).toContain('Admin');
		expect(texts).toContain('Member');
	});

	it('cell snippet output appears in the mobile card list', () => {
		const target = mountTable();
		const dds = target.querySelectorAll('ul.t-mobile dd .cell-value');
		const texts = Array.from(dds).map((el) => el.textContent);
		expect(texts).toContain('Alice');
		expect(texts).toContain('Bob');
	});

	it('renders one .t-card per row in mobile list', () => {
		const target = mountTable();
		const cards = target.querySelectorAll('ul.t-mobile li.t-card');
		expect(cards.length).toBe(rows.length);
	});

	it('shows the default "No items." fallback when rows is empty', () => {
		const target = mountTable({ rows: [] });
		const p = target.querySelector('p.t-empty');
		expect(p).not.toBeNull();
		expect(p!.textContent).toBe('No items.');
	});

	it('shows the custom empty snippet when rows is empty and empty prop is provided', () => {
		const emptySnippet = createRawSnippet(() => ({
			render: () => '<span class="custom-empty">Nothing here</span>'
		}));
		const target = mountTable({ rows: [], empty: emptySnippet });
		const custom = target.querySelector('.custom-empty');
		expect(custom).not.toBeNull();
		expect(custom!.textContent).toBe('Nothing here');
		// default fallback should not appear
		expect(target.querySelector('p.t-empty')).toBeNull();
	});

	it('does not render table or list when rows is empty', () => {
		const target = mountTable({ rows: [] });
		expect(target.querySelector('table')).toBeNull();
		expect(target.querySelector('ul.t-mobile')).toBeNull();
	});

	it('applies the class prop to the root wrapper', () => {
		const target = mountTable({ class: 'extra-class' });
		const wrapper = target.querySelector('.fi-table');
		expect(wrapper!.classList.contains('extra-class')).toBe(true);
	});

	it('renders column labels as dt elements in mobile cards', () => {
		const target = mountTable();
		const dts = target.querySelectorAll('ul.t-mobile dt');
		const labels = Array.from(dts).map((el) => el.textContent);
		expect(labels).toContain('Name');
		expect(labels).toContain('Role');
	});

	it('applies right-align class to th and td when align is right', () => {
		const target = mountTable();
		const ths = target.querySelectorAll('table.t-desktop thead th');
		// second column has align: right
		expect(ths[1].classList.contains('right')).toBe(true);
		const firstRowTds = target.querySelectorAll('table.t-desktop tbody tr:first-child td');
		expect(firstRowTds[1].classList.contains('right')).toBe(true);
	});
});
