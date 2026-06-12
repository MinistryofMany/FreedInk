// Shared list of allowed post languages. Kept small and pragmatic — adding
// a language is a one-line change here plus optional i18n message keys.
// Each entry has a display name in its own language (the native form is what
// readers actually use to find their language in a picker).
export const POST_LANGUAGES: ReadonlyArray<{ code: string; name: string }> = [
	{ code: 'en', name: 'English' },
	{ code: 'es', name: 'Español' },
	{ code: 'fr', name: 'Français' },
	{ code: 'de', name: 'Deutsch' },
	{ code: 'it', name: 'Italiano' },
	{ code: 'pt', name: 'Português' },
	{ code: 'pt-br', name: 'Português (Brasil)' },
	{ code: 'nl', name: 'Nederlands' },
	{ code: 'sv', name: 'Svenska' },
	{ code: 'no', name: 'Norsk' },
	{ code: 'da', name: 'Dansk' },
	{ code: 'fi', name: 'Suomi' },
	{ code: 'pl', name: 'Polski' },
	{ code: 'cs', name: 'Čeština' },
	{ code: 'tr', name: 'Türkçe' },
	{ code: 'ru', name: 'Русский' },
	{ code: 'uk', name: 'Українська' },
	{ code: 'ar', name: 'العربية' },
	{ code: 'he', name: 'עברית' },
	{ code: 'fa', name: 'فارسی' },
	{ code: 'hi', name: 'हिन्दी' },
	{ code: 'bn', name: 'বাংলা' },
	{ code: 'ja', name: '日本語' },
	{ code: 'ko', name: '한국어' },
	{ code: 'zh', name: '中文' },
	{ code: 'zh-tw', name: '中文 (繁體)' },
	{ code: 'vi', name: 'Tiếng Việt' },
	{ code: 'th', name: 'ภาษาไทย' },
	{ code: 'id', name: 'Bahasa Indonesia' },
	{ code: 'ms', name: 'Bahasa Melayu' }
] as const;

const CODES = new Set(POST_LANGUAGES.map((l) => l.code));

export function isValidLanguageCode(code: string): boolean {
	return CODES.has(code.toLowerCase());
}

export function normalizeLanguageCode(code: string): string {
	const lower = code.toLowerCase();
	return CODES.has(lower) ? lower : 'en';
}

export function nameForLanguage(code: string): string {
	const entry = POST_LANGUAGES.find((l) => l.code === code.toLowerCase());
	return entry?.name ?? code;
}
