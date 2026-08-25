"use client";

import { BookSettingsPanel } from "@/components/BookSettingsPanel";
import { ChapterEditor } from "@/components/ChapterEditor";
import { ChapterSidebar } from "@/components/ChapterSidebar";
import { ExportActions, type ExportFormat } from "@/components/ExportActions";
import { FormatPanel } from "@/components/FormatPanel";
import { PublicationHub } from "@/components/PublicationHub";
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
  clientApiDownload,
  isAbortError,
  isProtectedFileUrl,
} from "@/lib/client-api";
import {
  defaultSectionTitle,
  kindTranslationKey,
  type ChapterKind,
} from "@/lib/chapter-structure";
import { Link } from "@/i18n/navigation";
import { useStableAuth } from "@/lib/use-app-auth";
import { useAiQuota } from "@/lib/use-ai-quota";
import { useEffect, useRef, useState } from "react";
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

type StudioView = "write" | "review" | "format" | "publish" | "preview" | "team" | "settings";

const STUDIO_VIEWS: StudioView[] = [
  "write",
  "review",
  "format",
  "publish",
  "preview",
  "team",
  "settings",
];

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
    STUDIO_VIEWS.includes(tab as StudioView) ? (tab as StudioView) : "write",
  );
  const [importOpen, setImportOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [previewPages, setPreviewPages] = useState<PreviewPage[]>([]);
  const [previewCss, setPreviewCss] = useState<Record<string, string | number> | null>(
    null,
  );
  const loadGen = useRef(0);
  const exportAbort = useRef<AbortController | null>(null);

  const canUseAi = Boolean(me && me.plan !== "free");
  const { quota: aiQuota, applyQuota } = useAiQuota(canUseAi);
  const isStudio = me?.plan === "studio";
  const canEdit = book?.my_role !== "viewer";
  const activeChapter =
    chapters.find((c) => c.id === activeChapterId) || chapters[0] || null;

  useEffect(() => {
    if (STUDIO_VIEWS.includes(tab as StudioView)) setView(tab as StudioView);
  }, [tab]);

  useEffect(() => {
    const onPop = () => {
      const next = new URLSearchParams(window.location.search).get("tab") || "write";
      if (STUDIO_VIEWS.includes(next as StudioView)) {
        setView(next as StudioView);
      }
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  async function load(signal?: AbortSignal) {
    const gen = ++loadGen.current;
    const token = await getTokenRef.current();
    if (!token) throw new Error("Not signed in.");
    const fetchOpts = signal ? { signal } : {};
    const [b, c, profile] = await Promise.all([
      clientApiFetch<Book>(`/api/v1/books/${bookId}`, token, fetchOpts),
      clientApiFetch<Chapter[]>(`/api/v1/books/${bookId}/chapters`, token, fetchOpts),
      clientApiFetch<Me>("/api/v1/me", token, fetchOpts),
    ]);
    if (gen !== loadGen.current || signal?.aborted) return;
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
    const ac = new AbortController();
    load(ac.signal).catch((err) => {
      if (!isAbortError(err) && !ac.signal.aborted) {
        toast.error(
          s("notifyLoadFailed"),
          err instanceof Error ? err.message : undefined,
        );
      }
    });
    return () => {
      ac.abort();
      loadGen.current += 1;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId, isLoaded, isSignedIn]);

  useEffect(() => {
    if (view !== "preview" || !isLoaded || !isSignedIn) return;
    const ac = new AbortController();
    const loadingId = toast.loading(s("notifyPreviewLoading"));
    (async () => {
      try {
        const token = await getTokenRef.current();
        if (!token) throw new Error("Not signed in.");
        const payload = await clientApiFetch<{
          pages: { type?: string; title?: string; html: string }[];
          css?: Record<string, string | number>;
        }>(`/api/v1/books/${bookId}/preview`, token, { signal: ac.signal });
        if (ac.signal.aborted) {
          toast.dismiss(loadingId);
          return;
        }
        setPreviewCss(payload.css || null);
        setPreviewPages(payload.pages || []);
        toast.dismiss(loadingId);
      } catch (err) {
        if (isAbortError(err) || ac.signal.aborted) {
          toast.dismiss(loadingId);
          return;
        }
        setPreviewPages([]);
        toast.update(loadingId, {
          tone: "error",
          title: s("notifyPreviewFailed"),
          description: err instanceof Error ? err.message : undefined,
        });
      }
    })();
    return () => {
      ac.abort();
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

  async function addSection(kind: ChapterKind, parentId: string | null = null) {
    setBusy(true);
    const loadingId = toast.loading(s("notifySectionCreating"));
    try {
      const token = await getToken();
      const title = defaultSectionTitle(kind, chapters, {
        chapter: s("chapter"),
        part: s("part"),
        kindLabel: (sectionKind) => s(kindTranslationKey(sectionKind)),
      });
      const chapter = await clientApiFetch<Chapter>(
        `/api/v1/books/${bookId}/chapters`,
        token,
        {
          method: "POST",
          body: JSON.stringify({
            title,
            kind,
            parent_id: parentId,
            content_text: "",
          }),
        },
      );
      await load();
      setActiveChapterId(chapter.id);
      goView("write");
      toast.update(loadingId, {
        tone: "success",
        title: s("notifySectionCreated"),
      });
    } catch (err) {
      toast.update(loadingId, {
        tone: "error",
        title: s("notifySectionFailed"),
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
    exportAbort.current?.abort();
    const ac = new AbortController();
    exportAbort.current = ac;
    setBusy(true);
    const loadingId = toast.loading(
      s("notifyExporting", { format: format.toUpperCase() }),
    );
    try {
      const token = await getToken();
      const fetchOpts = { signal: ac.signal };
      let job = await clientApiFetch<ExportJob>(
        `/api/v1/books/${bookId}/exports`,
        token,
        { method: "POST", body: JSON.stringify({ format }), ...fetchOpts },
      );
      for (let i = 0; i < 40; i++) {
        if (ac.signal.aborted) break;
        if (job.status !== "queued" && job.status !== "processing") break;
        await new Promise((r) => setTimeout(r, 500));
        if (ac.signal.aborted) break;
        job = await clientApiFetch<ExportJob>(`/api/v1/exports/${job.id}`, token, fetchOpts);
      }
      if (ac.signal.aborted) {
        toast.dismiss(loadingId);
        return;
      }
      if (job.status === "ready" && job.download_url) {
        const filename = `book.${format}`;
        if (isProtectedFileUrl(job.download_url)) {
          await clientApiDownload(job.download_url, token, filename);
        } else {
          window.open(job.download_url, "_blank", "noopener,noreferrer");
        }
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
      if (isAbortError(err)) {
        toast.dismiss(loadingId);
        return;
      }
      toast.update(loadingId, {
        tone: "error",
        title: s("notifyExportFailed"),
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      if (exportAbort.current === ac) exportAbort.current = null;
      setBusy(false);
    }
  }

  const navGroups: {
    id: string;
    label: string;
    items: { id: StudioView; label: string; hint: string }[];
  }[] = [
    {
      id: "creation",
      label: s("flowGroupCreation"),
      items: [
        { id: "write", label: s("flowWrite"), hint: s("flowWriteHint") },
        { id: "review", label: s("flowReview"), hint: s("flowReviewHint") },
      ],
    },
    {
      id: "production",
      label: s("flowGroupProduction"),
      items: [
        { id: "format", label: s("flowFormat"), hint: s("flowFormatHint") },
        { id: "preview", label: s("flowPreview"), hint: s("flowPreviewHint") },
      ],
    },
    {
      id: "publish",
      label: s("flowGroupPublish"),
      items: [{ id: "publish", label: s("flowPublish"), hint: s("flowPublishHint") }],
    },
    {
      id: "manage",
      label: s("flowGroupManage"),
      items: [
        { id: "team", label: s("flowTeam"), hint: s("flowTeamHint") },
        { id: "settings", label: s("flowSettings"), hint: s("flowSettingsHint") },
      ],
    },
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

        <div className="studio-topbar-actions" aria-label={s("studioContextTools")}>
          {(view === "write" || view === "review") && (
            <button
              type="button"
              className="btn btn-ghost studio-action-secondary"
              disabled={busy}
              onClick={() => setImportOpen(true)}
              title={s("importPdfDocx")}
            >
              {s("importShort")}
            </button>
          )}
          {(view === "write" ||
            view === "review" ||
            view === "format" ||
            view === "preview" ||
            view === "publish") && (
            <ExportActions
              busy={busy}
              disabled={chapters.length === 0}
              onExport={(format) => void onExport(format)}
            />
          )}
        </div>
      </header>

      <div className="studio-body">
        <nav className="studio-module-nav" aria-label={s("flowNav")}>
          {navGroups.map((group) => (
            <div key={group.id} className="studio-module-group" data-group={group.id}>
              <span className="studio-module-group-label">{group.label}</span>
              <ul className="studio-module-list">
                {group.items.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      className="studio-module-link"
                      data-active={view === item.id}
                      title={item.hint}
                      aria-current={view === item.id ? "page" : undefined}
                      onClick={() => goView(item.id)}
                    >
                      {item.label}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        <div className="studio-content">
      {(view === "write" || view === "review") && (
        <div className="studio-write-layout">
          <ChapterSidebar
            chapters={chapters}
            activeId={activeChapter?.id || null}
            busy={busy}
            readOnly={!canEdit}
            onSelect={(id) => setActiveChapterId(id)}
            onAddSection={(kind, parentId) => void addSection(kind, parentId ?? null)}
            onRename={renameChapter}
            onDelete={deleteChapter}
            onDeleteAll={deleteAllChapters}
            onReorder={reorderChapters}
          />
          <div className="studio-write-main">
            {view === "review" && chapters.length > 0 ? (
              <p className="studio-review-banner muted">{s("reviewWorkspaceBanner")}</p>
            ) : null}
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
                book={book!}
                chapter={activeChapter}
                chapters={chapters}
                canUseAi={canUseAi}
                aiQuota={aiQuota}
                onQuotaChange={applyQuota}
                canEdit={canEdit}
                workspaceMode={view === "review" ? "review" : "write"}
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
          <FormatPanel book={book} onSaved={setBook} />
        </div>
      ) : null}

      {view === "publish" && book ? (
        <div className="studio-isolated panel publication-stage">
          <PublicationHub
            book={book}
            locale={locale}
            canUseAi={canUseAi}
            canEdit={canEdit}
            canExport={chapters.length > 0}
            exportBusy={busy}
            onBookSaved={setBook}
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
            bookTitle={book?.title}
          />
        </div>
      ) : null}

      {view === "settings" && book ? (
        <BookSettingsPanel
          book={book}
          canEdit={canEdit}
          canUseAi={canUseAi}
          onSaved={setBook}
        />
      ) : null}

        </div>
      </div>

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
