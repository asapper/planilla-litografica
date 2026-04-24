import { Component } from 'react';
import type { ReactNode } from 'react';

interface Props { children: ReactNode; }
interface State { error: Error | null; }

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen bg-background flex items-center justify-center p-6">
          <div className="m3-card-outlined w-full max-w-lg">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-shape-sm bg-error-container flex items-center justify-center shrink-0">
                <svg className="w-5 h-5 text-on-error-container" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                </svg>
              </div>
              <h2 className="text-title-md text-on-surface">Error de renderizado</h2>
            </div>
            <p className="text-body-md text-on-surface-variant mb-4">
              {this.state.error.message}
            </p>
            <pre className="text-body-sm text-on-surface-variant bg-surface-container p-3 rounded-shape-sm overflow-auto max-h-48 mb-4">
              {this.state.error.stack}
            </pre>
            <button
              className="m3-btn-outlined"
              onClick={() => this.setState({ error: null })}
            >
              Reintentar
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
