import { Link } from 'react-router-dom';
import { AuthShell } from '@/user/components/AuthShell';
import { useI18n } from '@/i18n/I18nProvider';

/**
 * QQ 登录状态页面
 *
 * 后端 callback 会直接跳转到：
 * - /qq-register?state=... (未绑定，需要注册)
 * - /account-settings?social=qq_bound (绑定成功)
 * - /dashboard (登录成功)
 * - /login?error=... (失败)
 *
 * 这个页面保留为备用错误页，不处理旧的 ticket/action 协议。
 */
export function QqConfirmPage() {
  const { t } = useI18n();
  return (
    <AuthShell
      title={t('qq.title')}
      description={t('qq.description')}
      footer={<Link className="inline-link" to="/login">{t('qq.backToLogin')}</Link>}
    >
      <p>{t('qq.problem')}</p>
      <p>{t('qq.restart')}</p>
    </AuthShell>
  );
}
