"use client";

import { useCallback, useEffect, useState } from "react";
import { clientApiFetch } from "@/lib/client-api";
import type { AiQuota } from "@/lib/use-ai-quota";
import { useAppAuth } from "@/lib/use-app-auth";

export type AiUsageBreakdown = {
  category: string;
  tokens: number;
  jobs: number;
  percent: number;
};

export type AiUsageDaily = {
  date: string;
  tokens: number;
};

export type AiUsageRecent = {
  id: string;
  category: string;
  action: string | null;
  tokens_used: number;
  input_tokens: number;
  output_tokens: number;
  status: string;
  created_at: string;
  book_id: string;
};

export type AiUsageDashboard = {
  quota: AiQuota;
  tokens: { input: number; output: number; total: number };
  breakdown: AiUsageBreakdown[];
  daily: AiUsageDaily[];
  recent: AiUsageRecent[];
  projection: {
    daily_average: number;
    projected_month_end: number;
    days_until_reset: number;
    pace: "on_track" | "heavy" | "over" | "unavailable";
  };
  context: {
    budget_chars: number;
    estimated_tokens_per_request: number;
    use_prior_chapters: boolean;
    prior_chapter_count: number;
  };
  plan: {
    id: string;
    model: string;
    monthly_tokens: number;
  };
  book?: {
    book_id: string;
    tokens: number;
    jobs: number;
    percent_of_month: number;
  };
};

export function useAiUsage(bookId: string | null, enabled = true) {
  const { getToken, isLoaded, isSignedIn } = useAppAuth();
  const [data, setData] = useState<AiUsageDashboard | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    if (!isLoaded) {
      setLoading(true);
      return;
    }
    if (!isSignedIn) {
      setLoading(false);
      setData(null);
      setError("not_signed_in");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const token = await getToken();
      const query = new URLSearchParams({ dashboard: "1" });
      if (bookId) query.set("book_id", bookId);
      let payload: AiUsageDashboard;
      try {
        payload = await clientApiFetch<AiUsageDashboard>(
          `/api/v1/ai/usage?${query.toString()}`,
          token,
        );
      } catch (usageErr) {
        const message =
          usageErr instanceof Error ? usageErr.message : String(usageErr);
        if (!message.includes("(404)")) {
          throw usageErr;
        }
        payload = await clientApiFetch<AiUsageDashboard>(
          `/api/v1/ai/quota?${query.toString()}`,
          token,
        );
      }
      setData(payload);
    } catch (err) {
      setData(null);
      setError(err instanceof Error ? err.message : "load_failed");
    } finally {
      setLoading(false);
    }
  }, [bookId, enabled, getToken, isLoaded, isSignedIn]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { data, loading, error, refresh };
}
