import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';

type ToastKind = 'success' | 'error' | 'info';

interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

interface ToastApi {
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

let counter = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = useCallback((kind: ToastKind, message: string) => {
    counter += 1;
    const id = counter;
    setToasts((previous) => [...previous.slice(-3), { id, kind, message }]);
    window.setTimeout(() => {
      setToasts((previous) => previous.filter((toast) => toast.id !== id));
    }, 4200);
  }, []);

  const api = useMemo<ToastApi>(
    () => ({
      success: (message: string) => push('success', message),
      error: (message: string) => push('error', message),
      info: (message: string) => push('info', message),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-14 z-[60] flex flex-col items-center gap-2 px-4 sm:bottom-6 sm:left-auto sm:right-6 sm:items-end">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`fade-in pointer-events-auto flex w-full max-w-sm items-start gap-2.5 rounded-lg border px-3.5 py-2.5 text-xs shadow-xl backdrop-blur ${
              toast.kind === 'success'
                ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-100'
                : toast.kind === 'error'
                  ? 'border-rose-500/40 bg-rose-500/10 text-rose-100'
                  : 'border-line2 bg-panel3/95 text-slate-200'
            }`}
            role="status"
          >
            {toast.kind === 'success' ? (
              <CheckCircle2 size={15} className="mt-0.5 shrink-0" />
            ) : toast.kind === 'error' ? (
              <AlertTriangle size={15} className="mt-0.5 shrink-0" />
            ) : (
              <Info size={15} className="mt-0.5 shrink-0" />
            )}
            <span className="leading-relaxed">{toast.message}</span>
            <button
              type="button"
              onClick={() =>
                setToasts((previous) => previous.filter((entry) => entry.id !== toast.id))
              }
              className="ml-auto shrink-0 rounded p-0.5 text-current/60 transition hover:text-current"
              aria-label="Dismiss notification"
            >
              <X size={13} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used inside <ToastProvider>');
  return context;
}
