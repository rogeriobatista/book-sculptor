"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

export type EditorToolsTab = "ai" | "critique" | "review" | "structure";

type Props = {
  activeTab: EditorToolsTab;
  onTabChange: (tab: EditorToolsTab) => void;
  onClose: () => void;
  selectionActive: boolean;
  openComments: number;
  aiSlot: ReactNode;
  critiqueSlot: ReactNode;
  reviewSlot: ReactNode;
  structureSlot: ReactNode;
};

export function EditorToolsPanel({
  activeTab,
  onTabChange,
  onClose,
  selectionActive,
  openComments,
  aiSlot,
  critiqueSlot,
  reviewSlot,
  structureSlot,
}: Props) {
  const t = useTranslations("studio");

  const tabs: { id: EditorToolsTab; label: string; hint: string; badge?: number }[] = [
    { id: "ai", label: t("toolsTabAi"), hint: t("toolsTabAiHint") },
    {
      id: "critique",
      label: t("toolsTabCritique"),
      hint: t("toolsTabCritiqueHint"),
    },
    {
      id: "review",
      label: t("toolsTabReview"),
      hint: t("toolsTabReviewHint"),
      badge: openComments > 0 ? openComments : undefined,
    },
    { id: "structure", label: t("toolsTabStructure"), hint: t("toolsTabStructureHint") },
  ];

  const active = tabs.find((item) => item.id === activeTab);

  return (
    <aside className="editor-tools-panel" aria-label={t("toolsPanelLabel")}>
      <header className="editor-tools-head">
        <div>
          <h3>{t("toolsPanelTitle")}</h3>
          <p className="muted editor-tools-lead">{active?.hint}</p>
        </div>
        <button
          type="button"
          className="btn btn-ghost btn-icon"
          onClick={onClose}
          aria-label={t("toolsClose")}
          title={t("toolsClose")}
        >
          ×
        </button>
      </header>

      <div className="editor-tools-tabs" role="tablist">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            className="editor-tools-tab"
            data-active={activeTab === item.id}
            data-highlight={item.id === "review" && selectionActive}
            aria-selected={activeTab === item.id}
            onClick={() => onTabChange(item.id)}
          >
            {item.label}
            {item.badge ? <span className="editor-tools-badge">{item.badge}</span> : null}
          </button>
        ))}
      </div>

      <div className="editor-tools-body" role="tabpanel">
        <div hidden={activeTab !== "ai"}>{aiSlot}</div>
        <div hidden={activeTab !== "critique"}>{critiqueSlot}</div>
        <div hidden={activeTab !== "review"}>{reviewSlot}</div>
        <div hidden={activeTab !== "structure"}>{structureSlot}</div>
      </div>
    </aside>
  );
}
