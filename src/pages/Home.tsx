import { Link } from "wouter";
import { Sparkles, Plus } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { tools } from "@/tools/registry";

function Home() {
  return (
    <div className="min-h-[100dvh] w-full overflow-y-auto bg-background text-foreground">
      <div className="mx-auto max-w-5xl px-5 pb-20 pt-10 sm:px-6 sm:py-16">
        <header className="mb-8 text-center sm:mb-12">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-border bg-card px-4 py-1.5 text-sm text-muted-foreground">
            <Sparkles className="h-4 w-4 text-primary" />
            Interactive math visualizations
          </div>
          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
            Visual Math Tools
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-muted-foreground">
            A growing collection of interactive tools for building mathematical
            intuition — see the concepts, don't just compute them.
          </p>
        </header>

        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {tools.map((tool) => (
            <Link key={tool.id} href={`/tools/${tool.id}`} className="group">
              <Card className="h-full transition-all group-hover:border-primary group-hover:shadow-md">
                <CardHeader>
                  <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                    <tool.icon className="h-5 w-5 text-primary" />
                  </div>
                  <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {tool.category}
                  </div>
                  <CardTitle className="text-lg">{tool.name}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">
                    {tool.description}
                  </p>
                </CardContent>
              </Card>
            </Link>
          ))}

          <Card className="h-full border-dashed">
            <CardHeader>
              <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
                <Plus className="h-5 w-5 text-muted-foreground" />
              </div>
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Coming soon
              </div>
              <CardTitle className="text-lg text-muted-foreground">
                More tools
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Calculus, probability, complex numbers, and more. Add your own
                in <code className="rounded bg-muted px-1">src/tools/</code>.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

export default Home;
