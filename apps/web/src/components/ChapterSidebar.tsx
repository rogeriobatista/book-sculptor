"use client";

import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { ConfirmModal } from "@/components/ConfirmModal";
import { type Chapter } from "@/lib/client-api";
import { useDebouncedValue } from "@/lib/use-debounce";
import {
  buildChapterTree,
  chapterDisplayLabel,
  chapterShortTitle,
  filterChapterIdsWithAncestors,
  flattenChapterTree,
  kindTranslationKey,
} from "@/lib/chapter-structure";

type Props = {
  chapters: Chapter[];
  activeId: string | null;
  busy?: boolean;
  readOnly?: boolean;
  onSelect: (id: string) => void;
  onAddChapter: (parentId?: string | null) => void;
  onAddPart: () => void;
  onRename: (id: string, title: string) => Promise<void> | void;
  onDelete: (id: string) => Promise<void> | void;
  onDeleteAll: () => Promise<void> | void;
  onReorder: (orderedIds: string[]) => Promise<void> | void;
};

function moveChapter(list: Chapter[], fromId: string, toId: string): Chapter[] {
  const from = list.findIndex((chapter) => chapter.id === fromId);
  const to = list.findIndex((chapter) => chapter.id === toId);
  if (from < 0 || to < 0 || from === to) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

export function ChapterSidebar({
  chapters,
  activeId,
  busy = false,
  readOnly = false,
  onSelect,
  onAddChapter,
  onAddPart,
  onRename,
  onDelete,
  onDeleteAll,
  onReorder,
}: Props) {
  const t = useTranslations("studio");
  const common = useTranslations("common");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [pendingDelete, setPendingDelete] = useState<Chapter | null>(null);
  const [pendingDeleteAll, setPendingDeleteAll] = useState(false);
  const [items, setItems] = useState(chapters);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [collapsedParts, setCollapsedParts] = useState<Set<string>>(() => new Set());
  const debouncedFilter = useDebouncedValue(filter.trim().toLowerCase(), 300);

  useEffect(() => {
    setItems(chapters);
  }, [chapters]);

  const visibleIds = useMemo(
    () => filterChapterIdsWithAncestors(items, debouncedFilter),
    [debouncedFilter, items],
  );

  const treeRows = useMemo(() => {
    const roots = buildChapterTree(items);
    return flattenChapterTree(roots, collapsedParts, visibleIds);
  }, [collapsedParts, items, visibleIds]);

  const pendingTitle =
    pendingDelete?.title || pendingDelete?.full_label || t("chapter");

  function endDrag() {
    setDragId(null);
    setOverId(null);
  }

  function togglePart(partId: string) {
    setCollapsedParts((prev) => {
      const next = new Set(prev);
      if (next.has(partId)) next.delete(partId);
      else next.add(partId);
      return next;
    });
  }

  return (
    <aside className="chapter-sidebar">
      <div className="chapter-sidebar-head">
        <h2>{t("chaptersNav")}</h2>
        {!readOnly ? (
          <div className="chapter-sidebar-head-actions">
            <button
              type="button"
              className="btn btn-ghost btn-compact"
              disabled={busy}
              onClick={onAddPart}
              title={t("newPart")}
            >
              + {t("newPart")}
            </button>
            <button
              type="button"
              className="btn btn-primary btn-compact chapter-add-btn"
              disabled={busy}
              onClick={() => onAddChapter(null)}
              title={t("newChapter")}
            >
              + {t("newChapter")}
            </button>
          </div>
        ) : null}
      </div>

      {items.length > 1 && !readOnly ? (
        <p className="muted chapter-reorder-hint">{t("reorderHint")}</p>
      ) : null}

      {items.length > 4 ? (
        <label className="chapter-sidebar-filter">
          <span className="sr-only">{t("filterChapters")}</span>
          <input
            type="search"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={t("filterChaptersPlaceholder")}
            autoComplete="off"
          />
        </label>
      ) : null}

      {items.length === 0 ? (
        <p className="muted chapter-sidebar-empty">{t("emptyChapters")}</p>
      ) : treeRows.length === 0 ? (
        <p className="muted chapter-sidebar-empty">{t("filterChaptersEmpty")}</p>
      ) : (
        <ul className="chapter-sidebar-list">
          {treeRows.map(({ node, depth }, index) => {
            const chapter = node.chapter;
            const active = chapter.id === activeId;
            const editing = editingId === chapter.id;
            const dragging = dragId === chapter.id;
            const dropTarget = overId === chapter.id && dragId !== chapter.id;
            const isPart = chapter.kind === "part";
            const collapsed = isPart && collapsedParts.has(chapter.id);
            return (
              <li
                key={chapter.id}
                className="chapter-sidebar-item-wrap"
                data-active={active}
                data-dragging={dragging}
                data-drop-target={dropTarget}
                data-depth={depth}
                style={{ "--chapter-depth": depth } as CSSProperties}
                draggable={!readOnly && !busy && !editing}
                onDragStart={(event) => {
                  if (busy || editing) {
                    event.preventDefault();
                    return;
                  }
                  setDragId(chapter.id);
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData("text/plain", chapter.id);
                }}
                onDragEnd={endDrag}
                onDragOver={(event) => {
                  if (!dragId || dragId === chapter.id) return;
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                  if (overId !== chapter.id) setOverId(chapter.id);
                }}
                onDragLeave={() => {
                  if (overId === chapter.id) setOverId(null);
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  const fromId = dragId || event.dataTransfer.getData("text/plain");
                  endDrag();
                  if (!fromId || fromId === chapter.id || busy) return;
                  const next = moveChapter(items, fromId, chapter.id);
                  const order = next.map((item) => item.id);
                  if (order.join() === items.map((item) => item.id).join()) return;
                  setItems(next);
                  void onReorder(order);
                }}
              >
                {editing ? (
                  <form
                    className="chapter-inline-form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void onRename(chapter.id, draft);
                      setEditingId(null);
                    }}
                  >
                    <input
                      autoFocus
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      disabled={busy}
                    />
                    <button type="submit" className="btn btn-primary btn-compact" disabled={busy}>
                      {common("save")}
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-compact"
                      onClick={() => setEditingId(null)}
                    >
                      {common("cancel")}
                    </button>
                  </form>
                ) : (
                  <>
                    <div className="chapter-sidebar-row">
                      {isPart ? (
                        <button
                          type="button"
                          className="chapter-part-toggle"
                          aria-expanded={!collapsed}
                          aria-label={collapsed ? t("expandPart") : t("collapsePart")}
                          onClick={() => togglePart(chapter.id)}
                        >
                          {collapsed ? "▸" : "▾"}
                        </button>
                      ) : (
                        <span className="chapter-part-toggle-spacer" aria-hidden="true" />
                      )}
                      {!readOnly ? (
                        <span
                          className="chapter-drag-handle"
                          title={t("dragChapter")}
                          aria-hidden="true"
                        >
                          ⋮⋮
                        </span>
                      ) : null}
                      <button
                        type="button"
                        className="chapter-sidebar-item"
                        onClick={() => onSelect(chapter.id)}
                      >
                        <span className="chapter-index">
                          {chapter.number ?? index + 1}
                        </span>
                        <span className="chapter-sidebar-copy">
                          <span className={`kind-badge kind-badge-${chapter.kind}`}>
                            {t(kindTranslationKey(chapter.kind))}
                          </span>
                          <span className="chapter-sidebar-title">
                            {chapterShortTitle(chapter) || t("chapter")}
                          </span>
                          {chapter.full_label &&
                          chapter.full_label !== chapterShortTitle(chapter) ? (
                            <span className="muted chapter-sidebar-sub">
                              {chapterDisplayLabel(chapter)}
                            </span>
                          ) : null}
                        </span>
                      </button>
                    </div>
                    {!readOnly ? (
                      <div className="chapter-sidebar-actions">
                        {isPart ? (
                          <button
                            type="button"
                            className="btn btn-ghost btn-compact"
                            disabled={busy}
                            onClick={() => onAddChapter(chapter.id)}
                          >
                            {t("addChapterToPart")}
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="btn btn-ghost btn-compact"
                          disabled={busy}
                          onClick={() => {
                            setEditingId(chapter.id);
                            setDraft(chapter.title || "");
                          }}
                        >
                          {t("renameChapter")}
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost btn-compact danger"
                          disabled={busy}
                          onClick={() => setPendingDelete(chapter)}
                        >
                          {t("deleteChapter")}
                        </button>
                      </div>
                    ) : null}
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {!readOnly && items.length > 0 ? (
        <button
          type="button"
          className="chapter-sidebar-footer danger-link"
          disabled={busy}
          onClick={() => setPendingDeleteAll(true)}
        >
          {t("deleteAllChapters")}
        </button>
      ) : null}

      <ConfirmModal
        open={Boolean(pendingDelete)}
        title={t("deleteChapterTitle")}
        description={t("deleteChapterConfirm", { title: pendingTitle })}
        confirmLabel={t("deleteChapter")}
        cancelLabel={common("cancel")}
        busy={busy}
        danger
        onClose={() => {
          if (!busy) setPendingDelete(null);
        }}
        onConfirm={() => {
          if (!pendingDelete) return;
          const id = pendingDelete.id;
          setPendingDelete(null);
          void onDelete(id);
        }}
      />

      <ConfirmModal
        open={pendingDeleteAll}
        title={t("deleteAllChaptersTitle")}
        description={t("deleteAllChaptersConfirm", { count: items.length })}
        confirmLabel={t("deleteAllChapters")}
        cancelLabel={common("cancel")}
        busy={busy}
        danger
        onClose={() => {
          if (!busy) setPendingDeleteAll(false);
        }}
        onConfirm={() => {
          setPendingDeleteAll(false);
          void onDeleteAll();
        }}
      />
    </aside>
  );
}
