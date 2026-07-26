import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

interface AuthShellProps {
  title: string;
  description: string;
  eyebrow?: string;
  heroTitle?: string;
  heroDescription?: string;
  heroFeatures?: Array<{ title: string; text: string }>;
  footer?: ReactNode;
  children: ReactNode;
}

const DEFAULT_FEATURES = [
  {
    title: '统一认证入口',
    text: '使用 MindAuth 安全访问社区应用和开发者能力。',
  },
  {
    title: '账号安全中心',
    text: '集中管理邮箱验证、会话状态、授权应用与安全信息。',
  },
  {
    title: '稳定的 OAuth 体验',
    text: '保留现有授权流程，强化登录上下文和关键状态提示。',
  },
  {
    title: '面向平台的账户中心',
    text: '更清晰的分组、留白和层次，降低用户理解成本。',
  },
];

export function AuthShell({
  title,
  description,
  eyebrow = 'MindAuth 账户中心',
  heroTitle = '统一的账号入口，清晰的安全体验。',
  heroDescription = '面向社区平台与开发者场景，集中处理登录、注册、账号安全和授权管理。',
  heroFeatures = DEFAULT_FEATURES,
  footer,
  children,
}: AuthShellProps) {
  return (
    <div className="page--auth auth-shell">
      <header className="auth-shell__header">
        <div className="auth-shell__header-inner">
          <Link to="/login" className="brand-mark">
            <span className="brand-mark__logo">M</span>
            <span>
              MindAuth
              <span className="brand-mark__sub"> / 账号中心</span>
            </span>
          </Link>
          <span className="text-secondary" style={{ fontSize: 'var(--text-sm)' }}>
            Secure Access Platform
          </span>
        </div>
      </header>

      <main className="auth-shell__main">
        <div className="auth-shell__content">
          <section className="auth-shell__hero" aria-label="MindAuth 介绍">
            <span className="auth-shell__eyebrow">{eyebrow}</span>
            <div>
              <h1 className="auth-shell__title">{heroTitle}</h1>
              <p className="auth-shell__description">{heroDescription}</p>
            </div>
            <div className="auth-shell__features">
              {heroFeatures.map((feature) => (
                <div key={feature.title} className="auth-shell__feature">
                  <div className="auth-shell__feature-title">{feature.title}</div>
                  <div className="auth-shell__feature-text">{feature.text}</div>
                </div>
              ))}
            </div>
          </section>

          <section className="auth-shell__panel" aria-label={title}>
            <div className="card">
              <div className="auth-panel__header">
                <h2 className="auth-panel__title">{title}</h2>
                <p className="auth-panel__description">{description}</p>
              </div>
              <div className="auth-panel__form">{children}</div>
              {footer ? <div className="auth-panel__footer">{footer}</div> : null}
              <div className="auth-panel__meta">
                继续操作即表示您理解该账户入口仅调整界面表现，不影响现有认证与授权逻辑。
              </div>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
