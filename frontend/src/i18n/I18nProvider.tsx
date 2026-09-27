import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import api from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { normalizeLocale, SUPPORTED_LOCALES, translate, type Locale } from './catalogs';

interface I18nContextValue {
  locale: Locale;
  setLocale: (value: Locale) => void;
  t: (key: string, values?: Record<string, string>) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);
const COOKIE_NAME = 'mindauth_locale';

function readCookie(name: string) {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

function writeCookie(locale: Locale) {
  const secure = window.location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${COOKIE_NAME}=${encodeURIComponent(locale)}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
}

function localeFromAcceptLanguage(value: string) {
  for (const candidate of value.split(',')) {
    const locale = normalizeLocale(candidate.split(';')[0]);
    if (locale) return locale;
  }
  return null;
}

function initialLocale() {
  const query = new URLSearchParams(window.location.search);
  const uiLocale = query.get('ui_locales')?.split(/[\s,]+/).map(normalizeLocale).find(Boolean);
  if (uiLocale) return uiLocale;
  const explicit = normalizeLocale(query.get('lang'));
  if (explicit) return explicit;
  const cookie = normalizeLocale(readCookie(COOKIE_NAME));
  if (cookie) return cookie;
  const accepted = localeFromAcceptLanguage(navigator.languages?.join(',') || navigator.language);
  return accepted || (query.get('ecosystem') === 'mdtbbs' ? 'zh-CN' : 'en');
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const [locale, setLocaleState] = useState<Locale>(initialLocale);
  const query = new URLSearchParams(window.location.search);
  const hasExplicitLocale = Boolean(query.get('ui_locales') || normalizeLocale(query.get('lang')));

  useEffect(() => {
    if (loading || hasExplicitLocale) return;
    const preferred = normalizeLocale(user?.preferred_locale);
    const saved = preferred || normalizeLocale(readCookie(COOKIE_NAME));
    if (saved) setLocaleState(saved);
  }, [loading, user?.preferred_locale, hasExplicitLocale]);

  const setLocale = useCallback((value: Locale) => {
    if (!SUPPORTED_LOCALES.includes(value)) return;
    setLocaleState(value);
    writeCookie(value);
    if (user) void api.put('/api/account/preferences', { preferred_locale: value }).catch(() => {});
  }, [user]);

  const value = useMemo(() => ({ locale, setLocale, t: (key: string, variables?: Record<string, string>) => translate(locale, key, variables) }), [locale, setLocale]);
  useEffect(() => { document.documentElement.lang = locale; }, [locale]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const value = useContext(I18nContext);
  if (!value) throw new Error('useI18n must be used inside I18nProvider');
  return value;
}

export function LocaleSwitcher() {
  const { locale, setLocale, t } = useI18n();
  return <label className="mindauth-locale-switcher"><span>{t('language.label')}</span><select aria-label={t('language.label')} value={locale} onChange={event => setLocale(event.target.value as Locale)}>
    {SUPPORTED_LOCALES.map(item => <option key={item} value={item}>{t(`language.${item}`)}</option>)}
  </select></label>;
}
