import { normalizeLocale, translate } from './catalogs';

export function currentText(key: string, values?: Record<string, string | number>) {
  const locale = typeof document === 'undefined' ? 'zh-CN' : normalizeLocale(document.documentElement.lang) || 'zh-CN';
  return translate(locale, key, values);
}
