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

export function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

/** Local API file URLs require Bearer auth (img/window.open cannot send it). */
export function isProtectedFileUrl(url: string): boolean {
  return url.startsWith("/api/v1/files/");
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
  let response: Response;
  try {
    response = await fetch(url, { ...init, headers });
  } catch (err) {
    if (isAbortError(err)) throw err;
    throw err;
  }

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

/** Fetch a protected file and return an object URL (revoke when done). */
export async function clientApiBlobUrl(
  path: string,
  token: string | null,
  init: RequestInit = {},
): Promise<string> {
  const headers = new Headers(init.headers);
  const authToken = token || (DEV_AUTH_BYPASS ? DEV_API_TOKEN : null);
  if (authToken) {
    headers.set("Authorization", `Bearer ${authToken}`);
  }
  const url = path.startsWith("http")
    ? path
    : `${apiBaseUrl()}${path.startsWith("/") ? path : `/${path}`}`;
  const response = await fetch(url, { ...init, headers });
  if (!response.ok) {
    throw new Error(`File request failed (${response.status})`);
  }
  const blob = await response.blob();
  return URL.createObjectURL(blob);
}

/** Download via authenticated fetch (for `/api/v1/files/...` URLs). */
export async function clientApiDownload(
  pathOrUrl: string,
  token: string | null,
  filename: string,
): Promise<void> {
  const path = pathOrUrl.startsWith("http")
    ? new URL(pathOrUrl).pathname
    : pathOrUrl;
  const blobUrl = await clientApiBlobUrl(path, token);
  const anchor = document.createElement("a");
  anchor.href = blobUrl;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(blobUrl);
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
  cover_url?: string | null;
  cover_source?: string | null;
  cover_prompt?: string | null;
};

export type Chapter = {
  id: string;
  book_id: string;
  parent_id: string | null;
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
