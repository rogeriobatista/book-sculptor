"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/navigation";
import { useToast } from "@/components/ToastProvider";
import { clientApiFetch, isAbortError } from "@/lib/client-api";
import { useStableAuth } from "@/lib/use-app-auth";

type TeamRole = "owner" | "editor" | "viewer";

type Member = {
  id: string;
  user_id: string;
  email: string;
  display_name: string;
  role: TeamRole | string;
  created_at: string;
  is_you: boolean;
};

type TeamSummary = {
  total: number;
  editors: number;
  viewers: number;
  seats_used: number;
  seats_limit: number;
};

type TeamPayload = {
  members: Member[];
  summary: TeamSummary;
  my_role: TeamRole | string;
  is_owner?: boolean;
  can_manage: boolean;
};

type Props = {
  bookId: string;
  isStudio: boolean;
  bookTitle?: string;
};

function initials(name: string, email: string): string {
  const source = (name || email || "?").trim();
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0]![0] ?? ""}${parts[1]![0] ?? ""}`.toUpperCase();
  }
  const local = source.includes("@") ? source.split("@")[0]! : source;
  return local.slice(0, 2).toUpperCase() || "?";
}

function roleTone(role: string): "owner" | "editor" | "viewer" {
  if (role === "owner") return "owner";
  if (role === "editor") return "editor";
  return "viewer";
}

export function TeamPanel({ bookId, isStudio, bookTitle }: Props) {
  const t = useTranslations("studio");
  const format = useFormatter();
  const toast = useToast();
  const router = useRouter();
  const { getTokenRef } = useStableAuth();

  const [members, setMembers] = useState<Member[]>([]);
  const [summary, setSummary] = useState<TeamSummary | null>(null);
  const [myRole, setMyRole] = useState<string>("viewer");
  const [isOwner, setIsOwner] = useState(false);
  const [canManage, setCanManage] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"editor" | "viewer">("editor");
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const applyPayload = useCallback((payload: TeamPayload) => {
    setMembers(payload.members);
    setSummary(payload.summary);
    setMyRole(payload.my_role);
    setIsOwner(Boolean(payload.is_owner ?? payload.my_role === "owner"));
    setCanManage(payload.can_manage);
  }, []);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      const token = await getTokenRef.current();
      return clientApiFetch<TeamPayload>(`/api/v1/books/${bookId}/members`, token, {
        signal,
      });
    },
    [bookId, getTokenRef],
  );

  useEffect(() => {
    const ac = new AbortController();
    setLoading(true);
    setError(null);
    load(ac.signal)
      .then((payload) => {
        if (!ac.signal.aborted) applyPayload(payload);
      })
      .catch((err) => {
        if (!isAbortError(err) && !ac.signal.aborted) {
          setError(err instanceof Error ? err.message : t("teamLoadFailed"));
        }
      })
      .finally(() => {
        if (!ac.signal.aborted) setLoading(false);
      });
    return () => ac.abort();
  }, [applyPayload, load, t]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return members;
    return members.filter(
      (m) =>
        m.email.toLowerCase().includes(q) ||
        m.display_name.toLowerCase().includes(q) ||
        m.role.toLowerCase().includes(q),
    );
  }, [members, query]);

  const seatsNearLimit =
    summary != null && summary.seats_used >= Math.max(1, summary.seats_limit - 1);
  const seatsFull = summary != null && summary.seats_used >= summary.seats_limit;

  async function refresh() {
    const payload = await load();
    applyPayload(payload);
  }

  async function invite(event: FormEvent) {
    event.preventDefault();
    if (!isStudio || !canManage) {
      setError(t("teamUpgrade"));
      return;
    }
    setBusy(true);
    setError(null);
    const loadingId = toast.loading(t("teamInviting"));
    try {
      const token = await getTokenRef.current();
      await clientApiFetch(`/api/v1/books/${bookId}/members`, token, {
        method: "POST",
        body: JSON.stringify({ email: email.trim(), role }),
      });
      setEmail("");
      await refresh();
      toast.update(loadingId, { tone: "success", title: t("teamInviteSuccess") });
    } catch (err) {
      const message = err instanceof Error ? err.message : t("teamInviteFailed");
      setError(message);
      toast.update(loadingId, { tone: "error", title: t("teamInviteFailed") });
    } finally {
      setBusy(false);
    }
  }

  async function changeRole(memberId: string, nextRole: "editor" | "viewer") {
    if (!canManage) return;
    setBusy(true);
    setError(null);
    try {
      const token = await getTokenRef.current();
      await clientApiFetch(`/api/v1/books/${bookId}/members/${memberId}`, token, {
        method: "PATCH",
        body: JSON.stringify({ role: nextRole }),
      });
      await refresh();
      toast.success(t("teamRoleUpdated"));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("teamRoleFailed"));
      toast.error(t("teamRoleFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function remove(member: Member) {
    if (!isOwner) return;
    const ok = window.confirm(t("teamRemoveConfirm", { email: member.email }));
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      const token = await getTokenRef.current();
      await clientApiFetch(`/api/v1/books/${bookId}/members/${member.id}`, token, {
        method: "DELETE",
      });
      await refresh();
      toast.success(t("teamRemoveSuccess"));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("teamRemoveFailed"));
      toast.error(t("teamRemoveFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function leave() {
    const ok = window.confirm(t("teamLeaveConfirm"));
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      const token = await getTokenRef.current();
      await clientApiFetch(`/api/v1/books/${bookId}/members/leave`, token, {
        method: "POST",
      });
      toast.success(t("teamLeaveSuccess"));
      router.push("/books");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("teamLeaveFailed"));
      toast.error(t("teamLeaveFailed"));
      setBusy(false);
    }
  }

  async function copyShareLink() {
    try {
      const url = `${window.location.origin}${window.location.pathname.split("?")[0]}`;
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success(t("teamLinkCopied"));
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(t("teamLinkCopyFailed"));
    }
  }

  function roleLabel(value: string): string {
    if (value === "owner") return t("roleOwner");
    if (value === "editor") return t("roleEditorShort");
    return t("roleViewerShort");
  }

  return (
    <div className="team-panel">
      <header className="team-panel__header">
        <div className="team-panel__header-copy">
          <h2 className="team-panel__title">{t("teamTitle")}</h2>
          <p className="team-panel__lead">{t("teamLead")}</p>
        </div>
        {summary ? (
          <div className="team-panel__stats" aria-label={t("teamStatsLabel")}>
            <div className="team-stat">
              <span className="team-stat__value">{summary.total}</span>
              <span className="team-stat__label">{t("teamStatMembers")}</span>
            </div>
            <div className="team-stat">
              <span className="team-stat__value">{summary.editors}</span>
              <span className="team-stat__label">{t("teamStatEditors")}</span>
            </div>
            <div className="team-stat">
              <span className="team-stat__value">
                {summary.seats_used}/{summary.seats_limit}
              </span>
              <span className="team-stat__label">{t("teamStatSeats")}</span>
            </div>
          </div>
        ) : null}
      </header>

      {!isStudio ? (
        <section className="settings-card team-upgrade-card">
          <div className="settings-card__head">
            <h3 className="settings-card__title">{t("teamUpgradeTitle")}</h3>
            <p className="settings-card__lead">{t("teamUpgrade")}</p>
          </div>
          <Link href="/pricing" className="btn btn-primary btn-compact">
            {t("teamUpgradeCta")}
          </Link>
        </section>
      ) : null}

      <section className="settings-card">
        <div className="settings-card__head">
          <h3 className="settings-card__title">{t("teamInviteTitle")}</h3>
          <p className="settings-card__lead">{t("teamInviteLead")}</p>
        </div>

        <form className="team-invite-form" onSubmit={(e) => void invite(e)}>
          <label className="team-field">
            <span>{t("teamEmail")}</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t("teamEmailPlaceholder")}
              required
              autoComplete="email"
              disabled={!canManage || busy || seatsFull}
            />
          </label>
          <label className="team-field">
            <span>{t("teamRole")}</span>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as "editor" | "viewer")}
              disabled={!canManage || busy || seatsFull}
            >
              <option value="editor">{t("roleEditor")}</option>
              <option value="viewer">{t("roleViewer")}</option>
            </select>
          </label>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={!canManage || busy || seatsFull || !email.trim()}
          >
            {busy ? t("teamInviting") : t("teamInvite")}
          </button>
        </form>

        {seatsFull ? <p className="team-inline-hint team-inline-hint--warn">{t("teamSeatsFull")}</p> : null}
        {seatsNearLimit && !seatsFull ? (
          <p className="team-inline-hint">{t("teamSeatsNear", { used: summary!.seats_used, limit: summary!.seats_limit })}</p>
        ) : null}

        <div className="team-share-row">
          <p className="muted team-share-copy">{t("teamShareHint")}</p>
          <button type="button" className="btn btn-ghost btn-compact" onClick={() => void copyShareLink()}>
            {copied ? t("teamLinkCopiedShort") : t("teamCopyLink")}
          </button>
        </div>
      </section>

      <section className="settings-card">
        <div className="team-members-head">
          <div className="settings-card__head">
            <h3 className="settings-card__title">{t("teamMembersTitle")}</h3>
            <p className="settings-card__lead">
              {bookTitle
                ? t("teamMembersLeadNamed", { title: bookTitle })
                : t("teamMembersLead")}
            </p>
          </div>
          {members.length > 3 ? (
            <label className="team-search">
              <span className="sr-only">{t("teamSearch")}</span>
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("teamSearchPlaceholder")}
              />
            </label>
          ) : null}
        </div>

        {loading ? <p className="muted">{t("teamLoading")}</p> : null}

        {!loading && filtered.length === 0 ? (
          <p className="muted team-empty">{query ? t("teamSearchEmpty") : t("teamEmpty")}</p>
        ) : null}

        {!loading && filtered.length > 0 ? (
          <ul className="team-member-list">
            {filtered.map((member) => {
              const tone = roleTone(member.role);
              const joined = member.created_at
                ? format.dateTime(new Date(member.created_at), {
                    dateStyle: "medium",
                  })
                : null;
              return (
                <li key={member.id} className="team-member" data-role={tone}>
                  <div className="team-member__identity">
                    <span className="team-avatar" aria-hidden>
                      {initials(member.display_name, member.email)}
                    </span>
                    <div className="team-member__copy">
                      <div className="team-member__name-row">
                        <strong>{member.display_name || member.email}</strong>
                        {member.is_you ? (
                          <span className="team-you-badge">{t("teamYou")}</span>
                        ) : null}
                      </div>
                      <span className="muted team-member__email">{member.email}</span>
                      {joined ? (
                        <span className="muted team-member__meta">
                          {t("teamJoined", { date: joined })}
                        </span>
                      ) : null}
                    </div>
                  </div>

                  <div className="team-member__actions">
                    {member.role === "owner" || !canManage ? (
                      <span className={`team-role-badge team-role-badge--${tone}`}>
                        {roleLabel(member.role)}
                      </span>
                    ) : (
                      <label className="team-role-select">
                        <span className="sr-only">{t("teamRole")}</span>
                        <select
                          value={member.role === "viewer" ? "viewer" : "editor"}
                          disabled={busy}
                          onChange={(e) =>
                            void changeRole(
                              member.id,
                              e.target.value as "editor" | "viewer",
                            )
                          }
                        >
                          <option value="editor">{t("roleEditorShort")}</option>
                          <option value="viewer">{t("roleViewerShort")}</option>
                        </select>
                      </label>
                    )}

                    {isOwner && member.role !== "owner" ? (
                      <button
                        type="button"
                        className="btn btn-ghost btn-compact"
                        disabled={busy}
                        onClick={() => void remove(member)}
                      >
                        {t("teamRemove")}
                      </button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        ) : null}

        {!isOwner ? (
          <div className="team-leave-row">
            <p className="muted">{t("teamLeaveHint")}</p>
            <button
              type="button"
              className="btn btn-ghost btn-compact"
              disabled={busy}
              onClick={() => void leave()}
            >
              {t("teamLeave")}
            </button>
          </div>
        ) : null}
      </section>

      <details className="team-perms-disclosure">
        <summary>
          <span>{t("teamPermsTitle")}</span>
          <span className="muted">{t("teamPermsLead")}</span>
        </summary>
        <div className="team-perm-grid">
          <article className="team-perm">
            <span className="team-role-badge team-role-badge--owner">{t("roleOwner")}</span>
            <p>{t("teamPermOwner")}</p>
          </article>
          <article className="team-perm">
            <span className="team-role-badge team-role-badge--editor">{t("roleEditorShort")}</span>
            <p>{t("teamPermEditor")}</p>
          </article>
          <article className="team-perm">
            <span className="team-role-badge team-role-badge--viewer">{t("roleViewerShort")}</span>
            <p>{t("teamPermViewer")}</p>
          </article>
        </div>
      </details>

      {error ? <p className="team-error" role="alert">{error}</p> : null}
    </div>
  );
}
