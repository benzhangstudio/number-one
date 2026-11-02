import { Component, type ReactNode } from "react";

/**
 * Catches a crash inside one dashboard section, so the rest of the page keeps working
 * instead of going blank. Shows a short message with a way to try again.
 */
export class ErrorBoundary extends Component<{ children: ReactNode; name: string }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error(`[dashboard] ${this.props.name} crashed:`, error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="notice warning-box">
        <strong>Something went wrong in {this.props.name}.</strong>
        <span className="small">Your saved settings are safe. Try again, or reload the page.</span>
        <span className="small muted">{this.state.error.message}</span>
        <button className="btn ghost small" onClick={() => this.setState({ error: null })}>Try again</button>
      </div>
    );
  }
}
