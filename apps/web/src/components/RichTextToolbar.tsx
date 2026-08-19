"use client";

import type { Editor } from "@tiptap/react";
import { useTranslations } from "next-intl";

type Props = {
  editor: Editor | null;
  disabled?: boolean;
};

export function RichTextToolbar({ editor, disabled = false }: Props) {
  const t = useTranslations("studio");

  if (!editor) return null;

  function btn(
    label: string,
    active: boolean,
    onClick: () => void,
    title?: string,
  ) {
    return (
      <button
        type="button"
        className="rte-btn"
        data-active={active}
        disabled={disabled}
        title={title || label}
        aria-label={label}
        onClick={onClick}
      >
        {label}
      </button>
    );
  }

  return (
    <div className="rte-toolbar" role="toolbar" aria-label={t("editorToolbar")}>
      <div className="rte-group" aria-label={t("rteGroupStyle")}>
        {btn("B", editor.isActive("bold"), () => editor.chain().focus().toggleBold().run(), t("toolBold"))}
        {btn("I", editor.isActive("italic"), () => editor.chain().focus().toggleItalic().run(), t("toolItalic"))}
        {btn("U", editor.isActive("underline"), () => editor.chain().focus().toggleUnderline().run(), t("toolUnderline"))}
        {btn("S", editor.isActive("strike"), () => editor.chain().focus().toggleStrike().run(), t("toolStrike"))}
      </div>
      <span className="rte-sep" aria-hidden="true" />
      <div className="rte-group" aria-label={t("rteGroupStructure")}>
        {btn("H2", editor.isActive("heading", { level: 2 }), () =>
          editor.chain().focus().toggleHeading({ level: 2 }).run(), t("toolHeading2"))}
        {btn("H3", editor.isActive("heading", { level: 3 }), () =>
          editor.chain().focus().toggleHeading({ level: 3 }).run(), t("toolHeading3"))}
        {btn("•", editor.isActive("bulletList"), () => editor.chain().focus().toggleBulletList().run(), t("toolBulletList"))}
        {btn("1.", editor.isActive("orderedList"), () => editor.chain().focus().toggleOrderedList().run(), t("toolOrderedList"))}
        {btn("❝", editor.isActive("blockquote"), () => editor.chain().focus().toggleBlockquote().run(), t("toolQuote"))}
      </div>
      <span className="rte-sep" aria-hidden="true" />
      <div className="rte-group" aria-label={t("rteGroupAlign")}>
        {btn("↤", editor.isActive({ textAlign: "left" }), () => editor.chain().focus().setTextAlign("left").run(), t("toolAlignLeft"))}
        {btn("↔", editor.isActive({ textAlign: "center" }), () => editor.chain().focus().setTextAlign("center").run(), t("toolAlignCenter"))}
        {btn("↦", editor.isActive({ textAlign: "right" }), () => editor.chain().focus().setTextAlign("right").run(), t("toolAlignRight"))}
      </div>
      <span className="rte-sep" aria-hidden="true" />
      <div className="rte-group" aria-label={t("rteGroupHistory")}>
        {btn("↶", false, () => editor.chain().focus().undo().run(), t("toolUndo"))}
        {btn("↷", false, () => editor.chain().focus().redo().run(), t("toolRedo"))}
      </div>
    </div>
  );
}
