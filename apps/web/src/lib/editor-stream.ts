"use client";

import type { Editor } from "@tiptap/react";

export type EditorStreamWriter = {
  append: (delta: string) => void;
  finish: () => void;
  abort: () => void;
};

type WriterOptions = {
  replaceSelection?: boolean;
  startEmpty?: boolean;
  onScroll?: () => void;
};

/**
 * Streams AI text into the TipTap editor at the cursor, like human typing.
 * Tracks insert position so deltas land sequentially without jumping to end.
 */
export function createEditorStreamWriter(
  editor: Editor,
  options: WriterOptions = {},
): EditorStreamWriter {
  const shell = editor.view.dom.closest(".editor-shell");
  shell?.classList.add("editor-ai-streaming");

  let insertPos = editor.state.selection.from;
  let scrollRaf: number | null = null;
  let finished = false;

  if (options.replaceSelection && !editor.state.selection.empty) {
    editor.chain().focus().deleteSelection().run();
    insertPos = editor.state.selection.from;
  } else if (options.startEmpty) {
    editor.chain().focus("start").clearContent().run();
    insertPos = 1;
  } else if (editor.state.selection.empty) {
    insertPos = editor.state.selection.from;
    editor.chain().focus().run();
  } else {
    insertPos = editor.state.selection.to;
  }

  const scheduleScroll = () => {
    if (scrollRaf !== null) return;
    scrollRaf = window.requestAnimationFrame(() => {
      scrollRaf = null;
      editor.commands.scrollIntoView();
      options.onScroll?.();
      const page = editor.view.dom.closest(".manuscript-page");
      if (page) {
        page.scrollTop = page.scrollHeight;
      }
    });
  };

  const append = (delta: string) => {
    if (!delta || finished) return;

    const parts = delta.split(/(\n)/);
    for (const part of parts) {
      if (!part) continue;
      if (part === "\n") {
        editor.chain().insertContentAt(insertPos, { type: "hardBreak" }).run();
        insertPos = editor.state.selection.to;
      } else {
        editor.chain().insertContentAt(insertPos, part).run();
        insertPos = editor.state.selection.to;
      }
    }

    editor.commands.setTextSelection(insertPos);
    scheduleScroll();
  };

  const cleanup = () => {
    finished = true;
    shell?.classList.remove("editor-ai-streaming");
    if (scrollRaf !== null) {
      window.cancelAnimationFrame(scrollRaf);
      scrollRaf = null;
    }
  };

  return {
    append,
    finish: cleanup,
    abort: cleanup,
  };
}
