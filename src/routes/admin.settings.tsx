import { createFileRoute } from "@tanstack/react-router";
import { Card } from "@/components/ui/card";

export const Route = createFileRoute("/admin/settings")({
  component: AdminSettings,
});

function AdminSettings() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold sm:text-3xl">Nastavenia</h1>
        <p className="mt-1 text-sm text-muted-foreground">Systémové administrátorské nastavenia.</p>
      </div>
      <Card className="rounded-2xl border-border/70 p-6 shadow-soft">
        <p className="text-sm text-muted-foreground">
          Zatiaľ tu nie sú žiadne nastavenia. Pridávajte ich podľa potreby.
        </p>
      </Card>
    </div>
  );
}
