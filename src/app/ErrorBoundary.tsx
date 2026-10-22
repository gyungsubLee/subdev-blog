import { Component, type ReactNode } from "react";

export default class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: string }
> {
  state = { error: "" };
  static getDerivedStateFromError(error: Error) {
    return { error: error.message };
  }
  render() {
    if (this.state.error) {
      return (
        <main className="app-state">
          <h1>화면을 열지 못했습니다.</h1>
          <p>{this.state.error}</p>
          <a href="/">다시 열기</a>
        </main>
      );
    }
    return this.props.children;
  }
}
