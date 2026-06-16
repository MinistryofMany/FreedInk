// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { mount } from 'svelte';
import PostCard from './PostCard.svelte';

afterEach(() => {
	while (document.body.firstChild) {
		document.body.removeChild(document.body.firstChild);
	}
});

interface PostCardProps {
	blogSlug: string;
	slug: string;
	title: string;
	excerpt?: string;
	publishedAt?: string | Date;
	blogTitle?: string;
}

function mountPostCard(props: PostCardProps) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	mount(PostCard, { target, props });
	return target;
}

describe('PostCard', () => {
	it('renders the title text', () => {
		const target = mountPostCard({ blogSlug: 'my-blog', slug: 'first-post', title: 'First Post' });
		expect(target.textContent).toContain('First Post');
	});

	it('title link href is /b/{blogSlug}/{slug}', () => {
		const target = mountPostCard({ blogSlug: 'my-blog', slug: 'first-post', title: 'First Post' });
		const link = target.querySelector('a.post-title');
		expect(link).not.toBeNull();
		expect(link!.getAttribute('href')).toBe('/b/my-blog/first-post');
	});

	it('renders as an article element', () => {
		const target = mountPostCard({ blogSlug: 'my-blog', slug: 'first-post', title: 'First Post' });
		const article = target.querySelector('article.post-card');
		expect(article).not.toBeNull();
	});

	it('renders excerpt when provided', () => {
		const target = mountPostCard({
			blogSlug: 'my-blog',
			slug: 'first-post',
			title: 'First Post',
			excerpt: 'This is a teaser of the post content.'
		});
		expect(target.textContent).toContain('This is a teaser of the post content.');
	});

	it('omits excerpt element when not provided', () => {
		const target = mountPostCard({ blogSlug: 'my-blog', slug: 'first-post', title: 'First Post' });
		const excerpt = target.querySelector('.excerpt');
		expect(excerpt).toBeNull();
	});

	it('renders blogTitle in meta when provided', () => {
		const target = mountPostCard({
			blogSlug: 'my-blog',
			slug: 'first-post',
			title: 'First Post',
			blogTitle: 'My Blog'
		});
		expect(target.textContent).toContain('My Blog');
	});

	it('renders formatted date when publishedAt is a string', () => {
		const target = mountPostCard({
			blogSlug: 'my-blog',
			slug: 'first-post',
			title: 'First Post',
			publishedAt: '2025-03-15'
		});
		const meta = target.querySelector('.meta');
		expect(meta).not.toBeNull();
		// toLocaleDateString output varies by locale; just check it rendered something
		expect(meta!.textContent!.trim().length).toBeGreaterThan(0);
	});

	it('renders formatted date when publishedAt is a Date object', () => {
		const target = mountPostCard({
			blogSlug: 'my-blog',
			slug: 'first-post',
			title: 'First Post',
			publishedAt: new Date('2025-03-15')
		});
		const meta = target.querySelector('.meta');
		expect(meta).not.toBeNull();
		expect(meta!.textContent!.trim().length).toBeGreaterThan(0);
	});

	it('omits meta section when neither blogTitle nor publishedAt are provided', () => {
		const target = mountPostCard({ blogSlug: 'my-blog', slug: 'first-post', title: 'First Post' });
		const meta = target.querySelector('.meta');
		expect(meta).toBeNull();
	});

	it('skips date rendering when publishedAt is invalid', () => {
		const target = mountPostCard({
			blogSlug: 'my-blog',
			slug: 'first-post',
			title: 'First Post',
			publishedAt: 'not-a-date'
		});
		const time = target.querySelector('time');
		expect(time).toBeNull();
	});
});
