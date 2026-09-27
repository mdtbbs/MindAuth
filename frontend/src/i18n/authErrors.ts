export type AuthTranslator = (key: string, values?: Record<string, string | number>) => string;

export function localizeRegistrationError(reason: unknown, t: AuthTranslator, fallback: string) {
  const error = reason as { code?: string; status?: number; retry_after_seconds?: number } | null;
  switch (error?.code) {
    case 'INVALID_EMAIL': return t('register.emailInvalid');
    case 'EMAIL_DOMAIN_BLOCKED': return t('register.emailBlocked');
    case 'EMAIL_ALREADY_REGISTERED': return t('register.emailAlreadyRegistered');
    case 'EMAIL_COOLDOWN': return t('register.emailCooldown', { seconds: error.retry_after_seconds || 60 });
    case 'SMTP_UNAVAILABLE': return t('register.emailServiceUnavailable');
    case 'SMTP_SEND_FAILED': return t('register.codeSendFailed');
    case 'EMAIL_POLICY_UNAVAILABLE': return t('register.policyUnavailable');
    case 'EMAIL_CODE_INVALID': return t('register.codeInvalid');
    case 'EMAIL_CODE_MISMATCH': return t('register.codeMismatch');
    case 'EMAIL_CODE_MAX_FAILURES': return t('register.codeMaxFailures');
    case 'CHALLENGE_REQUIRED': return t('register.challengeRequired');
    case 'CHALLENGE_EXPIRED': return t('register.challengeExpired');
    case 'CHALLENGE_MISMATCH': return t('register.challengeMismatch');
    case 'CHALLENGE_NOT_FOUND': return t('register.challengeNotFound');
    case 'CHALLENGE_FAILED': return t('register.challengeFailed');
    case 'INVALID_STATE': return t('social.invalidDescription');
    case 'SOCIAL_REGISTRATION_FAILED': return t('social.submitFailed');
    default: return error?.status === 409 ? t('register.usernameOrEmailTaken') : fallback;
  }
}
