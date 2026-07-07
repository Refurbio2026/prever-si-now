import { createFileRoute } from "@tanstack/react-router";
import { Bell, Plus, Building2 } from "lucide-react";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";

export const Route = createFileRoute("/dashboard/monitoring")({
  component: MonitoringPage,
});

const items = [
  { name: "Alza.sk s.r.o.", ico: "36562939", alerts: 3, enabled: true },
  { name: "Martinus, s.r.o.", ico: "35955725", alerts: 1, enabled: true },
  { name: "Websupport s.r.o.", ico: "36421928", alerts: 0, enabled: true },
  { name: "Pixel Federation, s.r.o.", ico: "35943518", alerts: 5, enabled: false },
  { name: "Sygic a.s.", ico: "35892490", alerts: 0, enabled: true },
];

function MonitoringPage() {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold sm:text-3xl">Monitoring firiem</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Sledujte zmeny a dostávajte notifikácie e-mailom.
          </p>
        </div>
        <Button className="rounded-xl shadow-soft">
          <Plus className="mr-2 h-4 w-4" /> Pridať firmu
        </Button>
      </div>

      <div className="grid gap-3">
        {items.map((it) => (
          <Card key={it.ico} className="rounded-2xl border-border/70 p-5 shadow-soft">
            <div className="flex items-center gap-4">
              <div className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-accent text-primary">
                <Building2 className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate font-semibold">{it.name}</div>
                <div className="mt-0.5 text-xs text-muted-foreground">IČO {it.ico}</div>
              </div>
              {it.alerts > 0 ? (
                <Badge className="rounded-full bg-warning/20 text-warning-foreground">
                  <Bell className="mr-1 h-3 w-3" /> {it.alerts} nové
                </Badge>
              ) : (
                <Badge variant="secondary" className="rounded-full">
                  Bez zmien
                </Badge>
              )}
              <Switch defaultChecked={it.enabled} />
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
