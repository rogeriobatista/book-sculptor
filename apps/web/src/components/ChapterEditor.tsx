"use client";

import { useTranslations } from "next-intl";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import Placeholder from "@tiptap/extension-placeholder";
import Link from "@tiptap/extension-link";
import TextAlign from "@tiptap/extension-text-align";
import Highlight from "@tiptap/extension-highlight";
import CharacterCount from "@tiptap/extension-character-count";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { ChapterNavigator } from "@/components/ChapterNavigator";
import { ChapterOutline } from "@/components/ChapterOutline";
import {
  ChapterReviewPanel,
  type ChapterCommentItem,
} from "@/components/ChapterReviewPanel";
import { EditorAiPanel } from "@/components/EditorAiPanel";
import {
  CriticalReviewPanel,
  type CriticalFinding,
  type CriticalReviewResult,
  type CritiqueFilterKey,
} from "@/components/CriticalReviewPanel";
import { EditorToolsPanel, type EditorToolsTab } from "@/components/EditorToolsPanel";
import { RichTextToolbar } from "@/components/RichTextToolbar";
import { TrackChangeBubble } from "@/components/TrackChangeBubble";
import { CritiqueFindingBubble } from "@/components/CritiqueFindingBubble";
import { WriteFindBar } from "@/components/WriteFindBar";
import { WriteSelectionBar } from "@/components/WriteSelectionBar";
import { WriteStatsBar } from "@/components/WriteStatsBar";
import { useToast } from "@/components/ToastProvider";
import { type Book, type Chapter, clientApiFetch } from "@/lib/client-api";
import {
  CHAPTER_KINDS,
  countWords,
  docFromChapterContent,
  extractSections,
  kindTranslationKey,
  type ChapterSection,
} from "@/lib/chapter-structure";
import { findTextMatches, selectMatch } from "@/lib/editor-find";
import { streamAiChapter } from "@/lib/ai-stream";
import { createEditorStreamWriter } from "@/lib/editor-stream";
import { bookStyleFromBook, isBookStyleConfigured } from "@/lib/book-style";
import type { AiQuota } from "@/lib/use-ai-quota";
import {
  applyCritiqueHighlights,
  CritiqueHighlight,
  readingFindingIdFromEvent,
  stripEditorOverlayMarksFromJson,
} from "@/lib/critique-highlight";
import { saveCritiqueDismissed } from "@/lib/critique-session";
import {
  applyReviewHighlights,
  findQuoteRange,
  isOpenTrackChangeMark,
  jumpToQuote,
  readingCommentIdFromEvent,
  ReviewHighlight,
} from "@/lib/review-highlight";
import { useAppAuth } from "@/lib/use-app-auth";

const WRITE_PREFS_KEY = "bs.write.prefs.v1";

type WritePrefs = {
  focusMode: boolean;
  typewriter: boolean;
  fontScale: number;
  toolsOpen: boolean;
};

function loadWritePrefs(): WritePrefs {
  if (typeof window === "undefined") {
    return { focusMode: false, typewriter: false, fontScale: 1, toolsOpen: true };
  }
  try {
    const raw = window.localStorage.getItem(WRITE_PREFS_KEY);
    if (!raw) return { focusMode: false, typewriter: false, fontScale: 1, toolsOpen: true };
    const parsed = JSON.parse(raw) as Partial<WritePrefs>;
    return {
      focusMode: Boolean(parsed.focusMode),
      typewriter: Boolean(parsed.typewriter),
      fontScale:
        typeof parsed.fontScale === "number"
          ? Math.min(1.35, Math.max(0.85, parsed.fontScale))
          : 1,
      toolsOpen: parsed.toolsOpen !== false,
    };
  } catch {
    return { focusMode: false, typewriter: false, fontScale: 1, toolsOpen: true };
  }
}

function goalStorageKey(chapterId: string) {
  return `bs.write.goal.${chapterId}`;
}

