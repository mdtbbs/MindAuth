import { useI18n } from '@/i18n/I18nProvider';

export function LegalFooter({ className = '', ecosystem = 'mdtbbs' }: { className?: string; ecosystem?: string }) {
  const { t } = useI18n();
  const baseUrl = ecosystem === 'mindustry-club' ? 'https://mindustry.club' : 'https://mdtbbs.cn';
  const links = [
    { href: `${baseUrl}/terms`, label: t('legal.terms') },
    { href: `${baseUrl}/privacy`, label: t('legal.privacy') },
    ...((ecosystem === 'mindustry-club') ? [] : [{ href: `${baseUrl}/about`, label: t('legal.about') }]),
  ];
  return (
    <footer className={`site-legal-footer ${className}`.trim()}>
      <nav className="site-legal-footer__links" aria-label={t('legal.aria')}>
        {links.map(({ href, label }) => (
          <a key={href} href={href} target="_blank" rel="noopener noreferrer">{label}</a>
        ))}
      </nav>
      <p className="site-legal-footer__copyright">© {new Date().getFullYear()} MDTBBS · MindAuth</p>
      {ecosystem === 'mindustry-club' ? null : <div className="site-legal-footer__filings">
        <a href="https://beian.miit.gov.cn/" target="_blank" rel="noopener noreferrer">
          鄂ICP备2024071060号-5
        </a>
        <a href="https://beian.mps.gov.cn/#/query/webSearch?code=65400302654113" target="_blank" rel="noopener noreferrer">
          新公网安备65400302654113号
        </a>
      </div>}
    </footer>
  );
}
