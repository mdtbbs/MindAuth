import { Component, type ReactNode, type ErrorInfo } from 'react';

/**
 * App-level error boundary. Renders a design-system-styled fallback (adapts to
 * light/dark) instead of a blank screen. The raw stack trace is only shown in
 * development — production users see a friendly message, not implementation
 * details.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('React error boundary caught:', error, errorInfo);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div
        style={{
          minHeight: '100dvh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 'var(--space-6)',
          background: 'var(--color-bg)',
        }}
      >
        <div className="card card--padding-lg" style={{ maxWidth: '32rem', width: '100%' }}>
          <h1 style={{ fontSize: 'var(--text-xl)', fontWeight: 'var(--weight-semibold)', color: 'var(--color-text)' }}>
            页面出现了一点问题
          </h1>
          <p style={{ marginTop: 'var(--space-3)', color: 'var(--color-text-secondary)', fontSize: 'var(--text-sm)' }}>
            很抱歉，加载时发生了错误。请刷新页面重试；如果问题持续，请联系管理员。
          </p>
          <div style={{ marginTop: 'var(--space-5)' }}>
            <button className="btn btn--primary" type="button" onClick={() => window.location.reload()}>
              刷新页面
            </button>
          </div>
          {import.meta.env.DEV && (
            <pre
              style={{
                marginTop: 'var(--space-5)',
                padding: 'var(--space-3)',
                background: 'var(--color-bg-sunken)',
                borderRadius: 'var(--radius-md)',
                fontSize: 'var(--text-xs)',
                color: 'var(--color-error)',
                overflowX: 'auto',
                whiteSpace: 'pre-wrap',
              }}
            >
              {error.stack || error.toString()}
            </pre>
          )}
        </div>
      </div>
    );
  }
}
