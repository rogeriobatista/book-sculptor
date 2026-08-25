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
      return rows;
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

  // Refresh while exports are in flight or parent reports busy.
  useEffect(() => {
    const pending = busy || exports.some((job) => job.status === "queued" || job.status === "processing");
    if (!pending) return;
    const id = window.setInterval(() => {
      void load().catch(() => undefined);
    }, 2500);
    return () => window.clearInterval(id);
  }, [busy, exports, load]);

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

  const latestReady = exports.find((job) => job.status === "ready");

  return (
    <div className="publish-section">
      <header className="publish-section-head">
        <h2>{t("publishExportsTitle")}</h2>
        <p className="muted">{t("publishExportsLead")}</p>
      </header>

      <section className="settings-card">
        <div className="settings-card__head">
          <h3 className="settings-card__title">{t("publishExportCreateTitle")}</h3>
          <p className="settings-card__lead">{t("publishExportCreateLead")}</p>
        </div>
        <ExportActions
          variant="cards"
          busy={busy}
          disabled={!canExport}
          onExport={onExport}
        />
        {!canExport ? <p className="muted publish-field-hint">{t("publishExportUpgrade")}</p> : null}
      </section>

      <section className="settings-card">
        <div className="publish-field-head">
          <div className="settings-card__head">
            <h3 className="settings-card__title">{t("publishExportHistory")}</h3>
            <p className="settings-card__lead">{t("publishExportHistoryLead")}</p>
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-compact"
            onClick={() => void load()}
          >
            {t("publishExportRefresh")}
          </button>
        </div>

        {loading ? (
          <p className="muted">{t("publishLoading")}</p>
        ) : exports.length === 0 ? (
          <p className="muted">{t("publishExportEmpty")}</p>
        ) : (
          <ul className="publish-export-list">
            {exports.map((job) => (
              <li key={job.id} className="publish-export-item" data-status={job.status}>
                <div className="publish-export-copy">
                  <div className="publish-export-title-row">
                    <strong>{job.format.toUpperCase()}</strong>
                    <span className="publish-export-status" data-status={job.status}>
                      {["queued", "processing", "ready", "failed"].includes(job.status)
                        ? t(`publishExportStatus_${job.status}` as "publishExportStatus_ready")
                        : job.status}
                    </span>
                    {job.watermark ? (
                      <span className="publish-watermark-badge">{t("publishWatermark")}</span>
                    ) : null}
                    {latestReady?.id === job.id ? (
                      <span className="publish-export-latest">{t("publishExportLatest")}</span>
                    ) : null}
                  </div>
                  {job.error ? <p className="muted">{job.error}</p> : null}
                </div>
                {job.status === "ready" && job.download_url ? (
                  <button
                    type="button"
                    className="btn btn-ghost btn-compact"
                    onClick={() => void downloadExport(job)}
                  >
                    {t("publishDownload")}
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
