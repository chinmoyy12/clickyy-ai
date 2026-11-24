import { Component, StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/index.css';

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  override state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  override render() {
    if (!this.state.error) return this.props.children;
    return (
      <div role="alert" className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
        <div className="wordmark text-xs text-gold">CLICKYY</div>
        <h1 className="text-lg font-semibold">Something went wrong in the interface</h1>
        <p className="max-w-sm text-sm text-muted selectable">{this.state.error.message}</p>
        <button className="rounded-lg border border-line bg-surface2 px-4 py-2 text-sm hover:border-gold" onClick={() => location.reload()}>Reload interface</button>
      </div>
    );
  }
}

// Design preview in a plain browser (dev server only): run vite, then open /?mock.
if (import.meta.env.DEV && !window.clickyy && location.search.includes('mock')) await import('./dev/mockBridge');
const { App } = await import('./App');

// One root per page, even if the dev server re-runs this module.
const container = document.getElementById('root')! as HTMLElement & { _clickyyRoot?: ReturnType<typeof createRoot> };
container._clickyyRoot ??= createRoot(container);
container._clickyyRoot.render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
