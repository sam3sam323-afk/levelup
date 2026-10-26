import { useEffect } from "react";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { isTauriRuntime } from "./lib/tauriBridge";
import Home from "./pages/Home";
import NotFound from "./pages/NotFound";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/404" component={NotFound} />
      <Route component={NotFound} />
    </Switch>
  );
}

export default function App() {
  useEffect(() => {
    document.documentElement.dataset.nexusRuntime = isTauriRuntime() ? "tauri" : "browser";
  }, []);

  return (
    <ErrorBoundary>
      <Router />
    </ErrorBoundary>
  );
}
