"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useToast } from "@/components/ToastProvider";
import { clientApiFetch, isAbortError } from "@/lib/client-api";
import {
  SOCIAL_PLATFORMS,
  type PublicationProfile,
  type PublishQueueJob,
  type SocialAccountConnection,
} from "@/lib/publication";
import { useStableAuth } from "@/lib/use-app-auth";

type Props = {
  bookId: string;
  locale: string;
  canEdit: boolean;
  profile: PublicationProfile;
  onProfileChange: (profile: PublicationProfile) => void;
};

export function SocialIntegrationsPanel({
  bookId,
  locale,
  canEdit,
  profile,
  onProfileChange,
}: Props) {
  const t = useTranslations("studio");
  const toast = useToast();
  const { getTokenRef } = useStableAuth();
  const [accounts, setAccounts] = useState<SocialAccountConnection[]>([]);
  const [queue, setQueue] = useState<PublishQueueJob[]>([]);
  const [busy, setBusy] = useState(false);
  const [draftPlatform, setDraftPlatform] = useState<string>("instagram");
  const [draftText, setDraftText] = useState("");
  const [scheduleAt, setScheduleAt] = useState("");

  const loadAccounts = useCallback(async () => {
    const token = await getTokenRef.current();
    const rows = await clientApiFetch<SocialAccountConnection[]>(
      "/api/v1/social/accounts",
      token,
    );
    setAccounts(rows);
  }, [getTokenRef]);

  const loadQueue = useCallback(async () => {
    const token = await getTokenRef.current();
    const rows = await clientApiFetch<PublishQueueJob[]>(
      `/api/v1/books/${bookId}/publication/publish-queue`,
      token,
    );
    setQueue(rows);
  }, [bookId, getTokenRef]);

  useEffect(() => {
    const ac = new AbortController();
    Promise.all([loadAccounts(), loadQueue()])
      .catch((err) => {
        if (!isAbortError(err) && !ac.signal.aborted) {
          setAccounts([]);
          setQueue([]);
        }
      });
    return () => ac.abort();
  }, [loadAccounts, loadQueue]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const oauth = params.get("social_oauth");
    const platform = params.get("platform");
    if (oauth === "connected" && platform) {
      toast.success(t("publishOAuthConnected", { platform: t(`publishPlatform_${platform}`) }));
      params.delete("social_oauth");
      params.delete("platform");
      const next = `${window.location.pathname}?${params.toString()}`;
      window.history.replaceState({}, "", next.endsWith("?") ? next.slice(0, -1) : next);
      void loadAccounts();
    }
  }, [loadAccounts, t, toast]);

  async function connectPlatform(platform: string) {
    setBusy(true);
    try {
      const token = await getTokenRef.current();
      const returnUrl = `${window.location.origin}/${locale}/books/${bookId}?tab=publish`;
      const start = await clientApiFetch<{
        authorize_url?: string;
        dev_mode?: boolean;
      }>(`/api/v1/social/oauth/${platform}/start?return_url=${encodeURIComponent(returnUrl)}`, token);

      if (start.dev_mode || !start.authorize_url) {
        await clientApiFetch("/api/v1/social/accounts/dev-connect", token, {
          method: "POST",
          body: JSON.stringify({ platform }),
        });
        await loadAccounts();
        toast.success(t("publishOAuthDevConnected", { platform: t(`publishPlatform_${platform}`) }));
        return;
      }
      if (start.authorize_url) {
        window.location.href = start.authorize_url;
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("publishOAuthFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function disconnect(accountId: string) {
    setBusy(true);
    try {
      const token = await getTokenRef.current();
      await clientApiFetch(`/api/v1/social/accounts/${accountId}`, token, {
        method: "DELETE",
      });
      await loadAccounts();
      toast.success(t("publishOAuthDisconnected"));
    } finally {
      setBusy(false);
    }
  }

  async function saveAutoPublish(platform: string, enabled: boolean) {
    const next = profile.social_integrations.map((item) =>
      item.platform === platform ? { ...item, enabled, auto_publish: enabled } : item,
    );
    const token = await getTokenRef.current();
    const updated = await clientApiFetch<PublicationProfile>(
      `/api/v1/books/${bookId}/publication`,
      token,
      { method: "PATCH", body: JSON.stringify({ social_integrations: next }) },
    );
    onProfileChange(updated);
  }

  async function schedulePost(publishNow: boolean) {
    if (!draftText.trim()) return;
    setBusy(true);
    try {
      const token = await getTokenRef.current();
      await clientApiFetch(`/api/v1/books/${bookId}/publication/publish-queue`, token, {
        method: "POST",
        body: JSON.stringify({
          platform: draftPlatform,
          post_text: draftText.trim(),
          scheduled_at: publishNow || !scheduleAt ? null : new Date(scheduleAt).toISOString(),
          publish_now: publishNow,
        }),
      });
      setDraftText("");
      setScheduleAt("");
      await loadQueue();
      toast.success(publishNow ? t("publishPosted") : t("publishScheduled"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("publishScheduleFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function retryJob(jobId: string) {
    setBusy(true);
    try {
      const token = await getTokenRef.current();
      await clientApiFetch(
        `/api/v1/books/${bookId}/publication/publish-queue/${jobId}/publish-now`,
        token,
        { method: "POST" },
      );
      await loadQueue();
    } finally {
      setBusy(false);
    }
  }

  function accountFor(platform: string) {
    return accounts.find((item) => item.platform === platform);
  }

  return (
    <div className="publish-section">
      <header className="publish-section-head">
        <h2>{t("publishIntegrationsTitle")}</h2>
        <p className="muted">{t("publishIntegrationsLead")}</p>
      </header>

      <ul className="publish-integration-list">
        {SOCIAL_PLATFORMS.map((platform) => {
          const account = accountFor(platform);
          const integration = profile.social_integrations.find((i) => i.platform === platform);
          const connected = Boolean(account?.connected);
          return (
            <li key={platform} className="publish-integration-item" data-connected={connected}>
              <div className="publish-integration-main">
                <strong>{t(`publishPlatform_${platform}`)}</strong>
                <p className="muted">
                  {connected
                    ? account?.account_label || t("publishOAuthConnectedShort")
                    : t("publishOAuthDisconnectedShort")}
                  {account?.dev ? ` · ${t("publishDevMode")}` : null}
                </p>
              </div>
              <div className="publish-integration-actions">
                {canEdit ? (
                  connected ? (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      disabled={busy}
                      onClick={() => void disconnect(account!.id)}
                    >
                      {t("publishDisconnect")}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      disabled={busy}
                      onClick={() => void connectPlatform(platform)}
                    >
                      {t("publishConnect")}
                    </button>
                  )
                ) : null}
                <label className="publish-toggle">
                  <input
                    type="checkbox"
                    checked={Boolean(integration?.auto_publish)}
                    disabled={!canEdit || !connected || busy}
                    onChange={(e) => void saveAutoPublish(platform, e.target.checked)}
                  />
                  <span>{t("publishAutoPublish")}</span>
                </label>
              </div>
            </li>
          );
        })}
      </ul>

      <section className="publish-queue-section">
        <h3 className="publish-subtitle">{t("publishQueueTitle")}</h3>
        <p className="muted">{t("publishQueueLead")}</p>

        {canEdit ? (
          <div className="publish-queue-form">
            <label className="field-block">
              <span className="field-label">{t("publishQueuePlatform")}</span>
              <select
                value={draftPlatform}
                onChange={(e) => setDraftPlatform(e.target.value)}
                disabled={busy}
              >
                {SOCIAL_PLATFORMS.map((platform) => (
                  <option key={platform} value={platform}>
                    {t(`publishPlatform_${platform}`)}
                  </option>
                ))}
              </select>
            </label>
            <label className="field-block">
              <span className="field-label">{t("publishQueueText")}</span>
              <textarea
                rows={3}
                value={draftText}
                onChange={(e) => setDraftText(e.target.value)}
                disabled={busy}
              />
            </label>
            <label className="field-block">
              <span className="field-label">{t("publishQueueSchedule")}</span>
              <input
                type="datetime-local"
                value={scheduleAt}
                onChange={(e) => setScheduleAt(e.target.value)}
                disabled={busy}
              />
            </label>
            <div className="publish-generate-row">
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={busy || !draftText.trim()}
                onClick={() => void schedulePost(true)}
              >
                {t("publishPostNow")}
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={busy || !draftText.trim() || !scheduleAt}
                onClick={() => void schedulePost(false)}
              >
                {t("publishSchedulePost")}
              </button>
            </div>
          </div>
        ) : null}

        {queue.length === 0 ? (
          <p className="muted">{t("publishQueueEmpty")}</p>
        ) : (
          <ul className="publish-queue-list">
            {queue.map((job) => (
              <li key={job.id} className="publish-queue-item" data-status={job.status}>
                <div>
                  <strong>{t(`publishPlatform_${job.platform}`)}</strong>
                  <span className="review-status-pill" data-status={job.status}>
                    {t(`publishJobStatus_${job.status}`)}
                  </span>
                  <p className="muted">{job.post_text}</p>
                  {job.error ? <p className="publish-queue-error">{job.error}</p> : null}
                </div>
                {canEdit && job.status === "failed" ? (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    disabled={busy}
                    onClick={() => void retryJob(job.id)}
                  >
                    {t("publishRetry")}
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
