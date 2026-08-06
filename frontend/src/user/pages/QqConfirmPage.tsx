import { Link } from 'react-router-dom';
import { AuthShell } from '@/user/components/AuthShell';

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
  return (
    <AuthShell
      title="QQ 登录"
      description="请通过 QQ 授权页面完成登录。"
      footer={<Link className="inline-link" to="/login">返回登录</Link>}
    >
      <p>如果您看到此页面，可能是授权流程出现异常。</p>
      <p>请重新点击登录页面的"使用 QQ 登录"按钮。</p>
    </AuthShell>
  );
}
