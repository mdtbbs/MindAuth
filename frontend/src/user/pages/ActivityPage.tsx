import { useAuth } from '@/auth/AuthProvider';
import api from '@/api/client';
import type { LoginLog } from '@/api/types';
import { useResource } from '@/api/useResource';
import { AccountEmptyState, AccountLoadState, AccountSection, formatAccountDate, parseUserAgent } from '@/user/components/AccountPageParts';
import { AccountShell } from '@/user/components/AccountShell';

interface LoginLogsResponse { success: boolean; logs: LoginLog[] }

function loginMethod(value: string) {
  if (value === 'web') return 'Web 登录';
  if (value === 'oauth') return 'OAuth 登录';
  if (value === 'native') return '客户端登录';
  if (value === 'social') return '关联账号登录';
  return value || '登录';
}

export function ActivityPage() {
  const { user } = useAuth();
  const logs = useResource(
    (signal) => api.get<LoginLogsResponse>('/api/login-logs', { signal }),
    [],
    { enabled: Boolean(user) },
  );
  const records = logs.data?.logs ?? [];

  return (
    <AccountShell title="登录记录" description="查看 MindAuth 已记录的近期账户登录活动。">
      {user ? (
        <AccountSection title="近期登录" description="此 API 提供登录时间、客户端信息、IP 和登录方式；未提供地理位置或失败状态。">
          <AccountLoadState loading={logs.loading} error={logs.error} retry={logs.reload}>
            {records.length ? (
              <>
                <div className="account-activity-table-wrap">
                  <table className="account-activity-table">
                    <thead><tr><th scope="col">时间</th><th scope="col">客户端</th><th scope="col">IP 地址</th><th scope="col">登录方式</th></tr></thead>
                    <tbody>
                      {records.map((record) => (
                        <tr key={record.id}>
                          <td>{formatAccountDate(record.created_at, true)}</td>
                          <td>{parseUserAgent(record.device)}</td>
                          <td>{record.ip || '未提供'}</td>
                          <td>{loginMethod(record.login_type)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <ol className="account-activity-list">
                  {records.map((record) => (
                    <li className="account-activity-list__item" key={record.id}>
                      <strong>{loginMethod(record.login_type)}</strong>
                      <span>{formatAccountDate(record.created_at, true)}</span>
                      <span>{parseUserAgent(record.device)}</span>
                      <span>IP：{record.ip || '未提供'}</span>
                    </li>
                  ))}
                </ol>
              </>
            ) : <AccountEmptyState>没有登录记录。</AccountEmptyState>}
          </AccountLoadState>
        </AccountSection>
      ) : null}
    </AccountShell>
  );
}
