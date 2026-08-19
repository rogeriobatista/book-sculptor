"use client";

import { ChapterEditor } from "@/components/ChapterEditor";
import { ChapterSidebar } from "@/components/ChapterSidebar";
import { ExportActions, type ExportFormat } from "@/components/ExportActions";
import { FormatPanel } from "@/components/FormatPanel";
import {
  ImportManuscriptModal,
  type ImportMode,
} from "@/components/ImportManuscriptModal";
import { KindleReader, type PreviewPage } from "@/components/KindleReader";
import { StudioStartPanel } from "@/components/StudioStartPanel";
import { TeamPanel } from "@/components/TeamPanel";
import { useToast } from "@/components/ToastProvider";
import {
  type Book,
  type Chapter,
  type ExportJob,
  clientApiFetch,
} from "@/lib/client-api";
import { Link } from "@/i18n/navigation";
import { useStableAuth } from "@/lib/use-app-auth";
import { FormEvent, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";

type Props = {
  bookId: string;
  locale: string;
  tab: string;
};

type Me = {
  id: string;
  email: string;
  ui_locale: string;
  plan: string;
};

type StudioView = "write" | "format" | "preview" | "team" | "settings";

export function BookWorkspace({ bookId, locale, tab }: Props) {
  const { isLoaded, isSignedIn, getToken, getTokenRef } = useStableAuth();
  const toast = useToast();
  const t = useTranslations("books");
  const s = useTranslations("studio");
  const common = useTranslations("common");

  const [book, setBook] = useState<Book | null>(null);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [me, setMe] = useState<Me | null>(null);
  const [activeChapterId, setActiveChapterId] = useState<string | null>(null);
  const [view, setView] = useState<StudioView>(
    (["write", "format", "preview", "team", "settings"] as StudioView[]).includes(
      tab as StudioView,
    )
      ? (tab as StudioView)
      : "write",
  );
  const [importOpen, setImportOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [previewPages, setPreviewPages] = useState<PreviewPage[]>([]);
  const [previewCss, setPreviewCss] = useState<Record<string, string | number> | null>(
    null,
  );
  const loadGen = useRef(0);

  const canUseAi = Boolean(me && me.plan !== "free");
  const isStudio = me?.plan === "studio";
  const canEdit = book?.my_role !== "viewer";
  const activeChapter =
    chapters.find((c) => c.id === activeChapterId) || chapters[0] || null;

  useEffect(() => {
    const allowed = ["write", "format", "preview", "team", "settings"];
    if (allowed.includes(tab)) setView(tab as StudioView);
  }, [tab]);

  useEffect(() => {
    const onPop = () => {
      const next = new URLSearchParams(window.location.search).get("tab") || "write";
      if (["write", "format", "preview", "team", "settings"].includes(next)) {
        setView(next as StudioView);
      }
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  async function load() {
    const gen = ++loadGen.current;
    const token = await getTokenRef.current();
    if (!token) throw new Error("Not signed in.");
    const [b, c, profile] = await Promise.all([
      clientApiFetch<Book>(`/api/v1/books/${bookId}`, token),
      clientApiFetch<Chapter[]>(`/api/v1/books/${bookId}/chapters`, token),
      clientApiFetch<Me>("/api/v1/me", token),
    ]);
    if (gen !== loadGen.current) return;
    setBook(b);
    setChapters(c);
    setMe(profile);
    setActiveChapterId((current) =>
      current && c.some((item) => item.id === current) ? current : c[0]?.id || null,
    );
  }

  useEffect(() => {
    if (!isLoaded) return;
    if (!isSignedIn) return;
    let cancelled = false;
    load().catch((err) => {
      if (!cancelled) {
        toast.error(
          s("notifyLoadFailed"),
          err instanceof Error ? err.message : undefined,
        );
      }
    });
    return () => {
      cancelled = true;
      loadGen.current += 1;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId, isLoaded, isSignedIn]);

  useEffect(() => {
    if (view !== "preview" || !isLoaded || !isSignedIn) return;
    let cancelled = false;
    const loadingId = toast.loading(s("notifyPreviewLoading"));
    (async () => {
      try {
        const token = await getTokenRef.current();
        if (!token) throw new Error("Not signed in.");
        const payload = await clientApiFetch<{
          pages: { type?: string; title?: string; html: string }[];
          css?: Record<string, string | number>;
        }>(`/api/v1/books/${bookId}/preview`, token);
        if (cancelled) {
          toast.dismiss(loadingId);
          return;
        }
        setPreviewCss(payload.css || null);
        setPreviewPages(payload.pages || []);
        toast.dismiss(loadingId);
      } catch (err) {
        if (!cancelled) {
          setPreviewPages([]);
          toast.update(loadingId, {
            tone: "error",
            title: s("notifyPreviewFailed"),
            description: err instanceof Error ? err.message : undefined,
          });
        } else toast.dismiss(loadingId);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId, view, isLoaded, isSignedIn]);

  function goView(next: StudioView) {
    setView(next);
    window.history.pushState(
      {},
      "",
      `/${locale}/books/${bookId}?tab=${encodeURIComponent(next)}`,
    );
  }

  async function runImport(
    files: File[],
    mode: ImportMode,
    useAiStructure = true,
  ) {
    if (!files.length) return;
    setBusy(true);
    const loadingId = toast.loading(s("notifyImporting"));
    try {
      const token = await getToken();
      const form = new FormData();
      files.forEach((file) => form.append("files", file));
      form.append("replace", mode === "replace" ? "true" : "false");
      form.append("use_ai_structure", useAiStructure ? "true" : "false");
      await clientApiFetch(`/api/v1/books/${bookId}/import`, token, {
        method: "POST",
        body: form,
      });
      await load();
      setImportOpen(false);
      goView("write");
      toast.update(loadingId, {
        tone: "success",
        title: s("notifyImportDone"),
        description: s("notifyImportDoneHint", { count: files.length }),
      });
    } catch (err) {
      toast.update(loadingId, {
        tone: "error",
        title: s("notifyImportFailed"),
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setBusy(false);
    }
  }

  async function addBlankChapter() {
    setBusy(true);
    const loadingId = toast.loading(s("notifyChapterCreating"));
    try {
      const token = await getToken();
      const chapter = await clientApiFetch<Chapter>(
        `/api/v1/books/${bookId}/chapters`,
        token,
        {
          method: "POST",
          body: JSON.stringify({
            title: `${s("chapter")} ${chapters.length + 1}`,
            kind: "chapter",
            number: chapters.length + 1,
            content_text: "",
          }),
        },
      );
      await load();
      setActiveChapterId(chapter.id);
      goView("write");
      toast.update(loadingId, {
        tone: "success",
        title: s("notifyChapterCreated"),
      });
    } catch (err) {
      toast.update(loadingId, {
        tone: "error",
        title: s("notifyChapterFailed"),
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setBusy(false);
    }
  }

  async function renameChapter(chapterId: string, title: string) {
    const next = title.trim();
    if (!next) return;
    setBusy(true);
    try {
      const token = await getToken();
      const updated = await clientApiFetch<Chapter>(
        `/api/v1/books/${bookId}/chapters/${chapterId}`,
        token,
        { method: "PATCH", body: JSON.stringify({ title: next }) },
      );
      setChapters((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
      toast.success(s("notifyRenamed"));
    } catch (err) {
      toast.error(
        s("notifyRenameFailed"),
        err instanceof Error ? err.message : undefined,
      );
    } finally {
      setBusy(false);
    }
  }

  async function deleteChapter(chapterId: string) {
    setBusy(true);
    const loadingId = toast.loading(s("notifyChapterDeleting"));
    try {
      const token = await getToken();
      await clientApiFetch(`/api/v1/books/${bookId}/chapters/${chapterId}`, token, {
        method: "DELETE",
      });
      await load();
      toast.update(loadingId, {
        tone: "success",
        title: s("notifyChapterDeleted"),
      });
    } catch (err) {
      toast.update(loadingId, {
        tone: "error",
        title: s("notifyChapterDeleteFailed"),
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setBusy(false);
    }
  }

  async function deleteAllChapters() {
    setBusy(true);
    const loadingId = toast.loading(s("notifyChapterDeleting"));
    try {
      const token = await getToken();
      await clientApiFetch(`/api/v1/books/${bookId}/chapters/all`, token, {
        method: "DELETE",
      });
      await load();
      setActiveChapterId(null);
      toast.update(loadingId, {
        tone: "success",
        title: s("notifyAllChaptersDeleted"),
      });
    } catch (err) {
      toast.update(loadingId, {
        tone: "error",
        title: s("notifyChapterDeleteFailed"),
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setBusy(false);
    }
  }

  async function reorderChapters(order: string[]) {
    const previous = chapters;
    setChapters(
      order
        .map((id, index) => {
          const chapter = previous.find((item) => item.id === id);
          return chapter ? { ...chapter, position: index } : null;
        })
        .filter((chapter): chapter is Chapter => Boolean(chapter)),
    );
    try {
      const token = await getToken();
      const updated = await clientApiFetch<Chapter[]>(
        `/api/v1/books/${bookId}/chapters/reorder`,
        token,
        {
          method: "POST",
          body: JSON.stringify({ order }),
        },
      );
      setChapters(updated);
    } catch (err) {
      setChapters(previous);
      toast.push({
        tone: "error",
        title: s("notifyReorderFailed"),
        description: err instanceof Error ? err.message : undefined,
      });
    }
  }

  async function onExport(format: ExportFormat) {
    setBusy(true);
    const loadingId = toast.loading(
      s("notifyExporting", { format: format.toUpperCase() }),
    );
    try {
      const token = await getToken();
      let job = await clientApiFetch<ExportJob>(
        `/api/v1/books/${bookId}/exports`,
        token,
        { method: "POST", body: JSON.stringify({ format }) },
      );
      for (let i = 0; i < 40; i++) {
        if (job.status !== "queued" && job.status !== "processing") break;
        await new Promise((r) => setTimeout(r, 500));
        job = await clientApiFetch<ExportJob>(`/api/v1/exports/${job.id}`, token);
      }
      if (job.status === "ready" && job.download_url) {
        window.open(job.download_url, "_blank");
        toast.update(loadingId, {
          tone: "success",
          title: s("notifyExportReady"),
        });
      } else if (job.status === "failed") {
        toast.update(loadingId, {
          tone: "error",
          title: s("notifyExportFailed"),
          description: job.error || undefined,
        });
      } else {
        toast.update(loadingId, {
          tone: "info",
          title: s("notifyExportStarted"),
        });
      }
    } catch (err) {
      toast.update(loadingId, {
        tone: "error",
        title: s("notifyExportFailed"),
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setBusy(false);
    }
  }

  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!book) return;
    const form = new FormData(event.currentTarget);
    setBusy(true);
    const loadingId = toast.loading(s("notifySaving"));
    try {
      const token = await getToken();
      const updated = await clientApiFetch<Book>(`/api/v1/books/${bookId}`, token, {
        method: "PATCH",
        body: JSON.stringify({
          title: String(form.get("title") || book.title),
          author: String(form.get("author") || ""),
          locale: String(form.get("locale") || book.locale),
          settings: book.settings || {},
        }),
      });
      setBook(updated);
      toast.update(loadingId, { tone: "success", title: s("notifySaved") });
    } catch (err) {
      toast.update(loadingId, {
        tone: "error",
        title: s("notifySaveFailed"),
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setBusy(false);
    }
  }

  const nav: { id: StudioView; label: string; hint: string }[] = [
    { id: "write", label: s("flowWrite"), hint: s("flowWriteHint") },
    { id: "format", label: s("flowFormat"), hint: s("flowFormatHint") },
    { id: "preview", label: s("flowPreview"), hint: s("flowPreviewHint") },
    { id: "team", label: s("flowTeam"), hint: s("flowTeamHint") },
    { id: "settings", label: s("flowSettings"), hint: s("flowSettingsHint") },
  ];

  return (
    <div className="studio-shell">
      <header className="studio-topbar">
        <div className="studio-topbar-start">
          <Link href="/books" className="studio-back" title={s("backToBooks")}>
            <span aria-hidden="true">←</span>
            <span className="studio-back-label">{s("backToBooks")}</span>
          </Link>
          <div className="studio-topbar-meta">
            <h1 className="studio-book-title">{book?.title || "…"}</h1>
            <p className="studio-book-sub muted">
              {book?.author
                ? book.author
                : s("chapterCountLabel", { count: chapters.length })}
            </p>
          </div>
        </div>

        <nav className="studio-flow-nav" aria-label={s("flowNav")}>
          {nav.map((item) => (
            <button
              key={item.id}
              type="button"
              className="studio-flow-tab"
              data-active={view === item.id}
              title={item.hint}
              aria-current={view === item.id ? "page" : undefined}
              onClick={() => goView(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>

        <div className="studio-topbar-actions">
          <button
            type="button"
            className="btn btn-ghost studio-action-secondary"
            disabled={busy}
            onClick={() => setImportOpen(true)}
            title={s("importPdfDocx")}
          >
            {s("importShort")}
          </button>
          <ExportActions
            busy={busy}
            disabled={chapters.length === 0}
            onExport={(format) => void onExport(format)}
          />
        </div>
      </header>

      {view === "write" && (
        <div className="studio-write-layout">
          <ChapterSidebar
            chapters={chapters}
            activeId={activeChapter?.id || null}
            busy={busy}
            readOnly={!canEdit}
            onSelect={(id) => setActiveChapterId(id)}
            onAdd={() => void addBlankChapter()}
            onRename={renameChapter}
            onDelete={deleteChapter}
            onDeleteAll={deleteAllChapters}
            onReorder={reorderChapters}
          />
          <div className="studio-write-main">
            {chapters.length === 0 ? (
              <StudioStartPanel
                bookId={bookId}
                bookTitle={book?.title || ""}
                bookLocale={book?.locale || locale}
                canUseAi={canUseAi}
                busy={busy}
                onRequestImport={() => setImportOpen(true)}
                onCreated={(chapter) => {
                  setChapters((prev) => [...prev, chapter]);
                  setActiveChapterId(chapter.id);
                }}
                onOpenEditor={(chapterId) => setActiveChapterId(chapterId)}
                labels={{
                  title: s("startTitle"),
                  lead: s("startLead"),
                  ideaLabel: s("ideaLabel"),
                  ideaPlaceholder: s("ideaPlaceholder"),
                  writeChapter: s("writeChapter"),
                  makeOutline: s("makeOutline"),
                  orImport: s("orImport"),
                  importFile: s("importPdfDocx"),
                  upgradeHint: s("upgradeAi"),
                  writing: s("writing"),
                }}
              />
            ) : activeChapter ? (
              <ChapterEditor
                bookId={bookId}
                chapter={activeChapter}
                chapters={chapters}
                canUseAi={canUseAi}
                canEdit={canEdit}
                onSelectChapter={(id) => setActiveChapterId(id)}
                onSaved={(updated) => {
                  setChapters((prev) =>
                    prev.map((c) => (c.id === updated.id ? updated : c)),
                  );
                }}
                onTitleSaved={(updated) => {
                  setChapters((prev) =>
                    prev.map((c) => (c.id === updated.id ? updated : c)),
                  );
                }}
              />
            ) : null}
          </div>
        </div>
      )}

      {view === "format" && book ? (
        <div className="studio-isolated panel">
          <FormatPanel
            book={book}
            onSaved={setBook}
            busy={busy}
            canExport={chapters.length > 0}
            onExport={(format) => void onExport(format)}
          />
        </div>
      ) : null}

      {view === "preview" ? (
        <div className="studio-isolated panel preview-stage">
          <KindleReader
            pages={previewPages}
            css={previewCss}
            labels={{
              prev: s("previewPrev"),
              next: s("previewNext"),
              jump: s("previewJump"),
              empty: s("previewEmpty"),
            }}
          />
        </div>
      ) : null}

      {view === "team" ? (
        <div className="studio-isolated panel">
          <TeamPanel
            bookId={bookId}
            isStudio={Boolean(isStudio)}
            labels={{
              title: s("teamTitle"),
              lead: s("teamLead"),
              email: s("teamEmail"),
              role: s("teamRole"),
              editor: s("roleEditor"),
              viewer: s("roleViewer"),
              invite: s("teamInvite"),
              empty: s("teamEmpty"),
              upgrade: s("teamUpgrade"),
              remove: s("teamRemove"),
            }}
          />
        </div>
      ) : null}

      {view === "settings" && book ? (
        <div className="studio-isolated panel">
          <form className="form-grid" onSubmit={saveSettings}>
            <h2>{t("settings")}</h2>
            <label>
              {t("title")}
              <input name="title" defaultValue={book.title} />
            </label>
            <label>
              {t("author")}
              <input name="author" defaultValue={book.author} />
            </label>
            <label>
              {t("locale")}
              <select name="locale" defaultValue={book.locale}>
                <option value="en">English</option>
                <option value="pt-BR">Português (Brasil)</option>
                <option value="es">Español</option>
              </select>
            </label>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {common("save")}
            </button>
          </form>
        </div>
      ) : null}

      <ImportManuscriptModal
        open={importOpen}
        chapterCount={chapters.length}
        busy={busy}
        canUseAi={canUseAi}
        onClose={() => {
          if (!busy) setImportOpen(false);
        }}
        onConfirm={({ files, mode, useAiStructure }) => {
          void runImport(files, mode, useAiStructure);
        }}
        labels={{
          title: s("importModalTitle"),
          lead: s("importModalLead"),
          pickFiles: s("importPickFiles"),
          dropHint: s("importDropHint"),
          selected: s("importSelected"),
          tocHint: s("importTocHint"),
          modeLabel: s("importModeLabel"),
          append: s("importModeAppend"),
          appendHint: s("importModeAppendHint"),
          replace: s("importModeReplace"),
          replaceHint: s("importModeReplaceHint"),
          aiStructure: s("importAiStructure"),
          aiStructureHint: s("importAiStructureHint"),
          aiStructureUpgrade: s("importAiStructureUpgrade"),
          cancel: common("cancel"),
          confirm: s("importConfirm"),
          emptyBookNote: s("importEmptyBookNote"),
        }}
      />
    </div>
  );
}
