"use client";

import { useTranslations } from "next-intl";
import type { RefObject } from "react";

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

type Chip = { action: AiAction; label: string; prompt?: string };

type Props = {
  chips: Chip[];
  chat: ChatItem[];
  aiPrompt: string;
  aiBusy: boolean;
  canUseAi: boolean;
  canEdit: boolean;
  chatEndRef: RefObject<HTMLDivElement | null>;
  onPromptChange: (value: string) => void;
  onRun: (action: AiAction, prompt?: string) => void;
  onStop: () => void;
};

export function EditorAiPanel({
  chips,
  chat,
  aiPrompt,
  aiBusy,
  canUseAi,
  canEdit,
  chatEndRef,
  onPromptChange,
  onRun,
  onStop,
}: Props) {
  const t = useTranslations("studio");

  return (
    <div className="editor-ai-panel">
      {!canEdit ? (
        <p className="editor-tools-notice">{t("readOnlyBadge")}</p>
      ) : null}

      <div className="ai-chips">
        {chips.map((chip) => (
          <button
            key={chip.action}
            type="button"
            className="ai-chip"
            disabled={aiBusy || !canUseAi || !canEdit}
            onClick={() => onRun(chip.action, chip.prompt)}
          >
            {chip.label}
          </button>
        ))}
      </div>

      {!canUseAi ? (
        <p className="editor-tools-notice">{t("upgradeAi")}</p>
      ) : (
        <p className="muted editor-tools-tip">{t("aiLead")}</p>
      )}

      <div className="ai-chat-log" aria-live="polite">
        {chat.length === 0 ? (
          <p className="muted ai-chat-empty">{t("aiChatEmpty")}</p>
        ) : (
          chat.map((item) => (
            <div
              key={item.id}
              className="ai-chat-bubble"
              data-role={item.role}
              data-streaming={item.streaming ? "true" : "false"}
            >
              <span className="ai-chat-role">
                {item.role === "user" ? t("aiYou") : t("aiAssistant")}
              </span>
              <p>{item.text || (item.streaming ? "…" : "")}</p>
            </div>
          ))
        )}
        <div ref={chatEndRef} />
      </div>

      <label className="ai-prompt-field">
        <span className="field-label">{t("promptLabel")}</span>
        <textarea
          value={aiPrompt}
          onChange={(e) => onPromptChange(e.target.value)}
          placeholder={t("promptPlaceholder")}
          rows={3}
          disabled={aiBusy || !canUseAi || !canEdit}
        />
      </label>
      <div className="editor-tools-actions">
        <button
          type="button"
          className="btn btn-primary"
          disabled={aiBusy || !canUseAi || !canEdit || !aiPrompt.trim()}
          onClick={() => onRun("generate")}
        >
          {aiBusy ? t("writing") : t("writeFromPrompt")}
        </button>
        {aiBusy ? (
          <button type="button" className="btn btn-ghost" onClick={onStop}>
            {t("aiStop")}
          </button>
        ) : null}
      </div>
    </div>
  );
}
