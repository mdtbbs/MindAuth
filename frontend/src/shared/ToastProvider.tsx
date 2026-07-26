import {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
  type ReactNode,
} from 'react';

// ─── Types ───────────────────────────────────────────────────────────────────

type ToastVariant = 'success' | 'error' | 'warning' | 'info';

interface Toast {
  id: number;
  variant: ToastVariant;
  message: string;
  /** true while playing the exit animation, before removal */
  leaving?: boolean;
}

interface ToastContextValue {
  toast: (variant: ToastVariant, message: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

// ─── Provider ────────────────────────────────────────────────────────────────

let nextId = 0;
const AUTO_DISMISS_MS = 5000;
const EXIT_MS = 200;

interface ToastProviderProps {
  children: ReactNode;
}

export function ToastProvider({ children }: ToastProviderProps) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  // Per-toast auto-dismiss timers, so we can pause them on hover
  const autoTimers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  const remove = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const dismiss = useCallback(
    (id: number) => {
      const timer = autoTimers.current.get(id);
      if (timer) {
        clearTimeout(timer);
        autoTimers.current.delete(id);
      }
      // Mark leaving so the exit animation plays, then remove
      setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
      setTimeout(() => remove(id), EXIT_MS);
    },
    [remove],
  );

  const scheduleAutoDismiss = useCallback(
    (id: number) => {
      autoTimers.current.set(
        id,
        setTimeout(() => dismiss(id), AUTO_DISMISS_MS),
      );
    },
    [dismiss],
  );

  const toast = useCallback(
    (variant: ToastVariant, message: string) => {
      const id = nextId++;
      setToasts((prev) => [...prev, { id, variant, message }]);
      scheduleAutoDismiss(id);
    },
    [scheduleAutoDismiss],
  );

  // Pause auto-dismiss while the pointer is over a toast; resume on leave
  const pause = useCallback((id: number) => {
    const timer = autoTimers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      autoTimers.current.delete(id);
    }
  }, []);

  const resume = useCallback(
    (id: number) => {
      if (!autoTimers.current.has(id)) scheduleAutoDismiss(id);
    },
    [scheduleAutoDismiss],
  );

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}

      <div className="toast-container">
        {toasts.map((t) => {
          const assertive = t.variant === 'error' || t.variant === 'warning';
          return (
            <div
              key={t.id}
              className={`toast toast--${t.variant}${t.leaving ? ' toast--leaving' : ''}`}
              role={assertive ? 'alert' : 'status'}
              aria-live={assertive ? 'assertive' : 'polite'}
              onMouseEnter={() => pause(t.id)}
              onMouseLeave={() => resume(t.id)}
            >
              <span className="toast__message">{t.message}</span>
              <button
                className="toast__dismiss"
                onClick={() => dismiss(t.id)}
                aria-label="关闭通知"
                type="button"
              >
                ✕
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used inside <ToastProvider>');
  }
  return ctx;
}
