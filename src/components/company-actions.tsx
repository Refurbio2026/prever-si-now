import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, BellOff, Download, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import type { Company } from "@/lib/types";

interface Props {
  company: Company;
}

export function CompanyActions({ company }: Props) {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const watchQuery = useQuery({
    queryKey: ["watched_companies", user?.id, "check", company.ico],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("watched_companies")
        .select("id")
        .eq("ico", company.ico)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const watched = !!watchQuery.data;

  const toggleWatch = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("Nie ste prihlásený");
      if (watched && watchQuery.data) {
        const { error } = await supabase
          .from("watched_companies")
          .delete()
          .eq("id", watchQuery.data.id);
        if (error) throw error;
        return "removed" as const;
      }
      const { error } = await supabase.from("watched_companies").insert({
        user_id: user.id,
        ico: company.ico,
        company_name: company.name,
        risk_score: company.riskScore,
      });
      if (error) throw error;
      return "added" as const;
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["watched_companies"] });
      toast.success(
        result === "added" ? "Firma pridaná do sledovaných" : "Firma odstránená zo sledovaných",
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const saveReport = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("Nie ste prihlásený");
      const { error } = await supabase.from("reports").insert({
        user_id: user.id,
        ico: company.ico,
        company_name: company.name,
        report_type: "company_profile",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["reports"] });
      toast.success("Report uložený");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function requireAuth(action: () => void) {
    if (loading) return;
    if (!user) {
      toast.info("Pre túto akciu sa prihláste");
      navigate({ to: "/login" });
      return;
    }
    action();
  }

  return (
    <div className="grid grid-cols-2 gap-2">
      <Button
        onClick={() => requireAuth(() => toggleWatch.mutate())}
        disabled={toggleWatch.isPending || watchQuery.isLoading}
        variant={watched ? "outline" : "default"}
        className="rounded-xl shadow-soft"
      >
        {toggleWatch.isPending ? (
          <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
        ) : watched ? (
          <BellOff className="mr-1.5 h-4 w-4" />
        ) : (
          <Bell className="mr-1.5 h-4 w-4" />
        )}
        {watched ? "Sledované" : "Sledovať"}
      </Button>
      <Button
        onClick={() => requireAuth(() => saveReport.mutate())}
        disabled={saveReport.isPending}
        variant="outline"
        className="rounded-xl"
      >
        {saveReport.isPending ? (
          <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
        ) : (
          <Download className="mr-1.5 h-4 w-4" />
        )}
        Uložiť report
      </Button>
    </div>
  );
}
