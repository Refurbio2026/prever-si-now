import { createFileRoute, Link } from "@tanstack/react-router";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/admin/api-debug")({
  component: AdminApiDebug,
});

function AdminApiDebug() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold sm:text-3xl">API Debug</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Diagnostika Finstat integrácie beží v dashboarde.
        </p>
      </div>
      <Card className="rounded-2xl border-border/70 p-6 shadow-soft">
        <p className="text-sm text-muted-foreground">
          Otvorte plnú diagnostickú stránku pre Finstat API.
        </p>
        <Button asChild className="mt-4 rounded-xl">
          <Link to="/dashboard/api-debug">Otvoriť Finstat diagnostiku</Link>
        </Button>
      </Card>
    </div>
  );
}
