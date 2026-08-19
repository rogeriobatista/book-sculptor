"use client";

import { FormEvent, useState } from "react";
import { streamAiChapter } from "@/lib/ai-stream";
import { type Chapter, clientApiFetch } from "@/lib/client-api";
import { useAppAuth } from "@/lib/use-app-auth";
import { useToast } from "@/components/ToastProvider";

type Props = {
  bookId: string;
  bookTitle: string;
  bookLocale: string;
  canUseAi: boolean;
  onCreated: (chapter: Chapter) => void;
  onOpenEditor: (chapterId: string) => void;
  onRequestImport: () => void;
  busy?: boolean;
  labels: {
    title: string;
    lead: string;
    ideaLabel: string;
    ideaPlaceholder: string;
    writeChapter: string;
    makeOutline: string;
    orImport: string;
    importFile: string;
    upgradeHint: string;
    writing: string;
  };
};

export function StudioStartPanel({
  bookId,
  bookTitle,
  canUseAi,
  onCreated,
  onOpenEditor,
  onRequestImport,
  busy = false,
  labels,
}: Props) {
  const { getToken } = useAppAuth();
  const toast = useToast();
  const [idea, setIdea] = useState("");
  const [working, setWorking] = useState(false);
  const [outline, setOutline] = useState<string | null>(null);
  const [streamPreview, setStreamPreview] = useState("");

  async function createChapterWithAi(action: "start" | "outline") {
    if (!canUseAi) {
      toast.info(labels.upgradeHint);
      return;
    }
    const prompt = idea.trim();
    if (!prompt) {
      toast.error(labels.ideaLabel);
      return;
    }
    setWorking(true);
    setStreamPreview("");
    const loadingId = toast.loading(labels.writing);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not signed in.");

      if (action === "outline") {
        let assembled = "";
        await streamAiChapter(
          token,
          {
            book_id: bookId,
            action: "outline",
            prompt: `${bookTitle ? `${bookTitle}\n\n` : ""}${prompt}`,
          },
          (event) => {
            if (event.type === "delta") {
              assembled += event.text;
              setStreamPreview(assembled);
            } else if (event.type === "error") {
              throw new Error(event.error || "AI failed");
            } else if (event.type === "done") {
              assembled = event.text || assembled;
              setStreamPreview(assembled);
            }
          },
        );
        setOutline(assembled.trim());
        toast.update(loadingId, {
          tone: "success",
          title: labels.makeOutline,
        });
        return;
      }

      const chapter = await clientApiFetch<Chapter>(
        `/api/v1/books/${bookId}/chapters`,
        token,
        {
          method: "POST",
          body: JSON.stringify({
            title: "Chapter 1",
            kind: "chapter",
            number: 1,
            content_text: "",
          }),
        },
      );

      let assembled = "";
      await streamAiChapter(
        token,
        {
          book_id: bookId,
          chapter_id: chapter.id,
          action: "start",
          prompt: `${bookTitle ? `${bookTitle}\n\n` : ""}${prompt}`,
        },
        (event) => {
          if (event.type === "delta") {
            assembled += event.text;
            setStreamPreview(assembled);
          } else if (event.type === "error") {
            throw new Error(event.error || "AI failed");
          } else if (event.type === "done") {
            assembled = event.text || assembled;
            setStreamPreview(assembled);
          }
        },
      );

      const text = assembled.trim();
      if (!text) throw new Error("AI failed");

      const updated = await clientApiFetch<Chapter>(
        `/api/v1/books/${bookId}/chapters/${chapter.id}`,
        token,
        {
          method: "PATCH",
          body: JSON.stringify({ content_text: text }),
        },
      );
      onCreated(updated);
      onOpenEditor(updated.id);
      toast.update(loadingId, {
        tone: "success",
        title: labels.writeChapter,
      });
    } catch (err) {
      toast.update(loadingId, {
        tone: "error",
        title: labels.writing,
        description: err instanceof Error ? err.message : "Error",
      });
    } finally {
      setWorking(false);
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void createChapterWithAi("start");
  }

  return (
    <div className="studio-start stack">
      <h2 style={{ marginTop: 0 }}>{labels.title}</h2>
      <p className="muted">{labels.lead}</p>

      <form className="stack" onSubmit={onSubmit}>
        <label>
          {labels.ideaLabel}
          <textarea
            value={idea}
            onChange={(event) => setIdea(event.target.value)}
            placeholder={labels.ideaPlaceholder}
            rows={5}
            disabled={busy || working}
          />
        </label>
        <div className="cta-group">
          <button
            type="submit"
            className="btn btn-primary"
            disabled={busy || working || !canUseAi}
          >
            {working ? labels.writing : labels.writeChapter}
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={busy || working || !canUseAi}
            onClick={() => void createChapterWithAi("outline")}
          >
            {labels.makeOutline}
          </button>
        </div>
      </form>

      {!canUseAi ? <p className="muted">{labels.upgradeHint}</p> : null}

      {working && streamPreview ? (
        <div className="studio-outline studio-stream-live" aria-live="polite">
          <pre>{streamPreview}</pre>
        </div>
      ) : null}

      {outline && !working ? (
        <div className="studio-outline">
          <pre>{outline}</pre>
        </div>
      ) : null}

      <div className="studio-divider">
        <span>{labels.orImport}</span>
      </div>
      <button
        type="button"
        className="btn btn-ghost"
        style={{ width: "fit-content" }}
        disabled={busy || working}
        onClick={onRequestImport}
      >
        {labels.importFile}
      </button>
    </div>
  );
}
