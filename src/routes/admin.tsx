import { createFileRoute, Outlet } from "@tanstack/react-router";

import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AdminSidebar } from "@/components/admin-sidebar";
import { AdminGuard } from "@/components/admin-guard";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/admin")({
  component: AdminLayout,
  head: () => ({
    meta: [
      { title: "Admin — PreverSi.sk" },
      { name: "description", content: "Administrátorské rozhranie PreverSi.sk." },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
});

function AdminLayout() {
  return (
    <AdminGuard>
      <SidebarProvider>
        <div className="flex min-h-screen w-full bg-secondary/30">
          <AdminSidebar />
          <SidebarInset className="bg-transparent">
            <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border/60 bg-background/80 px-4 backdrop-blur-md sm:px-6">
              <SidebarTrigger className="-ml-1" />
              <div className="flex flex-1 items-center gap-2">
                <h2 className="text-sm font-semibold">Administrácia</h2>
                <Badge className="rounded-full bg-primary/10 text-primary">admin</Badge>
              </div>
            </header>
            <main className="flex-1 p-4 sm:p-6 lg:p-8">
              <Outlet />
            </main>
          </SidebarInset>
        </div>
      </SidebarProvider>
    </AdminGuard>
  );
}
