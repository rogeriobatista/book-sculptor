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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChapterNavigator } from "@/components/ChapterNavigator";
import { ChapterOutline } from "@/components/ChapterOutline";
import {
  ChapterReviewPanel,
  type ChapterCommentItem,
} from "@/components/ChapterReviewPanel";
import { EditorAiPanel } from "@/components/EditorAiPanel";
import { CriticalReviewPanel } from "@/components/CriticalReviewPanel";
import { EditorToolsPanel, type EditorToolsTab } from "@/components/EditorToolsPanel";
import { RichTextToolbar } from "@/components/RichTextToolbar";
import { useToast } from "@/components/ToastProvider";
import { type Chapter, clientApiFetch } from "@/lib/client-api";
import {
  CHAPTER_KINDS,
  countWords,
  docFromChapterContent,
  extractSections,
  kindTranslationKey,
  type ChapterSection,
} from "@/lib/chapter-structure";
import { streamAiChapter } from "@/lib/ai-stream";
import {
  applyReviewHighlights,
  jumpToQuote,
  ReviewHighlight,
  stripReviewMarksFromJson,
} from "@/lib/review-highlight";
import { useAppAuth } from "@/lib/use-app-auth";

type AiAction =
  | "generate"
  | "continue"
  | "rewrite"
  | "tone"
  | "dialogue"
  | "simplify"
  | "finalize";

type ChatItem = {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  streaming?: boolean;
};

