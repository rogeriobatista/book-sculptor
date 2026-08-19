"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type ToastTone = "success" | "error" | "info" | "loading";

export type ToastItem = {
  id: string;
  tone: ToastTone;
  title: string;
  description?: string;
  durationMs?: number;
};

type ToastInput = {
  tone: ToastTone;
  title: string;
  description?: string;
  durationMs?: number;
  id?: string;
};

type ToastApi = {
  push: (input: ToastInput) => string;
  dismiss: (id: string) => void;
  success: (title: string, description?: string) => string;
  error: (title: string, description?: string) => string;
  info: (title: string, description?: string) => string;
  loading: (title: string, description?: string) => string;
  update: (id: string, input: Partial<Omit<ToastInput, "id">>) => void;
};

const ToastContext = createContext<ToastApi | null>(null);

function uid() {
  return `toast_${Math.random().toString(36).slice(2, 10)}`;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: string) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const push = useCallback(
    (input: ToastInput) => {
      const id = input.id || uid();
      const durationMs =
        input.durationMs ??
        (input.tone === "loading"
          ? 0
          : input.tone === "error"
            ? 7000
            : 4200);
      setItems((prev) => {
        const next = prev.filter((item) => item.id !== id);
        return [
          ...next,
          {
            id,
            tone: input.tone,
            title: input.title,
            description: input.description,
            durationMs,
          },
        ];
      });
      if (durationMs > 0) {
        window.setTimeout(() => dismiss(id), durationMs);
      }
      return id;
    },
    [dismiss],
  );

  const update = useCallback(
    (id: string, input: Partial<Omit<ToastInput, "id">>) => {
      setItems((prev) => {
        const existing = prev.find((item) => item.id === id);
        if (!existing) return prev;
        return prev.map((item) =>
          item.id === id
            ? {
                ...item,
                tone: input.tone ?? item.tone,
                title: input.title ?? item.title,
                description:
                  input.description !== undefined
                    ? input.description
                    : item.description,
                durationMs: input.durationMs ?? item.durationMs,
              }
            : item,
        );
      });
      const tone = input.tone;
      if (!tone || tone === "loading") return;
      const durationMs = input.durationMs ?? (tone === "error" ? 7000 : 4200);
      if (durationMs > 0) {
        window.setTimeout(() => dismiss(id), durationMs);
      }
    },
    [dismiss],
  );

  const api = useMemo<ToastApi>(
    () => ({
      push,
      dismiss,
      update,
      success: (title, description) =>
        push({ tone: "success", title, description }),
      error: (title, description) =>
        push({ tone: "error", title, description }),
      info: (title, description) => push({ tone: "info", title, description }),
      loading: (title, description) =>
        push({ tone: "loading", title, description, durationMs: 0 }),
    }),
    [push, dismiss, update],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toast-viewport" aria-live="polite" aria-relevant="additions">
        {items.map((item) => (
          <div
            key={item.id}
            className="toast"
            data-tone={item.tone}
            role={item.tone === "error" ? "alert" : "status"}
          >
            <div className="toast-icon" aria-hidden>
              {item.tone === "loading" ? (
                <span className="toast-spinner" />
              ) : item.tone === "success" ? (
                "✓"
              ) : item.tone === "error" ? (
                "!"
              ) : (
                "i"
              )}
            </div>
            <div className="toast-body">
              <p className="toast-title">{item.title}</p>
              {item.description ? (
                <p className="toast-desc">{item.description}</p>
              ) : null}
            </div>
            {item.tone !== "loading" ? (
              <button
                type="button"
                className="toast-close"
                aria-label="Close"
                onClick={() => dismiss(item.id)}
              >
                ×
              </button>
            ) : null}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used within ToastProvider");
  }
  return ctx;
}
