import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";

function NotFound() {
  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-background">
      <Card className="mx-4 w-full max-w-md">
        <CardContent className="pt-6 text-center">
          <h1 className="text-2xl font-bold">404 — Page not found</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            This page doesn't exist.
          </p>
          <Link href="/" className="mt-4 inline-block text-sm text-primary underline">
            Back to all tools
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}

export default NotFound;
