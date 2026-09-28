import { useEffect, useState } from 'react';
import api from '@/api/client';
import { useI18n } from '@/i18n/I18nProvider';

interface SocialProvidersResponse {
  success: boolean;
  providers: string[];
}

interface SocialProviderButtonsProps {
  intent?: 'login' | 'bind';
  authorizeQuery?: string;
  excludeProviders?: string[];
}

const PROVIDERS = ['qq', 'github', 'discord'] as const;

export function SocialProviderButtons({ intent = 'login', authorizeQuery = '', excludeProviders = [] }: SocialProviderButtonsProps) {
  const { t } = useI18n();
  const [enabled, setEnabled] = useState<string[]>([]);

  useEffect(() => {
    let active = true;
    api.get<SocialProvidersResponse>('/api/auth/social/providers')
      .then((response) => {
        if (active && response.success) setEnabled(response.providers.filter((provider) => PROVIDERS.includes(provider as typeof PROVIDERS[number])));
      })
      .catch(() => { if (active) setEnabled([]); });
    return () => { active = false; };
  }, []);

  const visibleProviders = enabled.filter((provider) => !excludeProviders.includes(provider));
  if (visibleProviders.length === 0) return null;

  return (
    <div className="stack" aria-label={t('social.providers')} data-testid="social-provider-buttons">
      {visibleProviders.map((provider) => {
        const params = new URLSearchParams(intent === 'bind' ? { intent: 'bind' } : authorizeQuery);
        const query = params.toString();
        const href = provider === 'qq'
          ? `/api/auth/qq${query ? `?${query}` : ''}`
          : `/api/auth/social/${provider}${query ? `?${query}` : ''}`;
        return (
          <a className="btn btn--secondary btn--lg btn--full" href={href} key={provider}>
            {t(intent === 'bind' ? 'social.link' : 'social.continueWith', { provider: t(`social.${provider}`) })}
          </a>
        );
      })}
    </div>
  );
}
