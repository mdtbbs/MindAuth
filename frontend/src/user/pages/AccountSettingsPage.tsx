import { Navigate, useSearchParams } from 'react-router-dom';

/** Keep historical links working while account settings move to first-class routes. */
export function AccountSettingsPage() {
  const [searchParams] = useSearchParams();
  const legacySection = searchParams.get('section') || searchParams.get('tab');
  const target = searchParams.get('social') === 'qq_bound' || legacySection === 'security' || legacySection === 'danger'
    ? '/security'
    : legacySection === 'activity'
      ? '/activity'
      : legacySection === 'sessions'
        ? '/sessions'
        : legacySection === 'authorizations'
          ? '/authorizations'
          : legacySection === 'notifications'
            ? '/notifications'
            : '/profile';
  const hash = legacySection === 'danger' ? '#danger-zone' : legacySection === 'fields' ? '#custom-fields' : '';
  const query = new URLSearchParams(searchParams);
  query.delete('section');
  query.delete('tab');
  return <Navigate to={`${target}${query.toString() ? `?${query.toString()}` : ''}${hash}`} replace />;
}
