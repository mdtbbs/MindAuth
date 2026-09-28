import { currentText } from '@/i18n/runtimeText';

interface LoadingStateProps {
  /** Optional label shown next to the spinner. */
  message?: string;
}

/**
 * Full-block loading indicator (spinner + label). Use in place of bare
 * "加载中..." text when a whole panel/page is waiting on data.
 */
export function LoadingState({ message }: LoadingStateProps) {
  return (
    <div className="loading-state" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      <span>{message || currentText('shared.loadingEllipsis')}</span>
    </div>
  );
}
