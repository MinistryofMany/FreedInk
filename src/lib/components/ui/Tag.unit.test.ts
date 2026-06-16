// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { mount, createRawSnippet } from 'svelte';
import Tag from './Tag.svelte';

const text = createRawSnippet(() => ({ render: () => '<span>label</span>' }));

function mountTag(props: Record<string, unknown> = {}) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	mount(Tag, { target, props: { children: text, ...props } });
	return target;
}

afterEach(() => {
	while (document.body.firstChild) document.body.removeChild(document.body.firstChild);
});

describe('Tag', () => {
	it('mounts without throwing and defaults to outline variant', () => {
		const target = mountTag();
		const el = target.querySelector('span.tag');
		expect(el).not.toBeNull();
		expect(el!.classList.contains('outline')).toBe(true);
	});

	it('applies solid class when variant is solid', () => {
		const target = mountTag({ variant: 'solid' });
		const el = target.querySelector('span.tag');
		expect(el!.classList.contains('solid')).toBe(true);
		expect(el!.classList.contains('outline')).toBe(false);
	});

	it('applies muted class when variant is muted', () => {
		const target = mountTag({ variant: 'muted' });
		const el = target.querySelector('span.tag');
		expect(el!.classList.contains('muted')).toBe(true);
		expect(el!.classList.contains('outline')).toBe(false);
	});

	it('forwards extra class prop', () => {
		const target = mountTag({ class: 'my-extra' });
		const el = target.querySelector('span.tag');
		expect(el!.classList.contains('my-extra')).toBe(true);
	});
});
