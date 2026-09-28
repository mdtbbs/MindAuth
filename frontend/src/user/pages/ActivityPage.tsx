import { useAuth } from '@/auth/AuthProvider';
import api from '@/api/client';
import type { LoginLog } from '@/api/types';
import { useResource } from '@/api/useResource';
import { AccountEmptyState, AccountLoadState, AccountSection, formatAccountDate, parseUserAgent } from '@/user/components/AccountPageParts';
import { AccountShell } from '@/user/components/AccountShell';
import { useI18n } from '@/i18n/I18nProvider';

interface LoginLogsResponse { success: boolean; logs: LoginLog[] }

function loginMethod(value: string, t: (key: string) => string) {
  if (value === 'web') return t('activity.web');
  if (value === 'oauth') return t('activity.oauth');
  if (value === 'native') return t('activity.native');
  if (value === 'social') return t('activity.social');
  return value || t('activity.generic');
}

export function ActivityPage() {
  const { t } = useI18n();
  const { user } = useAuth();
  const logs = useResource(
    (signal) => api.get<LoginLogsResponse>('/api/login-logs', { signal }),
    [],
    { enabled: Boolean(user) },
  );
  const records = logs.data?.logs ?? [];

  return (
    <AccountShell title={t('activity.title')} description={t('activity.description')}>
      {user ? (
        <AccountSection title={t('activity.recent')} description={t('activity.details')}>
          <AccountLoadState loading={logs.loading} error={logs.error} retry={logs.reload}>
            {records.length ? (
              <>
                <div className="account-activity-table-wrap">
                  <table className="account-activity-table">
                    <thead><tr><th scope="col">{t('activity.time')}</th><th scope="col">{t('activity.client')}</th><th scope="col">{t('activity.ip')}</th><th scope="col">{t('activity.method')}</th></tr></thead>
                    <tbody>
                      {records.map((record) => (
                        <tr key={record.id}>
                          <td>{formatAccountDate(record.created_at, true)}</td>
                          <td>{parseUserAgent(record.device)}</td>
                          <td>{record.ip || t('activity.notProvided')}</td>
                          <td>{loginMethod(record.login_type, t)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <ol className="account-activity-list">
                  {records.map((record) => (
                    <li className="account-activity-list__item" key={record.id}>
                      <strong>{loginMethod(record.login_type, t)}</strong>
                      <span>{formatAccountDate(record.created_at, true)}</span>
                      <span>{parseUserAgent(record.device)}</span>
                      <span>{t('activity.ip')}：{record.ip || t('activity.notProvided')}</span>
                    </li>
                  ))}
                </ol>
              </>
            ) : <AccountEmptyState>{t('activity.empty')}</AccountEmptyState>}
          </AccountLoadState>
        </AccountSection>
      ) : null}
    </AccountShell>
  );
}
