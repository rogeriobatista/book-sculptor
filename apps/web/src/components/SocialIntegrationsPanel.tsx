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

type IntegrationsTab = "accounts" | "queue";

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
  const [tab, setTab] = useState<IntegrationsTab>("accounts");
  const [activePlatform, setActivePlatform] = useState<string>("instagram");

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
    Promise.all([loadAccounts(), loadQueue()]).catch((err) => {
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
      toast.success(
        t("publishOAuthConnected", { platform: t(`publishPlatform_${platform}`) }),
      );
      params.delete("social_oauth");
      params.delete("platform");
      const next = `${window.location.pathname}?${params.toString()}`;
      window.history.replaceState({}, "", next.endsWith("?") ? next.slice(0, -1) : next);
      setTab("accounts");
      setActivePlatform(platform);
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
      }>(
        `/api/v1/social/oauth/${platform}/start?return_url=${encodeURIComponent(returnUrl)}`,
        token,
      );

      if (start.dev_mode || !start.authorize_url) {
        await clientApiFetch("/api/v1/social/accounts/dev-connect", token, {
          method: "POST",
          body: JSON.stringify({ platform }),
        });
        await loadAccounts();
        toast.success(
          t("publishOAuthDevConnected", {
            platform: t(`publishPlatform_${platform}`),
          }),
        );
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

  const connectedCount = SOCIAL_PLATFORMS.filter(
    (platform) => accountFor(platform)?.connected,
  ).length;
  const activeAccount = accountFor(activePlatform);
  const activeIntegration = profile.social_integrations.find(
    (item) => item.platform === activePlatform,
  );
  const connected = Boolean(activeAccount?.connected);

  return (
    <div className="publish-section publish-section--tabbed">
      <header className="publish-section-head">
        <h2>{t("publishIntegrationsTitle")}</h2>
        <p className="muted">{t("publishIntegrationsLead")}</p>
      </header>

      <div className="publish-subnav" role="tablist" aria-label={t("publishIntegrationsSubnav")}>
        <button
          type="button"
          role="tab"
          className="publish-subnav-tab"
          aria-selected={tab === "accounts"}
          data-active={tab === "accounts"}
          data-filled={connectedCount > 0}
          onClick={() => setTab("accounts")}
        >
          {t("publishIntegrationsTab_accounts")}
        </button>
        <button
          type="button"
          role="tab"
          className="publish-subnav-tab"
          aria-selected={tab === "queue"}
          data-active={tab === "queue"}
          data-filled={queue.length > 0}
          onClick={() => setTab("queue")}
        >
          {t("publishIntegrationsTab_queue")}
          {queue.length > 0 ? (
            <span className="publish-subnav-count">{queue.length}</span>
          ) : null}
        </button>
      </div>

      {tab === "accounts" ? (
        <>
          <div
            className="publish-subnav publish-subnav--secondary"
            role="tablist"
            aria-label={t("publishAccountsSubnav")}
          >
            {SOCIAL_PLATFORMS.map((platform) => (
              <button
                key={platform}
                type="button"
                role="tab"
                className="publish-subnav-tab"
                aria-selected={activePlatform === platform}
                data-active={activePlatform === platform}
                data-filled={Boolean(accountFor(platform)?.connected)}
                onClick={() => setActivePlatform(platform)}
              >
                {t(`publishPlatform_${platform}`)}
              </button>
            ))}
          </div>

          <section className="settings-card publish-tab-panel" role="tabpanel">
            <div className="publish-field-head">
              <div className="settings-card__head">
                <h3 className="settings-card__title">
                  {t(`publishPlatform_${activePlatform}`)}
                </h3>
                <p className="settings-card__lead">
                  {connected
                    ? activeAccount?.account_label || t("publishOAuthConnectedShort")
                    : t("publishOAuthDisconnectedShort")}
                  {activeAccount?.dev ? ` · ${t("publishDevMode")}` : null}
                </p>
              </div>
              <span
                className="publish-store-status-pill"
                data-status={connected ? "published" : "not_started"}
              >
                {connected
                  ? t("publishOAuthConnectedShort")
                  : t("publishOAuthDisconnectedShort")}
              </span>
            </div>

            <div className="publish-integration-actions publish-integration-actions--panel">
              {canEdit ? (
                connected ? (
                  <button
                    type="button"
                    className="btn btn-ghost btn-compact"
                    disabled={busy}
                    onClick={() => void disconnect(activeAccount!.id)}
                  >
                    {t("publishDisconnect")}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn btn-primary btn-compact"
                    disabled={busy}
                    onClick={() => void connectPlatform(activePlatform)}
                  >
                    {t("publishConnect")}
                  </button>
                )
              ) : null}
              <label className="publish-toggle">
                <input
                  type="checkbox"
                  checked={Boolean(activeIntegration?.auto_publish)}
                  disabled={!canEdit || !connected || busy}
                  onChange={(e) => void saveAutoPublish(activePlatform, e.target.checked)}
                />
                <span>{t("publishAutoPublish")}</span>
              </label>
            </div>

            <p className="muted publish-field-hint">
              {t("publishAccountsConnectedHint", {
                connected: connectedCount,
                total: SOCIAL_PLATFORMS.length,
              })}
            </p>
          </section>
        </>
      ) : (
        <section className="settings-card publish-tab-panel" role="tabpanel">
          <div className="settings-card__head">
            <h3 className="settings-card__title">{t("publishQueueTitle")}</h3>
            <p className="settings-card__lead">{t("publishQueueLead")}</p>
          </div>

          {canEdit ? (
            <div className="publish-queue-form">
              <label className="team-field">
                <span>{t("publishQueuePlatform")}</span>
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
              <label className="team-field">
                <span>{t("publishQueueText")}</span>
                <textarea
                  rows={4}
                  value={draftText}
                  onChange={(e) => setDraftText(e.target.value)}
                  disabled={busy}
                />
              </label>
              <label className="team-field">
                <span>{t("publishQueueSchedule")}</span>
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
                  className="btn btn-primary btn-compact"
                  disabled={busy || !draftText.trim()}
                  onClick={() => void schedulePost(true)}
                >
                  {t("publishPostNow")}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-compact"
                  disabled={busy || !draftText.trim() || !scheduleAt}
                  onClick={() => void schedulePost(false)}
                >
                  {t("publishSchedulePost")}
                </button>
              </div>
            </div>
          ) : null}

          <h4 className="publish-queue-list-title">{t("publishQueueHistory")}</h4>
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
                      className="btn btn-ghost btn-compact"
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
      )}
    </div>
  );
}
