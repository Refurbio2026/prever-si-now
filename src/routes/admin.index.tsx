import { createFileRoute } from "@tanstack/react-router";
import { Card } from "@/components/ui/card";
import { Users, Building2, Bug, Settings } from "lucide-react";

export const Route = createFileRoute("/admin/")({
  component: AdminHome,
});

const tiles = [
  { title: "Users", desc: "Správa používateľov a rolí", icon: Users },
  { title: "Companies", desc: "Sledované firmy naprieč účtami", icon: Building2 },
  { title: "API Debug", desc: "Diagnostika Finstat API", icon: Bug },
  { title: "Settings", desc: "Systémové nastavenia", icon: Settings },
];

function AdminHome() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold sm:text-3xl">Admin dashboard</h1>
        <p className="mt-1 text-sm text-muted-foreground">Prehľad administrátorských nástrojov.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {tiles.map((t) => (
          <Card key={t.title} className="rounded-2xl border-border/70 p-5 shadow-soft">
            <t.icon className="h-6 w-6 text-primary" />
            <div className="mt-3 font-semibold">{t.title}</div>
            <div className="text-xs text-muted-foreground">{t.desc}</div>
          </Card>
        ))}
      </div>
    </div>
  );
}
