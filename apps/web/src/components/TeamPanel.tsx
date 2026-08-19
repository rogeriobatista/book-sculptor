"use client";

import { FormEvent, useEffect, useState } from "react";
import { clientApiFetch } from "@/lib/client-api";
import { useStableAuth } from "@/lib/use-app-auth";

type Member = {
  id: string;
  user_id: string;
  email: string;
  role: string;
};

type Props = {
  bookId: string;
  isStudio: boolean;
  labels: {
    title: string;
    lead: string;
    email: string;
    role: string;
    editor: string;
    viewer: string;
    invite: string;
    empty: string;
    upgrade: string;
    remove: string;
  };
};

export function TeamPanel({ bookId, isStudio, labels }: Props) {
  const { getTokenRef } = useStableAuth();
  const [members, setMembers] = useState<Member[]>([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("editor");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function loadMembers() {
    const token = await getTokenRef.current();
    return clientApiFetch<Member[]>(`/api/v1/books/${bookId}/members`, token);
  }

  useEffect(() => {
    let cancelled = false;
    loadMembers()
      .then((data) => {
        if (!cancelled) setMembers(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Error");
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId]);

  async function invite(event: FormEvent) {
    event.preventDefault();
    if (!isStudio) {
      setError(labels.upgrade);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const token = await getTokenRef.current();
      await clientApiFetch(`/api/v1/books/${bookId}/members`, token, {
        method: "POST",
        body: JSON.stringify({ email, role }),
      });
      setEmail("");
      setMembers(await loadMembers());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error");
    } finally {
      setBusy(false);
    }
  }

  async function remove(memberId: string) {
    setBusy(true);
    setError(null);
    try {
      const token = await getTokenRef.current();
      await clientApiFetch(`/api/v1/books/${bookId}/members/${memberId}`, token, {
        method: "DELETE",
      });
      setMembers(await loadMembers());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack studio-team">
      <div>
        <h2 style={{ marginTop: 0 }}>{labels.title}</h2>
        <p className="muted">{labels.lead}</p>
      </div>

      {!isStudio ? <p className="muted">{labels.upgrade}</p> : null}

      <form className="form-grid" onSubmit={invite}>
        <label>
          {labels.email}
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            disabled={!isStudio || busy}
          />
        </label>
        <label>
          {labels.role}
          <select
            value={role}
            onChange={(e) => setRole(e.target.value)}
            disabled={!isStudio || busy}
          >
            <option value="editor">{labels.editor}</option>
            <option value="viewer">{labels.viewer}</option>
          </select>
        </label>
        <button type="submit" className="btn btn-primary" disabled={!isStudio || busy}>
          {labels.invite}
        </button>
      </form>

      {error ? <p className="muted">{error}</p> : null}

      <ul className="team-list">
        {members.length === 0 ? (
          <li className="muted">{labels.empty}</li>
        ) : (
          members.map((member) => (
            <li key={member.id}>
              <div>
                <strong>{member.email || member.user_id}</strong>
                <span className="muted"> · {member.role}</span>
              </div>
              {member.role !== "owner" ? (
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={!isStudio || busy}
                  onClick={() => void remove(member.id)}
                >
                  {labels.remove}
                </button>
              ) : null}
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
