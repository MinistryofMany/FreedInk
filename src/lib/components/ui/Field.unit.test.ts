// @vitest-environment jsdom

import { describe, it, expect, afterEach } from 'vitest';
import { mount } from 'svelte';
import Field from './Field.svelte';

afterEach(() => {
	while (document.body.firstChild) {
		document.body.removeChild(document.body.firstChild);
	}
});

describe('Field', () => {
	it('renders a label bound to the input via for/id', () => {
		const target = document.createElement('div');
		document.body.appendChild(target);
		mount(Field, { target, props: { label: 'Username', id: 'username' } });
		const label = target.querySelector('label') as HTMLLabelElement;
		const input = target.querySelector('input') as HTMLInputElement;
		expect(label).not.toBeNull();
		expect(input).not.toBeNull();
		expect(label.htmlFor).toBe('username');
		expect(input.id).toBe('username');
	});

	it('generates a stable id when none is provided', () => {
		const target = document.createElement('div');
		document.body.appendChild(target);
		mount(Field, { target, props: { label: 'Email' } });
		const label = target.querySelector('label') as HTMLLabelElement;
		const input = target.querySelector('input') as HTMLInputElement;
		expect(label.htmlFor).toBeTruthy();
		expect(label.htmlFor).toBe(input.id);
	});

	it('shows error text and sets aria-invalid when error is given', () => {
		const target = document.createElement('div');
		document.body.appendChild(target);
		mount(Field, { target, props: { label: 'Password', id: 'pwd', error: 'Too short' } });
		const input = target.querySelector('input') as HTMLInputElement;
		const errorEl = target.querySelector('.error');
		expect(errorEl).not.toBeNull();
		expect(errorEl!.textContent).toBe('Too short');
		expect(input.getAttribute('aria-invalid')).toBe('true');
	});

	it('does not set aria-invalid when there is no error', () => {
		const target = document.createElement('div');
		document.body.appendChild(target);
		mount(Field, { target, props: { label: 'Name', id: 'name' } });
		const input = target.querySelector('input') as HTMLInputElement;
		expect(input.getAttribute('aria-invalid')).toBeNull();
	});

	it('renders a <textarea> when multiline=true', () => {
		const target = document.createElement('div');
		document.body.appendChild(target);
		mount(Field, { target, props: { label: 'Bio', id: 'bio', multiline: true } });
		expect(target.querySelector('textarea')).not.toBeNull();
		expect(target.querySelector('input')).toBeNull();
	});

	it('shows help text when help is given', () => {
		const target = document.createElement('div');
		document.body.appendChild(target);
		mount(Field, {
			target,
			props: { label: 'Handle', id: 'handle', help: 'Letters and numbers only' }
		});
		const helpEl = target.querySelector('.help');
		expect(helpEl).not.toBeNull();
		expect(helpEl!.textContent).toBe('Letters and numbers only');
	});

	it('points aria-describedby at error and help when both present', () => {
		const target = document.createElement('div');
		document.body.appendChild(target);
		mount(Field, {
			target,
			props: { label: 'Field', id: 'f1', error: 'Bad', help: 'Hint' }
		});
		const input = target.querySelector('input') as HTMLInputElement;
		const describedBy = input.getAttribute('aria-describedby') ?? '';
		expect(describedBy).toContain('f1-help');
		expect(describedBy).toContain('f1-error');
	});
});
