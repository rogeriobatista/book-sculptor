"use client";

import { useCallback, useEffect, useState } from "react";
import { clientApiFetch } from "@/lib/client-api";
import { useAppAuth } from "@/lib/use-app-auth";

export type AiQuota = {
  plan: string;
  used: number;
  limit: number;
  remaining: number;
  percent_used: number;
  allowed: boolean;
  resets_at: string;
  warning: boolean;
  exceeded: boolean;
};

const EMPTY_QUOTA: AiQuota = {
  plan: "free",
  used: 0,
  limit: 0,
  remaining: 0,
  percent_used: 0,
  allowed: false,
  resets_at: "",
  warning: false,
  exceeded: false,
};

export function useAiQuota(enabled = true) {
  const { getToken, isLoaded, isSignedIn } = useAppAuth();
  const [quota, setQuota] = useState<AiQuota>(EMPTY_QUOTA);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!enabled || !isLoaded || !isSignedIn) return;
    setLoading(true);
    try {
      const token = await getToken();
      const data = await clientApiFetch<AiQuota>("/api/v1/ai/quota", token);
      setQuota(data);
    } catch {
      // Keep last known quota on transient errors.
    } finally {
      setLoading(false);
    }
  }, [enabled, getToken, isLoaded, isSignedIn]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const applyQuota = useCallback((next: Partial<AiQuota>) => {
    setQuota((prev) => ({ ...prev, ...next }));
  }, []);

  return { quota, loading, refresh, applyQuota };
}
