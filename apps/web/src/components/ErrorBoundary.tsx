import { Component, type ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

type Props = { children: ReactNode };
type State = { error: Error | null };

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: unknown) {
    // eslint-disable-next-line no-console
    console.error("Atelier error boundary caught:", error, info);
  }

  reset = () => this.setState({ error: null });

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex items-center justify-center w-full h-full p-8 bg-zinc-950">
        <div className="max-w-lg bg-zinc-900 border border-rose-900/60 rounded-xl p-6 shadow-2xl">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="w-5 h-5 text-rose-400" />
            <h2 className="text-base font-medium">Something broke in the canvas</h2>
          </div>
          <p className="text-sm text-zinc-400 mb-3">
            The React tree raised an error and couldn't recover on its own. This usually means a
            backend response changed shape or a node is in an unexpected state.
          </p>
          <details className="text-[11px] text-zinc-500 font-mono mb-4 max-h-56 overflow-auto">
            <summary className="cursor-pointer text-zinc-400 mb-1">Stack trace</summary>
            <pre className="whitespace-pre-wrap">{String(this.state.error.stack || this.state.error.message)}</pre>
          </details>
          <div className="flex items-center gap-2">
            <button
              onClick={this.reset}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded bg-amber-500 hover:bg-amber-400 text-black font-medium"
            >
              <RefreshCw className="w-4 h-4" /> Try again
            </button>
            <button
              onClick={() => location.reload()}
              className="px-3 py-1.5 text-sm text-zinc-400 hover:text-zinc-100"
            >
              Hard reload
            </button>
          </div>
        </div>
      </div>
    );
  }
}
