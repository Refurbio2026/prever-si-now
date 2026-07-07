import { createFileRoute } from "@tanstack/react-router";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/dashboard/profile")({
  component: ProfilePage,
});

function ProfilePage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold sm:text-3xl">Môj profil</h1>
        <p className="mt-1 text-sm text-muted-foreground">Spravujte svoj účet a fakturačné údaje.</p>
      </div>

      <Card className="rounded-2xl border-border/70 p-6 shadow-soft">
        <div className="flex items-center gap-4">
          <Avatar className="h-16 w-16 border border-border">
            <AvatarFallback className="bg-primary text-lg font-semibold text-primary-foreground">JN</AvatarFallback>
          </Avatar>
          <div className="flex-1">
            <div className="text-lg font-semibold">Ján Novák</div>
            <div className="text-sm text-muted-foreground">jan.novak@firma.sk</div>
          </div>
          <Badge className="rounded-full bg-primary/10 text-primary">Pro plán</Badge>
        </div>
      </Card>

      <Card className="rounded-2xl border-border/70 p-6 shadow-soft">
        <h2 className="text-lg font-semibold">Osobné údaje</h2>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="name">Meno a priezvisko</Label>
            <Input id="name" defaultValue="Ján Novák" className="h-11 rounded-xl" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">E-mail</Label>
            <Input id="email" type="email" defaultValue="jan.novak@firma.sk" className="h-11 rounded-xl" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="company">Názov firmy</Label>
            <Input id="company" defaultValue="Moja Firma s.r.o." className="h-11 rounded-xl" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ico">IČO</Label>
            <Input id="ico" defaultValue="12345678" className="h-11 rounded-xl" />
          </div>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="outline" className="rounded-xl">Zrušiť</Button>
          <Button className="rounded-xl shadow-soft">Uložiť zmeny</Button>
        </div>
      </Card>

      <Card className="rounded-2xl border-border/70 p-6 shadow-soft">
        <h2 className="text-lg font-semibold">Bezpečnosť</h2>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="current">Aktuálne heslo</Label>
            <Input id="current" type="password" className="h-11 rounded-xl" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="new">Nové heslo</Label>
            <Input id="new" type="password" className="h-11 rounded-xl" />
          </div>
        </div>
        <div className="mt-6 flex justify-end">
          <Button className="rounded-xl shadow-soft">Zmeniť heslo</Button>
        </div>
      </Card>
    </div>
  );
}
