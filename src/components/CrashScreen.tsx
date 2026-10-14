import { Component, type ErrorInfo, type ReactNode } from 'react';

declare global {
  interface Window {
    __pastimeCrash?: (message: string) => void;
    __pastimeRepair?: () => void;
  }
}

/** If any screen crashes, show what happened (and a way out) instead of an empty page. */
export class CrashScreen extends Component<{ children: ReactNode }, { error?: Error }> {
  state: { error?: Error } = {};

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    window.__pastimeCrash?.(`Crash: ${error.name}: ${error.message}\n${(error.stack ?? '').split('\n').slice(0, 6).join('\n')}\n${(info.componentStack ?? '').split('\n').slice(0, 6).join('\n')}`);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="pt-safe mx-auto max-w-md px-5 py-12">
        <h1 className="display mb-3 text-[2.4rem]">Something went wrong</h1>
        <p className="mb-5 text-muted">Your library is safe on this device. Reloading usually fixes it; Repair also clears the saved copy of the app.</p>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => location.reload()} className="rounded-2xl bg-accent px-4 py-2.5 text-sm font-semibold text-on-accent">
            Reload
          </button>
          <button onClick={() => window.__pastimeRepair?.()} className="rounded-2xl bg-surface-2 px-4 py-2.5 text-sm font-semibold">
            Repair &amp; reload
          </button>
        </div>
        <pre className="mt-6 text-xs whitespace-pre-wrap text-muted">
          {error.name}: {error.message}
        </pre>
      </div>
    );
  }
}
