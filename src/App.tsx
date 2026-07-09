import { Suspense } from "react";
import { Route, Router, Switch, Link } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { ArrowLeft } from "lucide-react";
import Home from "./pages/Home";
import NotFound from "./pages/NotFound";
import { tools, type ToolDefinition } from "./tools/registry";

function ToolShell({ tool }: { tool: ToolDefinition }) {
  const ToolComponent = tool.component;
  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-background text-foreground">
      <header className="flex items-center gap-3 h-12 px-4 border-b border-border bg-card shrink-0">
        <Link
          href="/"
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          All tools
        </Link>
        <span className="text-muted-foreground/40">/</span>
        <h1 className="text-sm font-semibold flex items-center gap-2">
          <tool.icon className="h-4 w-4 text-primary" />
          {tool.name}
        </h1>
      </header>
      <main className="flex-1 min-h-0">
        <Suspense
          fallback={
            <div className="flex h-full items-center justify-center text-muted-foreground">
              Loading {tool.name}…
            </div>
          }
        >
          <ToolComponent />
        </Suspense>
      </main>
    </div>
  );
}

function App() {
  return (
    <Router hook={useHashLocation}>
      <Switch>
        <Route path="/" component={Home} />
        {tools.map((tool) => (
          <Route key={tool.id} path={`/tools/${tool.id}`}>
            <ToolShell tool={tool} />
          </Route>
        ))}
        <Route component={NotFound} />
      </Switch>
    </Router>
  );
}

export default App;
