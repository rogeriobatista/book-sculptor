"use client";

import { FormEvent, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { ExportActions, type ExportFormat } from "@/components/ExportActions";
import { type Book, clientApiFetch } from "@/lib/client-api";
import { useAppAuth } from "@/lib/use-app-auth";
import { useToast } from "@/components/ToastProvider";

type LayoutOptions = {
  formats?: { id: string; label: string }[];
  fonts?: { id: string; label: string }[];
  styles?: { id: string; label: string; description?: string }[];
  densities?: { id: string; label: string }[];
  page_numbers?: { id: string; label: string }[];
};

type Props = {
  book: Book;
  onSaved: (book: Book) => void;
  busy?: boolean;
  canExport?: boolean;
  onExport?: (format: ExportFormat) => void;
};

export function FormatPanel({
  book,
  onSaved,
  busy: exportBusy = false,
  canExport = false,
  onExport,
}: Props) {
  const { getToken } = useAppAuth();
  const toast = useToast();
  const t = useTranslations("studio");
  const common = useTranslations("common");
  const [options, setOptions] = useState<LayoutOptions | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = await getToken();
        const data = await clientApiFetch<LayoutOptions>(
          "/api/v1/books/options",
          token,
        );
        if (!cancelled) setOptions(data);
      } catch {
        if (!cancelled) setOptions(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [getToken]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    const loadingId = toast.loading(t("notifySaving"));
    try {
      const token = await getToken();
      const updated = await clientApiFetch<Book>(`/api/v1/books/${book.id}`, token, {
        method: "PATCH",
        body: JSON.stringify({
          title: book.title,
          author: book.author,
          locale: book.locale,
          settings: {
            ...(book.settings || {}),
            style_id: String(form.get("style_id") || "prosa_literaria"),
            format_id: String(form.get("format_id") || "medio"),
            font_id: String(form.get("font_id") || "garamond"),
            font_size: Number(form.get("font_size") || 11),
            density: String(form.get("density") || "padrao"),
            page_number: String(form.get("page_number") || "externo"),
            include_toc: form.get("include_toc") === "on",
          },
        }),
      });
      onSaved(updated);
      toast.update(loadingId, { tone: "success", title: t("notifySaved") });
    } catch (err) {
      toast.update(loadingId, {
        tone: "error",
        title: t("notifySaveFailed"),
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setBusy(false);
    }
  }

  const settings = book.settings || {};

  return (
    <div className="format-panel">
      <header className="format-panel-head">
        <h2>{t("formatTitle")}</h2>
        <p className="muted">{t("formatLead")}</p>
      </header>

      <form className="format-grid" onSubmit={onSubmit}>
        <label>
          {t("formatStyle")}
          <select
            name="style_id"
            defaultValue={String(settings.style_id || "prosa_literaria")}
          >
            {(options?.styles || [
              { id: "prosa_literaria", label: "Prosa literária" },
              { id: "editorial", label: "Editorial" },
              { id: "compacto_digital", label: "Compacto digital" },
            ]).map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>

        <label>
          {t("formatSize")}
          <select
            name="format_id"
            defaultValue={String(settings.format_id || "medio")}
          >
            {(options?.formats || [
              { id: "medio", label: "Médio 14×21" },
              { id: "padrao", label: "Padrão 15,5×23" },
              { id: "bolso", label: "Bolso" },
              { id: "tecnico", label: "A4" },
            ]).map((item) => (
              <option key={item.id} value={item.id}>
                {item.label.replace(/\n/g, " · ")}
              </option>
            ))}
          </select>
        </label>

        <label>
          {t("formatFont")}
          <select name="font_id" defaultValue={String(settings.font_id || "garamond")}>
            {(options?.fonts || [
              { id: "garamond", label: "Garamond" },
              { id: "georgia", label: "Georgia" },
              { id: "literata", label: "Literata" },
              { id: "baskerville", label: "Baskerville" },
            ]).map((item) => (
              <option key={item.id} value={item.id}>
                {item.label.replace(/\n/g, " · ")}
              </option>
            ))}
          </select>
        </label>

        <label>
          {t("formatFontSize")}
          <input
            name="font_size"
            type="number"
            min={10}
            max={14}
            defaultValue={Number(settings.font_size || 11)}
          />
        </label>

        <label>
          {t("formatDensity")}
          <select name="density" defaultValue={String(settings.density || "padrao")}>
            {(options?.densities || [
              { id: "compacto", label: "Compacto" },
              { id: "padrao", label: "Padrão" },
              { id: "espacoso", label: "Espaçoso" },
            ]).map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>

        <label>
          {t("formatPageNumbers")}
          <select
            name="page_number"
            defaultValue={String(settings.page_number || "externo")}
          >
            {(options?.page_numbers || [
              { id: "externo", label: "Externo" },
              { id: "centro", label: "Centro" },
              { id: "sem", label: "Sem" },
            ]).map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>

        <label className="format-check">
          <input
            name="include_toc"
            type="checkbox"
            defaultChecked={settings.include_toc !== false}
          />
          {t("formatToc")}
        </label>

        <button type="submit" className="btn btn-primary" disabled={busy}>
          {common("save")}
        </button>
      </form>

      {onExport ? (
        <ExportActions
          variant="cards"
          busy={exportBusy || busy}
          disabled={!canExport}
          onExport={onExport}
        />
      ) : null}
    </div>
  );
}
