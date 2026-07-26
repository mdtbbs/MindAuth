import { Link } from 'react-router-dom';
import { Button } from '@/shared/Button';
import { AuthShell } from '@/user/components/AuthShell';

interface ErrorPageProps {
  status?: number;
  title?: string;
  message?: string;
}

export function ErrorPage({ status = 404, title, message }: ErrorPageProps) {
  const defaultTitle = status === 404 ? '页面未找到' : '页面发生错误';
  const defaultMessage =
    status === 404
      ? '您访问的页面不存在，可能已被移动或删除。'
      : '系统暂时无法完成当前操作，请稍后再试。';

  return (
    <AuthShell
      title={title ?? defaultTitle}
      description="您仍然可以返回登录页或继续访问账户中心的主要入口。"
      footer={
        <>
          <Link to="/login" className="inline-link">
            返回登录
          </Link>
          <span className="text-muted">/</span>
          <Link to="/dashboard" className="inline-link">
            前往 Dashboard
          </Link>
        </>
      }
    >
      <div className="stack">
        <div className={status === 404 ? 'status-badge status-badge--warning' : 'status-badge status-badge--danger'}>
          HTTP {status}
        </div>
        <p className="section-description">{message ?? defaultMessage}</p>
        <div className="cluster">
          <Link to="/login">
            <Button variant="primary">前往登录</Button>
          </Link>
          <Link to="/dashboard">
            <Button variant="secondary">打开 Dashboard</Button>
          </Link>
        </div>
      </div>
    </AuthShell>
  );
}
