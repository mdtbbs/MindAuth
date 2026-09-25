const FOOTER_LINKS = [
  { href: 'https://mdtbbs.cn/terms', label: '用户协议' },
  { href: 'https://mdtbbs.cn/privacy', label: '隐私政策' },
  { href: 'https://mdtbbs.cn/about', label: '关于与声明' },
];

export function LegalFooter({ className = '' }: { className?: string }) {
  return (
    <footer className={`site-legal-footer ${className}`.trim()}>
      <nav className="site-legal-footer__links" aria-label="法律与站点信息">
        {FOOTER_LINKS.map(({ href, label }) => (
          <a key={href} href={href} target="_blank" rel="noopener noreferrer">{label}</a>
        ))}
      </nav>
      <p className="site-legal-footer__copyright">© {new Date().getFullYear()} MDTBBS · MindAuth</p>
      <div className="site-legal-footer__filings">
        <a href="https://beian.miit.gov.cn/" target="_blank" rel="noopener noreferrer">
          鄂ICP备2024071060号-5
        </a>
        <a href="https://beian.mps.gov.cn/#/query/webSearch?code=65400302654113" target="_blank" rel="noopener noreferrer">
          新公网安备65400302654113号
        </a>
      </div>
    </footer>
  );
}
