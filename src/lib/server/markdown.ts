// Markdown → sanitized HTML for trusted static content (legal pages).
// Defence in depth: the source is in our repo, but we still run output
// through isomorphic-dompurify so a missed escape in a code block or future
// template-injection regression can't ship as raw HTML.
import { marked } from 'marked';
import DOMPurify from 'isomorphic-dompurify';

marked.setOptions({
	gfm: true,
	breaks: false
});

export function renderMarkdown(src: string): string {
	const html = marked.parse(src, { async: false }) as string;
	return DOMPurify.sanitize(html, {
		USE_PROFILES: { html: true }
	});
}
