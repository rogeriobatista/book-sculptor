"use client";

import { useTranslations } from "next-intl";
import { type Chapter } from "@/lib/client-api";
import { chapterDisplayLabel } from "@/lib/chapter-structure";

type Props = {
  chapters: Chapter[];
  activeId: string;
  disabled?: boolean;
  compact?: boolean;
  onSelect: (id: string) => void;
};

export function ChapterNavigator({
  chapters,
  activeId,
  disabled = false,
  compact = false,
  onSelect,
}: Props) {
  const t = useTranslations("studio");
  const index = chapters.findIndex((chapter) => chapter.id === activeId);
  const prev = index > 0 ? chapters[index - 1] : null;
  const next = index >= 0 && index < chapters.length - 1 ? chapters[index + 1] : null;

  return (
    <div className="chapter-navigator" data-compact={compact ? "true" : "false"}>
      <button
        type="button"
        className="btn btn-ghost btn-compact chapter-nav-btn"
        disabled={disabled || !prev}
        onClick={() => prev && onSelect(prev.id)}
        aria-label={t("prevChapter")}
      >
        {compact ? "←" : `← ${t("prevChapter")}`}
      </button>

      <label className="chapter-switcher">
        <span className="sr-only">{t("jumpChapter")}</span>
        <select
          value={activeId}
          disabled={disabled}
          onChange={(event) => onSelect(event.target.value)}
          aria-label={t("jumpChapter")}
        >
          {chapters.map((chapter, i) => (
            <option key={chapter.id} value={chapter.id}>
              {i + 1}. {chapterDisplayLabel(chapter) || t("chapter")}
            </option>
          ))}
        </select>
      </label>

      <button
        type="button"
        className="btn btn-ghost btn-compact chapter-nav-btn"
        disabled={disabled || !next}
        onClick={() => next && onSelect(next.id)}
        aria-label={t("nextChapter")}
      >
        {compact ? "→" : `${t("nextChapter")} →`}
      </button>
    </div>
  );
}
