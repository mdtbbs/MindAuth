import { translate, type Locale } from '@/i18n/catalogs';

export function forumAccessEnabled(scopes: readonly string[]) {
  return scopes.some(scope => scope === 'forum' || /^(forum|resource|notification|message|friends|presence|multiplayer|game_content\.saves)\./.test(scope));
}

export function ForumAccessOption({ scopes, onChange, locale, disabled = false }: {
  scopes: string[]; onChange: (scopes: string[]) => void; locale: Locale; disabled?: boolean;
}) {
  return <label className="field">
    <span className="cluster"><input type="checkbox" checked={forumAccessEnabled(scopes)} disabled={disabled}
      onChange={event => onChange(['openid', 'profile', ...(event.target.checked ? ['forum'] : [])])} />
      <strong>{translate(locale, 'access.label')}</strong></span>
    <span className="field__hint">{translate(locale, 'access.help')}</span>
  </label>;
}

export function AccessSummary({ scopes, locale }: { scopes: readonly string[]; locale: Locale }) {
  return <p>{translate(locale, forumAccessEnabled(scopes) ? 'access.consentForum' : 'access.consentBasic')}
    {scopes.includes('email') ? ` ${translate(locale, 'access.consentEmail')}` : ''}</p>;
}
