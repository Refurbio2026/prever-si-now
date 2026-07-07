import { createFileRoute } from "@tanstack/react-router";
import { FileText, Download, Plus } from "lucide-react";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/dashboard/reports")({
  component: ReportsPage,
});

const reports = [
  { name: "ESET, spol. s r.o.", date: "12. 3. 2026", type: "Kompletný", status: "Hotové" },
  { name: "Slovnaft, a.s.", date: "10. 3. 2026", type: "Finančný", status: "Hotové" },
  { name: "Alza.sk s.r.o.", date: "8. 3. 2026", type: "Rizikový", status: "Hotové" },
  { name: "Orange Slovensko, a.s.", date: "5. 3. 2026", type: "Kompletný", status: "Generuje sa" },
];

function ReportsPage() {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold sm:text-3xl">Reporty</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            PDF reporty pripravené na stiahnutie a zdieľanie.
          </p>
        </div>
        <Button className="rounded-xl shadow-soft">
          <Plus className="mr-2 h-4 w-4" /> Nový report
        </Button>
      </div>

      <div className="grid gap-3">
        {reports.map((r) => (
          <Card key={r.name + r.date} className="rounded-2xl border-border/70 p-5 shadow-soft">
            <div className="flex items-center gap-4">
              <div className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-accent text-primary">
                <FileText className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate font-semibold">{r.name}</div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {r.type} · {r.date}
                </div>
              </div>
              <Badge
                variant="secondary"
                className={`rounded-full ${
                  r.status === "Hotové" ? "bg-success/15 text-success" : "bg-warning/20 text-warning-foreground"
                }`}
              >
                {r.status}
              </Badge>
              <Button variant="outline" size="sm" className="rounded-xl" disabled={r.status !== "Hotové"}>
                <Download className="mr-1.5 h-4 w-4" /> PDF
              </Button>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