function loadChapterGoal(chapterId: string): number {
  if (typeof window === "undefined") return 0;
  const raw = window.localStorage.getItem(goalStorageKey(chapterId));
  const n = Number(raw || 0);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

type AiAction =
  | "generate"
  | "continue"
  | "rewrite"
  | "tone"
  | "dialogue"
  | "simplify"
  | "finalize"
  | "consistent";

type ChatItem = {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  streaming?: boolean;
};

type Props = {
  bookId: string;
  book: Book;
  chapter: Chapter;
  chapters: Chapter[];
  canUseAi: boolean;
  aiQuota?: AiQuota;
  onQuotaChange?: (quota: AiQuota) => void;
  canEdit?: boolean;
  onSelectChapter: (id: string) => void;
  onSaved?: (chapter: Chapter) => void;
  onTitleSaved?: (chapter: Chapter) => void;
  workspaceMode?: "write" | "review";
};

function jumpToSection(
  editor: NonNullable<ReturnType<typeof useEditor>>,
  section: ChapterSection,
) {
  let blockIndex = 0;
  let targetPos = 1;
  editor.state.doc.descendants((node, pos) => {
    if (!node.isBlock || node.type.name === "doc") return;
    if (blockIndex === section.index) {
      targetPos = pos;
      return false;
    }
    blockIndex += 1;
  });
  editor.chain().focus().setTextSelection(targetPos).scrollIntoView().run();
}

export function ChapterEditor({
  bookId,
  book,
  chapter,
  chapters,
  canUseAi,
  aiQuota,
  onQuotaChange,
  canEdit = true,
  onSelectChapter,
  onSaved,
  onTitleSaved,
  workspaceMode = "write",
}: Props) {
  const { getToken } = useAppAuth();
  const toast = useToast();
  const t = useTranslations("studio");
  const prefs = useMemo(() => loadWritePrefs(), []);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiPrompt, setAiPrompt] = useState("");
  const [titleDraft, setTitleDraft] = useState(chapter.title || "");
  const [chat, setChat] = useState<ChatItem[]>([]);
  const [wordCount, setWordCount] = useState(() => countWords(chapter.content_text || ""));
  const [sessionBase, setSessionBase] = useState(() => countWords(chapter.content_text || ""));
  const [wordGoal, setWordGoal] = useState(() => loadChapterGoal(chapter.id));
  const [selectionQuote, setSelectionQuote] = useState("");
  const [reviewKey, setReviewKey] = useState(0);
  const [toolsOpen, setToolsOpen] = useState(prefs.toolsOpen);
  const [focusMode, setFocusMode] = useState(prefs.focusMode);
  const [typewriter, setTypewriter] = useState(prefs.typewriter);
  const [fontScale, setFontScale] = useState(prefs.fontScale);
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [findIndex, setFindIndex] = useState(0);
  const [aiCheckpoint, setAiCheckpoint] = useState<Record<string, unknown> | null>(null);
  const [toolsTab, setToolsTab] = useState<EditorToolsTab>(
    workspaceMode === "review" ? "critique" : "ai",
  );
  const [openReviewCount, setOpenReviewCount] = useState(0);
  const [reviewComments, setReviewComments] = useState<ChapterCommentItem[]>([]);
  const [critiqueFindings, setCritiqueFindings] = useState<CriticalFinding[]>([]);
  const [activeCritiqueId, setActiveCritiqueId] = useState<string | null>(null);
  const [critiqueResult, setCritiqueResult] = useState<CriticalReviewResult | null>(null);
  const [critiqueDismissed, setCritiqueDismissed] = useState<Set<string>>(() => new Set());
  const [critiqueFilter, setCritiqueFilter] = useState<CritiqueFilterKey>("all");
  const [activeTrackChangeId, setActiveTrackChangeId] = useState<string | null>(null);
  const [trackBubbleAnchor, setTrackBubbleAnchor] = useState<{ top: number; left: number } | null>(
    null,
  );
  const [critiqueBubbleAnchor, setCritiqueBubbleAnchor] = useState<{
    top: number;
    left: number;
  } | null>(null);
  const [critiqueBubbleBusy, setCritiqueBubbleBusy] = useState(false);
  const [trackBusy, setTrackBusy] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipNextSync = useRef(false);
  const loadedChapterId = useRef<string | null>(null);
  const chapterIdRef = useRef(chapter.id);
  const persistGen = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setToolsTab(workspaceMode === "review" ? "critique" : "ai");
    if (workspaceMode === "review") setToolsOpen(true);
  }, [workspaceMode, chapter.id]);

  const editorToolTabs: EditorToolsTab[] | undefined =
    workspaceMode === "review" ? ["critique", "review", "structure"] : undefined;

  const chips: { action: AiAction; label: string; prompt?: string }[] = [
    { action: "continue", label: t("chipContinue") },
    { action: "consistent", label: t("chipConsistent") },
    { action: "dialogue", label: t("chipDialogue") },
    { action: "simplify", label: t("chipSimplify") },
    { action: "tone", label: t("chipWarm"), prompt: t("promptWarm") },
    { action: "rewrite", label: t("chipRewrite") },
    { action: "finalize", label: t("chipFinalize") },
  ];

  const styleConfigured = useMemo(
    () => isBookStyleConfigured(bookStyleFromBook(book)),
    [book],
  );

  const initialDoc = useMemo(() => docFromChapterContent(chapter), [chapter]);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
      }),
      Underline,
      ReviewHighlight,
      CritiqueHighlight,
      Highlight.configure({ multicolor: false }),
      Link.configure({ openOnClick: false }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      Placeholder.configure({ placeholder: t("editorPlaceholder") }),
      CharacterCount,
    ],
    content: initialDoc,
    editable: canEdit,
    immediatelyRender: false,
    editorProps: {
      handleClick: (_view, _pos, event) => {
        if (isOpenTrackChangeMark(event.target)) {
          const commentId = readingCommentIdFromEvent(event.target);
          if (commentId) {
            setActiveTrackChangeId(commentId);
            setTrackBubbleAnchor({
              top: event.clientY + 12,
              left: Math.min(event.clientX, window.innerWidth - 320),
            });
            setToolsOpen(true);
            setToolsTab("review");
            const el = document.getElementById(`review-item-${commentId}`);
            el?.scrollIntoView({ behavior: "smooth", block: "nearest" });
            return true;
          }
        }
        const findingId = readingFindingIdFromEvent(event.target);
        if (!findingId) return false;
        setActiveTrackChangeId(null);
        setTrackBubbleAnchor(null);
        setActiveCritiqueId(findingId);
        setCritiqueBubbleAnchor({
          top: event.clientY + 12,
          left: Math.min(event.clientX, window.innerWidth - 320),
        });
        setToolsOpen(true);
        setToolsTab("critique");
        const el = document.getElementById(`critique-finding-${findingId}`);
        el?.scrollIntoView({ behavior: "smooth", block: "nearest" });
        return true;
      },
    },
    onUpdate: ({ editor: current }) => {
      if (!canEdit) return;
      setStatus("idle");
      setWordCount(countWords(current.getText()));
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        void persist(
          stripEditorOverlayMarksFromJson(current.getJSON()) as Record<string, unknown>,
          current.getText(),
        );
      }, 900);
    },
    onSelectionUpdate: ({ editor: current }) => {
      const { from, to } = current.state.selection;
      if (from === to) {
        setSelectionQuote("");
        return;
      }
      setSelectionQuote(current.state.doc.textBetween(from, to, "\n\n"));
    },
  });

  const editorRef = useRef(editor);
  editorRef.current = editor;

  useEffect(() => {
    if (!editor) return;
    editor.setEditable(canEdit);
  }, [canEdit, editor]);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        WRITE_PREFS_KEY,
        JSON.stringify({ focusMode, typewriter, fontScale, toolsOpen }),
      );
    } catch {
      /* ignore */
    }
  }, [focusMode, typewriter, fontScale, toolsOpen]);

  const findMatches = useMemo(() => {
    if (!editor || !findQuery.trim()) return [];
    return findTextMatches(editor, findQuery);
  }, [editor, findQuery, wordCount]);

  useEffect(() => {
    setFindIndex(0);
  }, [findQuery, chapter.id]);

  useEffect(() => {
    if (!findOpen || !editor || !findMatches.length) return;
    const match = findMatches[Math.min(findIndex, findMatches.length - 1)];
    if (match) selectMatch(editor, match);
    // Intentionally skip findMatches identity churn while typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, findOpen, findIndex, findQuery]);

  const liveSections = useMemo(
    () => extractSections(editor?.getText() || chapter.content_text || ""),
    [chapter.content_text, editor, wordCount],
  );

  useEffect(() => {
    if (!editor) return;
    applyReviewHighlights(editor, reviewComments);
  }, [editor, reviewComments, chapter.id]);

  useEffect(() => {
    if (!activeTrackChangeId) return;
    const comment = reviewComments.find((item) => item.id === activeTrackChangeId);
    if (!comment || comment.status !== "open" || comment.kind !== "suggestion") {
      setActiveTrackChangeId(null);
      setTrackBubbleAnchor(null);
    }
  }, [activeTrackChangeId, reviewComments]);

  useEffect(() => {
    if (!editor) return;
    applyCritiqueHighlights(editor, critiqueFindings, {
      chapterId: chapter.id,
      activeFindingId: activeCritiqueId,
    });
  }, [editor, critiqueFindings, activeCritiqueId, chapter.id]);

  const handleCommentsChange = useCallback((comments: ChapterCommentItem[]) => {
    setReviewComments(comments);
  }, []);

  const handleCritiqueFindingsChange = useCallback((findings: CriticalFinding[]) => {
    setCritiqueFindings(findings);
  }, []);

  const handleCritiqueResultChange = useCallback((next: CriticalReviewResult | null) => {
    setCritiqueResult(next);
  }, []);

  const handleCritiqueDismissedChange = useCallback((next: Set<string>) => {
    setCritiqueDismissed(next);
  }, []);

  const handleCritiqueFilterChange = useCallback((next: CritiqueFilterKey) => {
    setCritiqueFilter(next);
  }, []);

  useEffect(() => {
    setCritiqueResult(null);
    setCritiqueDismissed(new Set());
    setCritiqueFilter("all");
    setCritiqueFindings([]);
    setActiveCritiqueId(null);
    setActiveTrackChangeId(null);
    setTrackBubbleAnchor(null);
  }, [chapter.id]);

  const handleJumpToQuote = useCallback(
    (quote: string) => {
      if (!editor) return;
      const ok = jumpToQuote(editor, quote);
      if (!ok) toast.info(t("reviewPassageNotFound"));
    },
    [editor, t, toast],
  );

  const handleApplyCritiqueFix = useCallback(
    async (finding: CriticalFinding): Promise<boolean> => {
      if (!finding.suggested_fix) return false;
      const quote = finding.quote?.trim();
      if (!quote) return false;
      if (!editor) return false;
      const range = findQuoteRange(editor.state.doc, quote);
      if (!range) return false;

      editor
        .chain()
        .focus()
        .setTextSelection(range)
        .insertContent(finding.suggested_fix.trim())
        .run();
      setWordCount(countWords(editor.getText()));
      if (saveTimer.current) clearTimeout(saveTimer.current);
      await persist(
        stripEditorOverlayMarksFromJson(editor.getJSON()) as Record<string, unknown>,
        editor.getText(),
      );
      return true;
    },
    [editor],
  );

  const promoteCritiqueAsSuggestion = useCallback(
    async (finding: CriticalFinding) => {
      if (!finding.suggested_fix) return;
      const quote = finding.quote?.trim();
      if (!quote) return;
      const token = await getToken();
      await clientApiFetch(
        `/api/v1/books/${bookId}/chapters/${chapter.id}/comments`,
        token,
        {
          method: "POST",
          body: JSON.stringify({
            kind: "suggestion",
            quote,
            body: `[${t(`critiqueCat_${finding.category}`)}] ${finding.message}`,
            proposed_text: finding.suggested_fix.trim(),
          }),
        },
      );
      setReviewKey((k) => k + 1);
      setToolsTab("review");
      toast.success(t("critiquePromoted"));
    },
    [bookId, chapter.id, getToken, t, toast],
  );

  const updateTrackChangeStatus = useCallback(
    async (commentId: string, status: "accepted" | "rejected") => {
      setTrackBusy(true);
      try {
        const token = await getToken();
        await clientApiFetch(
          `/api/v1/books/${bookId}/chapters/${chapter.id}/comments/${commentId}`,
          token,
          { method: "PATCH", body: JSON.stringify({ status }) },
        );
        setActiveTrackChangeId(null);
        setTrackBubbleAnchor(null);
        setReviewKey((k) => k + 1);
        if (status === "accepted") {
          await reloadChapter();
        }
      } finally {
        setTrackBusy(false);
      }
    },
    [bookId, chapter.id, getToken],
  );

  useEffect(() => {
    chapterIdRef.current = chapter.id;
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    setTitleDraft(chapter.title || "");
    const words = countWords(chapter.content_text || "");
    setWordCount(words);
    setSessionBase(words);
    setWordGoal(loadChapterGoal(chapter.id));
    setAiCheckpoint(null);
    setFindQuery("");
    setFindOpen(false);
    if (!editor) return;
    if (loadedChapterId.current === chapter.id) {
      if (skipNextSync.current) {
        skipNextSync.current = false;
        return;
      }
    }
    loadedChapterId.current = chapter.id;
    editor.commands.setContent(docFromChapterContent(chapter));
  }, [chapter, editor]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [chat]);

  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      abortRef.current?.abort();
    };
  }, []);

  async function reloadChapter() {
    try {
      const token = await getToken();
      const list = await clientApiFetch<Chapter[]>(
        `/api/v1/books/${bookId}/chapters`,
        token,
      );
      const updated = list.find((item) => item.id === chapter.id);
      if (!updated) return;
      skipNextSync.current = true;
      onSaved?.(updated);
      if (editor) {
        editor.commands.setContent(docFromChapterContent(updated));
        setWordCount(countWords(updated.content_text || ""));
      }
      setReviewKey((k) => k + 1);
    } catch {
      toast.error(t("saveFailed"));
    }
  }

  async function persist(contentJson: Record<string, unknown>, contentText: string) {
    const chapterId = chapterIdRef.current;
    const gen = ++persistGen.current;
    setStatus("saving");
    try {
      const token = await getToken();
      const updated = await clientApiFetch<Chapter>(
        `/api/v1/books/${bookId}/chapters/${chapterId}`,
        token,
        {
          method: "PATCH",
          body: JSON.stringify({
            content_json: contentJson,
            content_text: contentText,
          }),
        },
      );
      if (gen !== persistGen.current || chapterId !== chapterIdRef.current) return;
      skipNextSync.current = true;
      onSaved?.(updated);
      setStatus("saved");
    } catch {
      if (gen === persistGen.current && chapterId === chapterIdRef.current) {
        setStatus("error");
      }
    }
  }

  function flushSave() {
    const current = editorRef.current;
    if (!canEdit || !current) return;
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    void persist(
      stripEditorOverlayMarksFromJson(current.getJSON()) as Record<string, unknown>,
      current.getText(),
    );
  }

  useEffect(() => {
    function onVis() {
      if (document.visibilityState === "hidden") flushSave();
    }
    function onBeforeUnload() {
      flushSave();
    }
    window.addEventListener("visibilitychange", onVis);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("beforeunload", onBeforeUnload);
      flushSave();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canEdit, bookId]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const meta = event.metaKey || event.ctrlKey;
      const tag = (event.target as HTMLElement | null)?.tagName;
      const typing =
        tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" ||
        (event.target as HTMLElement | null)?.isContentEditable;

      if (event.key === "Escape") {
        if (findOpen) {
          event.preventDefault();
          setFindOpen(false);
          return;
        }
        if (focusMode) {
          event.preventDefault();
          setFocusMode(false);
          return;
        }
      }

      if (meta && event.key.toLowerCase() === "f") {
        event.preventDefault();
        setFindOpen(true);
        return;
      }

      if (meta && event.key.toLowerCase() === "s") {
        event.preventDefault();
        flushSave();
        return;
      }

      if (!typing && (event.key === "f" || event.key === "F") && !meta && !event.altKey) {
        // Don't steal plain F while typing in editor (contenteditable)
        if ((event.target as HTMLElement | null)?.closest?.(".ProseMirror")) return;
      }

      if (meta && event.key === ".") {
        event.preventDefault();
        setFocusMode((v) => !v);
        return;
      }

      if (meta && event.shiftKey && event.key.toLowerCase() === "f") {
        event.preventDefault();
        setFocusMode((v) => !v);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [findOpen, focusMode, canEdit]);

  function promptWordGoal() {
    const raw = window.prompt(t("writeGoalPrompt"), wordGoal ? String(wordGoal) : "2000");
    if (raw === null) return;
    const next = Math.max(0, Math.round(Number(raw) || 0));
    setWordGoal(next);
    try {
      if (next > 0) window.localStorage.setItem(goalStorageKey(chapter.id), String(next));
      else window.localStorage.removeItem(goalStorageKey(chapter.id));
    } catch {
      /* ignore */
    }
  }

  function undoAiInsert() {
    if (!editor || !aiCheckpoint) return;
    editor.commands.setContent(aiCheckpoint);
    setAiCheckpoint(null);
    setWordCount(countWords(editor.getText()));
    flushSave();
    toast.info(t("writeAiUndone"));
  }

  async function saveTitle() {
    const next = titleDraft.trim();
    if (!next || next === chapter.title) return;
    try {
      const token = await getToken();
      const updated = await clientApiFetch<Chapter>(
        `/api/v1/books/${bookId}/chapters/${chapter.id}`,
        token,
        { method: "PATCH", body: JSON.stringify({ title: next }) },
      );
      onTitleSaved?.(updated);
      onSaved?.(updated);
      toast.success(t("notifyRenamed"));
    } catch (err) {
      toast.error(
        t("notifyRenameFailed"),
        err instanceof Error ? err.message : undefined,
      );
    }
  }

  async function saveKind(nextKind: string) {
    if (!canEdit || nextKind === chapter.kind) return;
    try {
      const token = await getToken();
      const updated = await clientApiFetch<Chapter>(
        `/api/v1/books/${bookId}/chapters/${chapter.id}`,
        token,
        { method: "PATCH", body: JSON.stringify({ kind: nextKind }) },
      );
      onTitleSaved?.(updated);
      onSaved?.(updated);
      toast.success(t("notifyKindChanged"));
    } catch (err) {
      toast.error(
        t("notifyKindFailed"),
        err instanceof Error ? err.message : undefined,
      );
    }
  }

  async function runAi(action: AiAction, promptOverride?: string) {
    if (!editor) return;
    if (!canEdit) return;
    if (!canUseAi) {
      toast.info(t("upgradeAi"));
      return;
    }
    if (aiQuota?.exceeded) {
      toast.error(t("aiQuotaExceeded"));
      return;
    }

    setToolsOpen(true);
    setToolsTab("ai");
    setAiCheckpoint(
      stripEditorOverlayMarksFromJson(editor.getJSON()) as Record<string, unknown>,
    );

    const selection = editor.state.doc.textBetween(
      editor.state.selection.from,
      editor.state.selection.to,
      "\n\n",
    );
    const fullText = editor.getText().trim();
    if (action === "finalize" && !fullText) {
      toast.error(t("finalizeNeedText"));
      return;
    }

    if (action === "consistent" && !selection.trim()) {
      toast.info(t("consistentNeedSelection"));
      return;
    }

    const prompt = (promptOverride ?? aiPrompt).trim();
    const context =
      action === "finalize"
        ? fullText.slice(-12000)
        : selection || fullText.slice(-8000);

    const userLabel =
      action === "generate"
        ? prompt || t("writeFromPrompt")
        : chips.find((c) => c.action === action)?.label || action;

    const assistantId = `a_${Date.now()}`;
    setChat((prev) => [
      ...prev,
      { id: `u_${Date.now()}`, role: "user", text: userLabel },
      { id: assistantId, role: "assistant", text: "", streaming: true },
    ]);
    setAiBusy(true);
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const replaceSelection =
      Boolean(selection) &&
      ["rewrite", "tone", "dialogue", "simplify", "consistent"].includes(action);

    const streamWriter = createEditorStreamWriter(editor, {
      replaceSelection,
      startEmpty: !replaceSelection && !fullText,
    });

    let assembled = "";
    try {
      const token = await getToken();
      await streamAiChapter(
        token,
        {
          book_id: bookId,
          chapter_id: chapter.id,
          action,
          prompt,
          selection: context,
        },
        (event) => {
          if (event.type === "delta") {
            assembled += event.text;
            streamWriter.append(event.text);
            setChat((prev) =>
              prev.map((item) =>
                item.id === assistantId
                  ? { ...item, text: assembled, streaming: true }
                  : item,
              ),
            );
          } else if (event.type === "start" && event.quota) {
            onQuotaChange?.(event.quota);
          } else if (event.type === "error") {
            throw new Error(event.error || t("aiFailed"));
          } else if (event.type === "done") {
            streamWriter.finish();
            if (event.quota) onQuotaChange?.(event.quota);
            setChat((prev) =>
              prev.map((item) =>
                item.id === assistantId
                  ? {
                      ...item,
                      text: event.text || assembled,
                      streaming: false,
                    }
                  : item,
              ),
            );
          }
        },
        controller.signal,
      );

      if (saveTimer.current) clearTimeout(saveTimer.current);
      await persist(
        stripEditorOverlayMarksFromJson(editor.getJSON()) as Record<string, unknown>,
        editor.getText(),
      );
      toast.success(action === "finalize" ? t("aiFinalized") : t("aiDone"));
      if (action === "generate") setAiPrompt("");
    } catch (err) {
      streamWriter.abort();
      if ((err as Error)?.name === "AbortError") return;
      const message = err instanceof Error ? err.message : t("aiFailed");
      if (message.includes("quota") || message.includes("402")) {
        toast.error(t("aiQuotaExceeded"), message);
      } else {
        toast.error(t("aiFailed"), message);
      }
      setChat((prev) =>
        prev.map((item) =>
          item.id === assistantId
            ? { ...item, text: message, streaming: false }
            : item,
        ),
      );
      setStatus("error");
    } finally {
      setAiBusy(false);
    }
  }

  const saveLabel =
    status === "saving"
      ? t("saving")
      : status === "saved"
        ? t("saved")
        : status === "error"
          ? t("saveFailed")
          : "";

  const activeTrackChange = useMemo(
    () => reviewComments.find((item) => item.id === activeTrackChangeId) ?? null,
    [activeTrackChangeId, reviewComments],
  );

  const activeCritiqueFinding = useMemo(
    () => critiqueFindings.find((item) => item.id === activeCritiqueId) ?? null,
    [activeCritiqueId, critiqueFindings],
  );

  const sessionDelta = wordCount - sessionBase;
  const manuscriptStyle = {
    "--write-font-scale": String(fontScale),
  } as CSSProperties;

  return (
    <div
      className="write-workspace"
      data-focus={focusMode ? "true" : "false"}
      data-typewriter={typewriter ? "true" : "false"}
      data-tools-open={toolsOpen ? "true" : "false"}
      data-workspace-mode={workspaceMode}
      style={manuscriptStyle}
    >
      <div className="editor-layout">
        <section className="editor-canvas" aria-label={t("editorCanvasLabel")}>
          <header className="editor-chrome">
            <div className="editor-chrome-top">
              <ChapterNavigator
                chapters={chapters}
                activeId={chapter.id}
                disabled={aiBusy || status === "saving"}
                onSelect={onSelectChapter}
                compact
              />
              <div className="editor-chrome-actions">
                {!canEdit ? (
                  <span className="read-only-pill">{t("readOnlyBadge")}</span>
                ) : null}
                {canEdit && saveLabel ? (
                  <span className="save-status" data-status={status}>
                    {saveLabel}
                  </span>
                ) : null}
                {aiCheckpoint ? (
                  <button
                    type="button"
                    className="btn btn-ghost btn-compact"
                    onClick={undoAiInsert}
                    title={t("writeAiUndoHint")}
                  >
                    {t("writeAiUndo")}
                  </button>
                ) : null}
                <button
                  type="button"
                  className="btn btn-ghost btn-compact"
                  data-active={findOpen}
                  onClick={() => setFindOpen((v) => !v)}
                  title={`${t("writeFind")} (Ctrl+F)`}
                >
                  {t("writeFind")}
                </button>
                <label className="write-comfort" title={t("writeFontSize")}>
                  <span className="sr-only">{t("writeFontSize")}</span>
                  <select
                    value={String(fontScale)}
                    onChange={(e) => setFontScale(Number(e.target.value))}
                  >
                    <option value="0.9">A−</option>
                    <option value="1">A</option>
                    <option value="1.15">A+</option>
                    <option value="1.3">A++</option>
                  </select>
                </label>
                <button
                  type="button"
                  className="btn btn-ghost btn-compact"
                  data-active={typewriter}
                  onClick={() => setTypewriter((v) => !v)}
                  aria-pressed={typewriter}
                  title={t("writeTypewriterHint")}
                >
                  {t("writeTypewriter")}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-compact"
                  data-active={focusMode}
                  onClick={() => setFocusMode((value) => !value)}
                  aria-pressed={focusMode}
                  title={`${t("focusEnter")} (Ctrl+Shift+F)`}
                >
                  {focusMode ? t("focusExit") : t("focusEnter")}
                </button>
                {!toolsOpen ? (
                  <button
                    type="button"
                    className="btn btn-ghost btn-compact"
                    onClick={() => setToolsOpen(true)}
                  >
                    {t("toolsOpen")}
                    {openReviewCount > 0 ? (
                      <span className="editor-tools-badge">{openReviewCount}</span>
                    ) : null}
                  </button>
                ) : null}
              </div>
            </div>

            <WriteStatsBar
              wordCount={wordCount}
              wordCountLabel={t("wordCount", { count: wordCount })}
              sessionLabel={t("writeSessionDelta", {
                delta: sessionDelta > 0 ? `+${sessionDelta}` : String(sessionDelta),
              })}
              goal={wordGoal}
              onSetGoal={promptWordGoal}
              labels={{
                setGoal: t("writeSetGoal"),
                goalProgress: t("writeGoalProgress"),
                goalReached: t("writeGoalReached"),
              }}
            />

            <div className="editor-chrome-title-row">
              <label className="editor-kind-field">
                <span className="sr-only">{t("sectionKind")}</span>
                <select
                  className={`kind-badge kind-badge-${chapter.kind} kind-select`}
                  value={chapter.kind}
                  disabled={!canEdit}
                  onChange={(e) => void saveKind(e.target.value)}
                  aria-label={t("sectionKind")}
                >
                  {CHAPTER_KINDS.map((kind) => (
                    <option key={kind} value={kind}>
                      {t(kindTranslationKey(kind))}
                    </option>
                  ))}
                </select>
              </label>
              <label className="editor-title-field">
                <span className="sr-only">{t("chapterName")}</span>
                <input
                  className="editor-title-input"
                  type="text"
                  value={titleDraft}
                  onChange={(e) => setTitleDraft(e.target.value)}
                  onBlur={() => void saveTitle()}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void saveTitle();
                    }
                  }}
                  placeholder={t("chapterNamePlaceholder")}
                  disabled={!canEdit}
                />
              </label>
            </div>

            <WriteFindBar
              open={findOpen}
              query={findQuery}
              matchCount={findMatches.length}
              activeIndex={findMatches.length ? Math.min(findIndex, findMatches.length - 1) : 0}
              onQueryChange={setFindQuery}
              onNext={() =>
                setFindIndex((i) => (findMatches.length ? (i + 1) % findMatches.length : 0))
              }
              onPrev={() =>
                setFindIndex((i) =>
                  findMatches.length ? (i - 1 + findMatches.length) % findMatches.length : 0,
                )
              }
              onClose={() => setFindOpen(false)}
              labels={{
                placeholder: t("writeFindPlaceholder"),
                next: t("writeFindNext"),
                prev: t("writeFindPrev"),
                close: t("writeFindClose"),
                none: t("writeFindNone"),
                of: t("writeFindOf"),
              }}
            />

            <WriteSelectionBar
              hasSelection={Boolean(selectionQuote)}
              labels={{
                hint:
                  workspaceMode === "review"
                    ? t("reviewSelectionHint")
                    : t("writeSelectionHint"),
                clear: t("writeClearSelection"),
              }}
              actions={
                workspaceMode === "review"
                  ? [
                      {
                        id: "critique",
                        label: t("reviewCritiqueSelection"),
                        primary: true,
                        hidden: !canUseAi,
                        onClick: () => {
                          setToolsOpen(true);
                          setToolsTab("critique");
                        },
                      },
                      {
                        id: "comment",
                        label: t("writeCommentSelection"),
                        hidden: !canEdit,
                        onClick: () => {
                          setToolsOpen(true);
                          setToolsTab("review");
                        },
                      },
                    ]
                  : [
                      {
                        id: "rewrite",
                        label: t("chipRewrite"),
                        hidden: !(canUseAi && canEdit),
                        onClick: () => void runAi("rewrite"),
                      },
                      {
                        id: "comment",
                        label: t("writeCommentSelection"),
                        hidden: !canEdit,
                        onClick: () => {
                          setToolsOpen(true);
                          setToolsTab("review");
                        },
                      },
                    ]
              }
              onClear={() => {
                setSelectionQuote("");
                editor?.chain().focus().setTextSelection(editor.state.selection.to).run();
              }}
            />

            <RichTextToolbar editor={editor} disabled={!canEdit} />
            {focusMode ? (
              <p className="muted write-focus-hint">{t("writeFocusHint")}</p>
            ) : null}
          </header>

          <div className="manuscript-page">
            <div className="editor-shell">
              <EditorContent editor={editor} />
            </div>
          </div>
        </section>

        {toolsOpen && !focusMode ? (
          <EditorToolsPanel
            activeTab={toolsTab}
            onTabChange={setToolsTab}
            onClose={() => setToolsOpen(false)}
            selectionActive={Boolean(selectionQuote)}
            openComments={openReviewCount}
            allowedTabs={editorToolTabs}
            aiSlot={
              <EditorAiPanel
                chips={chips}
                chat={chat}
                aiPrompt={aiPrompt}
                aiBusy={aiBusy}
                canUseAi={canUseAi}
                canEdit={canEdit}
                styleConfigured={styleConfigured}
                quota={aiQuota}
                chatEndRef={chatEndRef}
                onPromptChange={setAiPrompt}
                onRun={(action, prompt) => void runAi(action, prompt)}
                onStop={() => abortRef.current?.abort()}
              />
            }
            critiqueSlot={
              <CriticalReviewPanel
                bookId={bookId}
                chapterId={chapter.id}
                canUseAi={canUseAi}
                canEdit={canEdit}
                selectionQuote={selectionQuote}
                result={critiqueResult}
                dismissed={critiqueDismissed}
                filter={critiqueFilter}
                activeFindingId={activeCritiqueId}
                onResultChange={handleCritiqueResultChange}
                onDismissedChange={handleCritiqueDismissedChange}
                onFilterChange={handleCritiqueFilterChange}
                onJumpToQuote={handleJumpToQuote}
                onFindingsChange={handleCritiqueFindingsChange}
                onActiveFindingChange={setActiveCritiqueId}
                onApplyFix={handleApplyCritiqueFix}
                onOpenChapter={onSelectChapter}
                onPromoted={() => {
                  setReviewKey((k) => k + 1);
                  setToolsTab("review");
                }}
              />
            }
            reviewSlot={
              <ChapterReviewPanel
                key={reviewKey}
                embedded
                bookId={bookId}
                chapterId={chapter.id}
                canEdit={canEdit}
                selectionQuote={selectionQuote}
                onRestored={() => void reloadChapter()}
                onClearSelection={() => setSelectionQuote("")}
                onMeta={({ openCount }) => setOpenReviewCount(openCount)}
                onCommentsChange={handleCommentsChange}
                onJumpToQuote={handleJumpToQuote}
                activeCommentId={activeTrackChangeId}
                currentChapterText={editor?.getText() || chapter.content_text || ""}
              />
            }
            structureSlot={
              <ChapterOutline
                embedded
                sections={liveSections}
                onJump={(section) => {
                  if (editor) jumpToSection(editor, section);
                }}
              />
            }
          />
        ) : null}
      </div>

      {activeTrackChange && trackBubbleAnchor ? (
        <TrackChangeBubble
          comment={activeTrackChange}
          anchor={trackBubbleAnchor}
          canEdit={canEdit}
          busy={trackBusy}
          onAccept={(commentId) => void updateTrackChangeStatus(commentId, "accepted")}
          onReject={(commentId) => void updateTrackChangeStatus(commentId, "rejected")}
          onClose={() => {
            setActiveTrackChangeId(null);
            setTrackBubbleAnchor(null);
          }}
        />
      ) : null}

      {activeCritiqueFinding && critiqueBubbleAnchor ? (
        <CritiqueFindingBubble
          finding={activeCritiqueFinding}
          anchor={critiqueBubbleAnchor}
          canEdit={canEdit}
          busy={critiqueBubbleBusy}
          onJump={() => handleJumpToQuote(activeCritiqueFinding.quote)}
          onApply={() => {
            setCritiqueBubbleBusy(true);
            void handleApplyCritiqueFix(activeCritiqueFinding)
              .then((ok) => {
                if (ok) {
                  const next = new Set(critiqueDismissed);
                  next.add(activeCritiqueFinding.id);
                  setCritiqueDismissed(next);
                  if (critiqueResult?.job_id) {
                    saveCritiqueDismissed(critiqueResult.job_id, next);
                  }
                  setCritiqueBubbleAnchor(null);
                  toast.success(t("critiqueFixApplied"));
                } else {
                  toast.error(t("reviewPassageNotFound"));
                }
              })
              .finally(() => setCritiqueBubbleBusy(false));
          }}
          onSuggest={() => {
            setCritiqueBubbleBusy(true);
            void promoteCritiqueAsSuggestion(activeCritiqueFinding)
              .catch((err) =>
                toast.error(
                  err instanceof Error ? err.message : t("critiquePromoteFailed"),
                ),
              )
              .finally(() => {
                setCritiqueBubbleBusy(false);
                setCritiqueBubbleAnchor(null);
              });
          }}
          onDismiss={() => {
            const next = new Set(critiqueDismissed);
            next.add(activeCritiqueFinding.id);
            setCritiqueDismissed(next);
            if (critiqueResult?.job_id) {
              saveCritiqueDismissed(critiqueResult.job_id, next);
            }
            setCritiqueBubbleAnchor(null);
            setActiveCritiqueId(null);
          }}
          onClose={() => setCritiqueBubbleAnchor(null)}
        />
      ) : null}
    </div>
  );
}
