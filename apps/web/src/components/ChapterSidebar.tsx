"use client";

import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { ConfirmModal } from "@/components/ConfirmModal";
import { type Chapter } from "@/lib/client-api";
import { useDebouncedValue } from "@/lib/use-debounce";
import {
  ADD_SECTION_GROUPS,
  buildChapterTree,
  chapterShortTitle,
  filterChapterIdsWithAncestors,
  flattenChapterTree,
  kindTranslationKey,
  sectionKindShowsIndex,
  type ChapterKind,
} from "@/lib/chapter-structure";

type Props = {
  chapters: Chapter[];
  activeId: string | null;
  busy?: boolean;
  readOnly?: boolean;
  onSelect: (id: string) => void;
  onAddSection: (kind: ChapterKind, parentId?: string | null) => void;
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

function ChapterSidebarTitle({ text }: { text: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [truncated, setTruncated] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const measure = () => {
      setTruncated(element.scrollWidth > element.clientWidth + 1);
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [text]);

  return (
    <span
      ref={ref}
      className="chapter-sidebar-title"
      title={truncated ? text : undefined}
    >
      {text}
    </span>
  );
}

export function ChapterSidebar({
  chapters,
  activeId,
  busy = false,
  readOnly = false,
  onSelect,
  onAddSection,
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
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const menuRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const addMenuRef = useRef<HTMLDivElement>(null);
  const debouncedFilter = useDebouncedValue(filter.trim().toLowerCase(), 300);

  const openMenuChapter = useMemo(
    () => (openMenuId ? items.find((chapter) => chapter.id === openMenuId) ?? null : null),
    [items, openMenuId],
  );

  function closeChapterMenu() {
    setOpenMenuId(null);
    setMenuPos(null);
  }

  function openChapterMenu(chapterId: string, anchor: HTMLElement) {
    const rect = anchor.getBoundingClientRect();
    const panelWidth = 152;
    const left = Math.max(8, Math.min(rect.right - panelWidth, window.innerWidth - panelWidth - 8));
    setMenuPos({ top: rect.bottom + 4, left });
    setOpenMenuId(chapterId);
  }

  useEffect(() => {
    if (!openMenuId && !addMenuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (openMenuId) {
        const menuEl = menuRefs.current.get(openMenuId);
        if (menuEl?.contains(target)) return;
      }
      if (addMenuOpen && addMenuRef.current?.contains(target)) return;
      closeChapterMenu();
      setAddMenuOpen(false);
    };
    const onReposition = () => closeChapterMenu();
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("resize", onReposition);
    window.addEventListener("scroll", onReposition, true);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("resize", onReposition);
      window.removeEventListener("scroll", onReposition, true);
    };
  }, [openMenuId, addMenuOpen]);

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
      <div className="chapter-sidebar-toolbar">
        <div className="chapter-sidebar-head">
          <div className="chapter-sidebar-head-copy">
            <h2>{t("chaptersNav")}</h2>
            {items.length > 0 ? (
              <span className="chapter-sidebar-count" aria-label={t("chapterCount", { count: items.length })}>
                {items.length}
              </span>
            ) : null}
          </div>
          {items.length > 1 && !readOnly ? (
            <p className="chapter-sidebar-meta muted">{t("reorderHint")}</p>
          ) : null}
        </div>

        {!readOnly ? (
          <div className="chapter-add-menu" ref={addMenuRef}>
            <button
              type="button"
              className="btn btn-primary btn-compact chapter-add-trigger"
              disabled={busy}
              aria-expanded={addMenuOpen}
              aria-haspopup="menu"
              aria-label={t("addSectionMenuLabel")}
              onClick={() => {
                setAddMenuOpen((open) => !open);
                closeChapterMenu();
              }}
            >
              <span>+ {t("addSection")}</span>
              <span className="chapter-add-chevron" aria-hidden="true">
                ▾
              </span>
            </button>
            {addMenuOpen ? (
              <div className="chapter-add-panel" role="menu" aria-label={t("addSectionMenuLabel")}>
                {ADD_SECTION_GROUPS.map((group) => (
                  <div key={group.labelKey} className="chapter-add-group">
                    <p className="chapter-add-group-label">{t(group.labelKey)}</p>
                    <div className="chapter-add-group-items">
                      {group.kinds.map((kind) => (
                        <button
                          key={kind}
                          type="button"
                          className="chapter-add-item"
                          role="menuitem"
                          disabled={busy}
                          onClick={() => {
                            setAddMenuOpen(false);
                            onAddSection(kind);
                          }}
                        >
                          <span className={`kind-badge kind-badge-${kind}`}>
                            {t(kindTranslationKey(kind))}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      {items.length >= 3 ? (
        <label className="chapter-sidebar-filter">
          <span className="chapter-sidebar-filter-icon" aria-hidden="true">
            ⌕
          </span>
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
            const displayTitle = chapterShortTitle(chapter) || t("chapter");
            const menuOpen = openMenuId === chapter.id;
            return (
              <li
                key={chapter.id}
                className="chapter-sidebar-item-wrap"
                data-active={active}
                data-kind={chapter.kind}
                data-menu-open={menuOpen}
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
                    {!readOnly ? (
                      <span
                        className="chapter-drag-handle"
                        title={t("dragChapter")}
                        aria-hidden="true"
                      >
                        ⠿
                      </span>
                    ) : null}
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
                    ) : null}
                    <button
                      type="button"
                      className="chapter-sidebar-item"
                      onClick={() => onSelect(chapter.id)}
                    >
                      <span className={`kind-badge kind-badge-${chapter.kind}`}>
                        {t(kindTranslationKey(chapter.kind))}
                        {sectionKindShowsIndex(chapter.kind) && chapter.number
                          ? ` ${chapter.number}`
                          : sectionKindShowsIndex(chapter.kind)
                            ? ` ${index + 1}`
                            : ""}
                      </span>
                      <ChapterSidebarTitle text={displayTitle} />
                    </button>
                    {!readOnly ? (
                      <div
                        className="chapter-item-menu"
                        onPointerDown={(event) => event.stopPropagation()}
                      >
                        <button
                          type="button"
                          className="chapter-menu-trigger"
                          aria-label={t("chapterMoreActions")}
                          aria-expanded={menuOpen}
                          aria-haspopup="menu"
                          disabled={busy}
                          onPointerDown={(event) => event.stopPropagation()}
                          onClick={(event) => {
                            event.stopPropagation();
                            if (menuOpen) closeChapterMenu();
                            else openChapterMenu(chapter.id, event.currentTarget);
                          }}
                        >
                          ⋯
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
        <footer className="chapter-sidebar-foot">
          <button
            type="button"
            className="chapter-sidebar-danger"
            disabled={busy}
            onClick={() => setPendingDeleteAll(true)}
          >
            {t("deleteAllChapters")}
          </button>
        </footer>
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

      {openMenuId && menuPos && openMenuChapter && typeof document !== "undefined"
        ? createPortal(
            <div
              className="chapter-menu-panel chapter-menu-panel-portal"
              role="menu"
              style={{ top: menuPos.top, left: menuPos.left }}
              ref={(element) => {
                if (element) menuRefs.current.set(openMenuId, element);
                else menuRefs.current.delete(openMenuId);
              }}
              onPointerDown={(event) => event.stopPropagation()}
            >
              {openMenuChapter.kind === "part" ? (
                <button
                  type="button"
                  className="chapter-menu-item"
                  role="menuitem"
                  disabled={busy}
                  onClick={() => {
                    closeChapterMenu();
                    onAddSection("chapter", openMenuChapter.id);
                  }}
                >
                  {t("addChapterToPart")}
                </button>
              ) : null}
              <button
                type="button"
                className="chapter-menu-item"
                role="menuitem"
                disabled={busy}
                onClick={() => {
                  closeChapterMenu();
                  setEditingId(openMenuChapter.id);
                  setDraft(openMenuChapter.title || "");
                }}
              >
                {t("renameChapter")}
              </button>
              <button
                type="button"
                className="chapter-menu-item chapter-menu-item-danger"
                role="menuitem"
                disabled={busy}
                onClick={() => {
                  closeChapterMenu();
                  setPendingDelete(openMenuChapter);
                }}
              >
                {t("deleteChapter")}
              </button>
            </div>,
            document.body,
          )
        : null}
    </aside>
  );
}
