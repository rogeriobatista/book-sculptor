"use client";

import { useTranslations } from "next-intl";
import { type ChapterSection } from "@/lib/chapter-structure";

type Props = {
  sections: ChapterSection[];
  onJump: (section: ChapterSection) => void;
  embedded?: boolean;
};

export function ChapterOutline({ sections, onJump, embedded = false }: Props) {
  const t = useTranslations("studio");
  const className = embedded ? "write-outline write-outline-embedded" : "write-outline";

  if (!sections.length) {
    return (
      <div className={className}>
        <p className="muted write-outline-empty-text">{t("outlineEmpty")}</p>
        <p className="muted write-outline-tip">{t("outlineTip")}</p>
      </div>
    );
  }

  return (
    <nav className={className} aria-label={t("outlineTitle")}>
      <ol className="write-outline-list">
        {sections.map((section, index) => (
          <li key={section.id}>
            <button
              type="button"
              className="write-outline-item"
              onClick={() => onJump(section)}
            >
              <span className="write-outline-index">{index + 1}</span>
              <span className="write-outline-label">{section.title}</span>
            </button>
          </li>
        ))}
      </ol>
    </nav>
  );
}
