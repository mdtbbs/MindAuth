import { AccountSection } from '@/user/components/AccountPageParts';
import { AccountShell } from '@/user/components/AccountShell';

export function DeveloperPage() {
  return (
    <AccountShell title="开发者" description="将 MindAuth 身份能力接入 MDT 生态中的应用和客户端。">
      <div className="account-page-sections">
        <AccountSection title="接入 MindAuth" description="MindAuth 提供 OAuth 2.0 与 OpenID Connect 登录能力。">
          <div className="developer-panel">
            <p>第三方 Web 应用、启动器和生态客户端可通过已注册的 OAuth 客户端接入统一身份。接入前请确认重定向地址、客户端类型和所需权限范围。</p>
            <a className="btn btn--secondary" href="/docs.html">查看接入文档</a>
          </div>
        </AccountSection>
        <AccountSection title="客户端与授权" description="授权关系由用户在 MindAuth 中集中查看和撤销。">
          <div className="developer-panel">
            <p>客户端注册和凭据由服务管理员管理。你的账户授权可在应用页面查看；请勿在浏览器或公开客户端中保存客户端密钥。</p>
            <a className="account-text-link" href="/authorizations">管理已授权应用 <span aria-hidden="true">→</span></a>
          </div>
        </AccountSection>
      </div>
    </AccountShell>
  );
}
