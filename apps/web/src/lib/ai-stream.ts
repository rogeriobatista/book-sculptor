"use client";

import { DEV_API_TOKEN, DEV_AUTH_BYPASS } from "@/lib/dev-auth";

function apiBaseUrl(): string {
  const raw = (process.env.NEXT_PUBLIC_API_URL || "").trim();
  if (!raw || raw === "same" || raw === "/") {
    return "";
  }
  return raw.replace(/\/$/, "");
}

export type AiStreamEvent =
  | { type: "start"; job_id: string }
  | { type: "delta"; text: string }
  | { type: "done"; job_id: string; tokens_used: number; text: string }
  | { type: "error"; job_id?: string; error: string };

export async function streamAiChapter(
  token: string | null,
  body: {
    book_id: string;
    chapter_id?: string | null;
    action: string;
    prompt?: string;
    selection?: string;
  },
  onEvent: (event: AiStreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const authToken = token || (DEV_AUTH_BYPASS ? DEV_API_TOKEN : null);
  const headers: HeadersInit = {
    "Content-Type": "application/json",
  };
  if (authToken) {
    headers.Authorization = `Bearer ${authToken}`;
  }

  const response = await fetch(`${apiBaseUrl()}/api/v1/ai/chapter/stream`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal,
  });

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

  if (!response.body) {
    throw new Error("Streaming is not supported in this browser.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split("\n\n");
    buffer = chunks.pop() || "";
    for (const chunk of chunks) {
      const line = chunk
        .split("\n")
        .map((part) => part.trim())
        .find((part) => part.startsWith("data:"));
      if (!line) continue;
      const raw = line.slice(5).trim();
      if (!raw) continue;
      try {
        onEvent(JSON.parse(raw) as AiStreamEvent);
      } catch {
        // ignore malformed chunks
      }
    }
  }
}
