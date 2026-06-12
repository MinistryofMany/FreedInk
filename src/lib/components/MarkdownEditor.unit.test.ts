// @vitest-environment jsdom
//
// Unit tests for the MarkdownEditor component. We mount the real Tiptap
// editor under jsdom — it boots fine without a real browser as long as
// `document` exists.
//
// What we cover:
//   1. Component mounts and the toolbar renders.
//   2. Initial markdown roundtrips through Tiptap unchanged (or close
//      enough — the markdown serializer normalises whitespace).
//   3. `fetch('/api/media/upload')` is called when we drive an upload,
//      and the returned URL ends up in the serialized markdown as an
//      `![alt](url)` image node.
//
// Note: this test only exercises the public observable behavior; we don't
// reach into Tiptap internals. The drag-and-drop / paste paths are covered
// indirectly by sharing the same `uploadAndInsert` codepath as the toolbar
// button; an E2E test would be required to exercise the DOM events for real.

import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';

vi.mock('$app/environment', () => ({ browser: true, dev: true }));

import MarkdownEditor from './MarkdownEditor.svelte';

// Tiptap uses `requestAnimationFrame` and `cancelAnimationFrame` internally.
// jsdom supplies them, but ensure they exist for older Node test runners.
beforeAll(() => {
	if (typeof globalThis.requestAnimationFrame === 'undefined') {
		globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) =>
			setTimeout(() => cb(Date.now()), 0) as unknown as number) as typeof requestAnimationFrame;
		globalThis.cancelAnimationFrame = ((id: number) =>
			clearTimeout(id as unknown as NodeJS.Timeout)) as typeof cancelAnimationFrame;
	}
	// jsdom doesn't implement layout APIs that ProseMirror calls when it
	// tries to scroll the selection into view. Stub them so the editor's
	// `.focus().scrollIntoView()` chain doesn't throw an unhandled rejection
	// after our test assertions have already passed.
	if (!Element.prototype.getClientRects || Element.prototype.getClientRects.length === undefined) {
		Object.defineProperty(Element.prototype, 'getClientRects', {
			configurable: true,
			value: function () {
				return [];
			}
		});
	}
	if (!Range.prototype.getClientRects) {
		Object.defineProperty(Range.prototype, 'getClientRects', {
			configurable: true,
			value: function () {
				return [];
			}
		});
	}
	if (!Range.prototype.getBoundingClientRect) {
		Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
			configurable: true,
			value: function () {
				return { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 };
			}
		});
	}
});

function mountEditor(props: { value?: string } = {}) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const component = new MarkdownEditor({
		target,
		props: { value: '', ...props }
	});
	return { component, target };
}

// `init()` is async (it dynamic-imports Tiptap). Wait for the surface to
// receive Tiptap's ProseMirror class as a signal that Tiptap is up.
async function waitForReady(target: HTMLElement, timeoutMs = 10000) {
	const start = Date.now();
	while (Date.now() - start < timeoutMs) {
		if (target.querySelector('.ProseMirror')) return;
		const errEl = target.querySelector('.upload-error');
		if (errEl) throw new Error(`editor init failed: ${errEl.textContent}`);
		await new Promise((r) => setTimeout(r, 20));
	}
	throw new Error('editor never initialised');
}

afterEach(() => {
	// Clear DOM between tests by removing each child node (avoids touching
	// innerHTML which trips the security hook even on the empty string).
	while (document.body.firstChild) {
		document.body.removeChild(document.body.firstChild);
	}
	vi.restoreAllMocks();
});

describe('MarkdownEditor', () => {
	it('mounts and renders the toolbar', async () => {
		const { target } = mountEditor();
		await waitForReady(target);
		// Bold button + image button are reliable smoke tests for the toolbar.
		const toolbar = target.querySelector('.toolbar');
		expect(toolbar).not.toBeNull();
		expect(toolbar!.querySelector('button[title^="Bold"]')).not.toBeNull();
		expect(toolbar!.querySelector('button[title="Insert image"]')).not.toBeNull();
	});

	it('roundtrips initial markdown content', async () => {
		const { target } = mountEditor({ value: 'hello **world**' });
		await waitForReady(target);

		// Tiptap's markdown extension parses the initial value and the
		// ProseMirror DOM should reflect a bolded "world".
		const pm = target.querySelector('.ProseMirror') as HTMLElement;
		expect(pm.textContent).toContain('hello world');
		expect(pm.querySelector('strong')?.textContent).toBe('world');
	});

	it('uploads an image and inserts a markdown image node', async () => {
		// Mock the upload endpoint.
		const uploadUrl = '/uploads/ab/deadbeef.png';
		const fetchMock = vi.fn(
			async () =>
				new Response(JSON.stringify({ url: uploadUrl, id: 'media-1' }), {
					status: 200,
					headers: { 'content-type': 'application/json' }
				})
		);
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		const { component, target } = mountEditor({ value: 'before' });
		await waitForReady(target);

		const changes: string[] = [];
		component.$on('change', (e) => changes.push(e.detail));

		// Drive an upload via the hidden file input — the same codepath the
		// toolbar button and drag-drop both use.
		const fileInput = target.querySelector('input[type="file"]') as HTMLInputElement;
		expect(fileInput).not.toBeNull();

		const fakeBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]); // PNG signature-ish
		const file = new File([fakeBytes], 'cat.png', { type: 'image/png' });

		// jsdom doesn't let us assign `files` directly with a real FileList,
		// so we use Object.defineProperty.
		Object.defineProperty(fileInput, 'files', {
			value: [file],
			configurable: true
		});
		fileInput.dispatchEvent(new Event('change', { bubbles: true }));

		// Wait for the upload + insertion to complete.
		const deadline = Date.now() + 3000;
		while (Date.now() < deadline) {
			if (fetchMock.mock.calls.length > 0 && target.querySelector('.ProseMirror img')) break;
			await new Promise((r) => setTimeout(r, 25));
		}

		// fetch was called with multipart form data to the right endpoint.
		expect(fetchMock).toHaveBeenCalled();
		const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
		expect(call[0]).toBe('/api/media/upload');
		expect(call[1].method).toBe('POST');
		expect(call[1].body).toBeInstanceOf(FormData);

		// An <img> with the returned src appears in the editor DOM.
		const img = target.querySelector('.ProseMirror img') as HTMLImageElement | null;
		expect(img).not.toBeNull();
		expect(img!.getAttribute('src')).toBe(uploadUrl);

		// The serialized markdown contains the image as `![alt](url)`.
		await new Promise((r) => setTimeout(r, 30));
		const latest = changes[changes.length - 1] ?? '';
		expect(latest).toContain(`(${uploadUrl})`);
		expect(latest).toMatch(/!\[[^\]]*\]\(/);
	});
});
