import { Component, StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/index.css';
import { App } from './App';

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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
