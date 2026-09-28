const SUPPORTED_LOCALES = Object.freeze(['zh-CN', 'en', 'ru', 'ja']);

function normalizeLocale(value) {
  const input = String(value || '').trim().toLowerCase();
  if (input === 'zh' || input.startsWith('zh-')) return 'zh-CN';
  if (input === 'en' || input.startsWith('en-')) return 'en';
  if (input === 'ru' || input.startsWith('ru-')) return 'ru';
  if (input === 'ja' || input.startsWith('ja-')) return 'ja';
  return null;
}

function normalizeUiLocales(value) {
  if (typeof value !== 'string') return '';
  return [...new Set(value.split(/[\s,]+/).map(normalizeLocale).filter(Boolean))].join(' ').slice(0, 64);
}

function resolveLocale({ uiLocales, explicitLocale, preferredLocale, cookieLocale, acceptLanguage, clientDefaultLocale }) {
  const candidates = [uiLocales, explicitLocale, preferredLocale, cookieLocale];
  for (const candidate of candidates) {
    const locale = normalizeLocale(String(candidate || '').split(/[\s,]+/)[0]);
    if (locale) return locale;
  }
  for (const candidate of String(acceptLanguage || '').split(',')) {
    const locale = normalizeLocale(candidate.split(';')[0]);
    if (locale) return locale;
  }
  return normalizeLocale(clientDefaultLocale) || 'en';
}

function appendUiLocales(params, value) {
  const normalized = normalizeUiLocales(value);
  if (normalized) params.set('ui_locales', normalized);
  return params;
}

module.exports = { SUPPORTED_LOCALES, normalizeLocale, normalizeUiLocales, resolveLocale, appendUiLocales };
