"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import {
  type ExportJob,
  clientApiDownload,
  clientApiFetch,
  isAbortError,
  isProtectedFileUrl,
} from "@/lib/client-api";
import { ExportActions, type ExportFormat } from "@/components/ExportActions";
import { useStableAuth } from "@/lib/use-app-auth";

type Props = {
  bookId: string;
  canExport: boolean;
  busy?: boolean;
  onExport: (format: ExportFormat) => void;
};

export function PublicationExportsPanel({
  bookId,
  canExport,
  busy = false,
  onExport,
}: Props) {
  const t = useTranslations("studio");
  const { getTokenRef } = useStableAuth();
  const [exports, setExports] = useState<ExportJob[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      const token = await getTokenRef.current();
      const rows = await clientApiFetch<ExportJob[]>(
        `/api/v1/books/${bookId}/exports`,
        token,
        signal ? { signal } : {},
      );
      if (!signal?.aborted) setExports(rows);
    },
    [bookId, getTokenRef],
  );

  useEffect(() => {
    const ac = new AbortController();
    setLoading(true);
    load(ac.signal)
      .catch((err) => {
        if (!isAbortError(err) && !ac.signal.aborted) setExports([]);
      })
      .finally(() => {
        if (!ac.signal.aborted) setLoading(false);
      });
    return () => ac.abort();
  }, [load]);

  async function downloadExport(job: ExportJob) {
    if (!job.download_url || job.status !== "ready") return;
    const token = await getTokenRef.current();
    const filename = `book.${job.format}`;
    if (isProtectedFileUrl(job.download_url)) {
      await clientApiDownload(job.download_url, token, filename);
    } else {
      window.open(job.download_url, "_blank", "noopener,noreferrer");
    }
  }

  return (
    <div className="publish-section">
      <header className="publish-section-head">
        <h2>{t("publishExportsTitle")}</h2>
        <p className="muted">{t("publishExportsLead")}</p>
      </header>

      <ExportActions
        variant="cards"
        busy={busy}
        disabled={!canExport}
        onExport={onExport}
      />

      <h3 className="publish-subtitle">{t("publishExportHistory")}</h3>
      {loading ? (
        <p className="muted">{t("publishLoading")}</p>
      ) : exports.length === 0 ? (
        <p className="muted">{t("publishExportEmpty")}</p>
      ) : (
        <ul className="publish-export-list">
          {exports.map((job) => (
            <li key={job.id} className="publish-export-item" data-status={job.status}>
              <div>
                <strong>{job.format.toUpperCase()}</strong>
                <span className="muted"> · {job.status}</span>
                {job.watermark ? (
                  <span className="publish-watermark-badge">{t("publishWatermark")}</span>
                ) : null}
              </div>
              {job.status === "ready" && job.download_url ? (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => void downloadExport(job)}
                >
                  {t("publishDownload")}
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