type Props = {
  bookId: string;
  chapter: Chapter;
  chapters: Chapter[];
  canUseAi: boolean;
  canEdit?: boolean;
  onSelectChapter: (id: string) => void;
  onSaved?: (chapter: Chapter) => void;
  onTitleSaved?: (chapter: Chapter) => void;
};

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function insertStreamDelta(editor: NonNullable<ReturnType<typeof useEditor>>, delta: string) {
  if (!delta) return;
  const html = escapeHtml(delta).replace(/\n/g, "<br>");
  editor.chain().focus("end").insertContent(html).run();
}

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
  chapter,
  chapters,
  canUseAi,
  canEdit = true,
  onSelectChapter,
  onSaved,
  onTitleSaved,
}: Props) {
  const { getToken } = useAppAuth();
  const toast = useToast();
  const t = useTranslations("studio");
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiPrompt, setAiPrompt] = useState("");
  const [titleDraft, setTitleDraft] = useState(chapter.title || "");
  const [chat, setChat] = useState<ChatItem[]>([]);
  const [wordCount, setWordCount] = useState(() => countWords(chapter.content_text || ""));
  const [selectionQuote, setSelectionQuote] = useState("");
  const [reviewKey, setReviewKey] = useState(0);
  const [toolsOpen, setToolsOpen] = useState(true);
  const [focusMode, setFocusMode] = useState(false);
  const [toolsTab, setToolsTab] = useState<EditorToolsTab>("ai");
  const [openReviewCount, setOpenReviewCount] = useState(0);
  const [reviewComments, setReviewComments] = useState<ChapterCommentItem[]>([]);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipNextSync = useRef(false);
  const loadedChapterId = useRef<string | null>(null);
  const chapterIdRef = useRef(chapter.id);
  const persistGen = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  const chips: { action: AiAction; label: string; prompt?: string }[] = [
    { action: "continue", label: t("chipContinue") },
    { action: "dialogue", label: t("chipDialogue") },
    { action: "simplify", label: t("chipSimplify") },
    { action: "tone", label: t("chipWarm"), prompt: t("promptWarm") },
    { action: "rewrite", label: t("chipRewrite") },
    { action: "finalize", label: t("chipFinalize") },
  ];

  const initialDoc = useMemo(() => docFromChapterContent(chapter), [chapter]);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
      }),
      Underline,
      ReviewHighlight,
      Highlight.configure({ multicolor: false }),
      Link.configure({ openOnClick: false }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      Placeholder.configure({ placeholder: t("editorPlaceholder") }),
      CharacterCount,
    ],
    content: initialDoc,
    editable: canEdit,
    immediatelyRender: false,
    onUpdate: ({ editor: current }) => {
      if (!canEdit) return;
      setStatus("idle");
      setWordCount(countWords(current.getText()));
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        void persist(
          stripReviewMarksFromJson(current.getJSON()) as Record<string, unknown>,
          current.getText(),
        );
      }, 900);
    },
    onSelectionUpdate: ({ editor: current }) => {
      const { from, to } = current.state.selection;
      if (from === to) return;
      setSelectionQuote(current.state.doc.textBetween(from, to, "\n\n"));
    },
  });

  useEffect(() => {
    if (!editor) return;
    editor.setEditable(canEdit);
  }, [canEdit, editor]);

  const liveSections = useMemo(
    () => extractSections(editor?.getText() || chapter.content_text || ""),
    [chapter.content_text, editor, wordCount],
  );

  useEffect(() => {
    if (!editor) return;
    applyReviewHighlights(editor, reviewComments);
  }, [editor, reviewComments, chapter.id]);

  const handleCommentsChange = useCallback((comments: ChapterCommentItem[]) => {
    setReviewComments(comments);
  }, []);

  const handleJumpToQuote = useCallback(
    (quote: string) => {
      if (!editor) return;
      const ok = jumpToQuote(editor, quote);
      if (!ok) toast.info(t("reviewPassageNotFound"));
    },
    [editor, t, toast],
  );

  useEffect(() => {
    if (!selectionQuote) return;
    setToolsOpen(true);
    setToolsTab("review");
  }, [selectionQuote]);

  useEffect(() => {
    chapterIdRef.current = chapter.id;
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    setTitleDraft(chapter.title || "");
    setWordCount(countWords(chapter.content_text || ""));
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

    setToolsOpen(true);
    setToolsTab("ai");

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

    const prompt = (promptOverride ?? aiPrompt).trim();
    const context =
      action === "finalize"
        ? fullText.slice(-12000)
        : selection || fullText.slice(-1600);

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
      ["rewrite", "tone", "dialogue", "simplify"].includes(action);

    if (replaceSelection) {
      editor.chain().focus().deleteSelection().run();
    } else if (!fullText) {
      editor.chain().focus("start").clearContent().run();
    } else {
      editor.chain().focus("end").run();
    }

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
            insertStreamDelta(editor, event.text);
            setChat((prev) =>
              prev.map((item) =>
                item.id === assistantId
                  ? { ...item, text: assembled, streaming: true }
                  : item,
              ),
            );
          } else if (event.type === "error") {
            throw new Error(event.error || t("aiFailed"));
          } else if (event.type === "done") {
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
        stripReviewMarksFromJson(editor.getJSON()) as Record<string, unknown>,
        editor.getText(),
      );
      toast.success(action === "finalize" ? t("aiFinalized") : t("aiDone"));
      if (action === "generate") setAiPrompt("");
    } catch (err) {
      if ((err as Error)?.name === "AbortError") return;
      const message = err instanceof Error ? err.message : t("aiFailed");
      setChat((prev) =>
        prev.map((item) =>
          item.id === assistantId
            ? { ...item, text: message, streaming: false }
            : item,
        ),
      );
      toast.error(t("aiFailed"), message);
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

  return (
    <div
      className="write-workspace"
      data-focus={focusMode ? "true" : "false"}
      data-tools-open={toolsOpen ? "true" : "false"}
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
                <span className="editor-stat">{t("wordCount", { count: wordCount })}</span>
                {canEdit && saveLabel ? (
                  <span className="save-status" data-status={status}>
                    {saveLabel}
                  </span>
                ) : null}
                <button
                  type="button"
                  className="btn btn-ghost btn-compact"
                  data-active={focusMode}
                  onClick={() => setFocusMode((value) => !value)}
                  aria-pressed={focusMode}
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

            <RichTextToolbar editor={editor} disabled={!canEdit} />
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
            aiSlot={
              <EditorAiPanel
                chips={chips}
                chat={chat}
                aiPrompt={aiPrompt}
                aiBusy={aiBusy}
                canUseAi={canUseAi}
                canEdit={canEdit}
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
                onJumpToQuote={handleJumpToQuote}
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
    </div>
  );
}
