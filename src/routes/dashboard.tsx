import { createFileRoute, Outlet } from "@tanstack/react-router";
import { Search, Bell } from "lucide-react";

import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { DashboardSidebar } from "@/components/dashboard-sidebar";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/dashboard")({
  component: DashboardLayout,
  head: () => ({
    meta: [
      { title: "Dashboard — PreverSi.sk" },
      { name: "description", content: "Váš prehľad preverovaných firiem." },
    ],
  }),
});

function DashboardLayout() {
  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full bg-secondary/30">
        <DashboardSidebar />
        <SidebarInset className="bg-transparent">
          <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border/60 bg-background/80 px-4 backdrop-blur-md sm:px-6">
            <SidebarTrigger className="-ml-1" />
            <div className="flex flex-1 items-center gap-3">
              <div className="relative w-full max-w-md">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Hľadať firmu, IČO alebo osobu..."
                  className="h-10 w-full rounded-xl border border-input bg-secondary/60 pl-10 pr-4 text-sm outline-none transition-colors focus:border-primary focus:bg-background"
                />
              </div>
            </div>
            <Button size="icon" variant="ghost" className="rounded-full">
              <Bell className="h-4 w-4" />
            </Button>
            <Avatar className="h-9 w-9 border border-border">
              <AvatarFallback className="bg-primary text-primary-foreground text-xs font-semibold">JN</AvatarFallback>
            </Avatar>
          </header>
          <main className="flex-1 p-4 sm:p-6 lg:p-8">
            <Outlet />
          </main>
        </SidebarInset>
      </div>
    </SidebarProvider>
  );
}
