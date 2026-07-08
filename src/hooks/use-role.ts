import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";

export type AppRole = "admin" | "user";

export function useRole() {
  const { user, loading: authLoading } = useAuth();

  const query = useQuery({
    queryKey: ["user-role", user?.id],
    enabled: !!user,
    staleTime: 60_000,
    queryFn: async (): Promise<AppRole> => {
      const { data, error } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user!.id);
      if (error) throw error;
      const roles = (data ?? []).map((r) => r.role as AppRole);
      return roles.includes("admin") ? "admin" : "user";
    },
  });

  const role: AppRole = query.data ?? "user";
  return {
    role,
    isAdmin: role === "admin",
    isUser: role === "user",
    loading: authLoading || query.isLoading,
  };
}
