import { useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useAuth } from "./use-auth";

export function useRequireAuth() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && !user) {
      navigate({ to: "/login" });
    }
  }, [loading, user, navigate]);

  return { user, loading };
}
