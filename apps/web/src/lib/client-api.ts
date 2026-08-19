"use client";

import { DEV_API_TOKEN, DEV_AUTH_BYPASS } from "@/lib/dev-auth";

function apiBaseUrl(): string {
  // Empty / "same" / relative → call same origin (Next rewrite proxies to FastAPI).
  // Useful with ngrok: only tunnel port 3000.
  const raw = (process.env.NEXT_PUBLIC_API_URL || "").trim();
  if (!raw || raw === "same" || raw === "/") {
    return "";
  }
  return raw.replace(/\/$/, "");
}

export async function clientApiFetch<T = unknown>(
  path: string,
  token: string | null,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  if (!headers.has("Content-Type") && init.body && !(init.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }
  const authToken = token || (DEV_AUTH_BYPASS ? DEV_API_TOKEN : null);
  if (authToken) {
    headers.set("Authorization", `Bearer ${authToken}`);
  }

  const url = `${apiBaseUrl()}${path.startsWith("/") ? path : `/${path}`}`;
  const response = await fetch(url, { ...init, headers });

  if (!response.ok) {
    let detail = "";
    try {
      const payload = await response.json();
      detail =
        typeof payload?.detail === "string"
          ? payload.detail
          : JSON.stringify(payload?.detail ?? payload);
    } catch {
      detail = await response.text().catch(() => "");
    }
    throw new Error(
      `API request failed (${response.status})${detail ? `: ${detail}` : ""}`,
    );
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

export type Book = {
  id: string;
  title: string;
  author: string;
  locale: string;
  mode: string;
  settings: Record<string, unknown>;
  chapter_count: number;
  my_role?: "owner" | "editor" | "viewer";
};

export type Chapter = {
  id: string;
  book_id: string;
  position: number;
  kind: string;
  number: number | null;
  title: string;
  full_label: string;
  content_text: string;
  content_json: Record<string, unknown>;
};

export type ExportJob = {
  id: string;
  book_id: string;
  format: string;
  status: string;
  download_url?: string | null;
  watermark: boolean;
  error?: string | null;
};
