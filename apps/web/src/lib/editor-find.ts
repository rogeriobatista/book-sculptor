import type { Editor } from "@tiptap/react";

export type TextMatch = { from: number; to: number };

/** Case-insensitive whole-document text matches mapped to ProseMirror positions. */
export function findTextMatches(editor: Editor, query: string): TextMatch[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];

  const matches: TextMatch[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;
    const hay = node.text.toLowerCase();
    let start = 0;
    while (start <= hay.length) {
      const at = hay.indexOf(needle, start);
      if (at === -1) break;
      matches.push({ from: pos + at, to: pos + at + needle.length });
      start = at + Math.max(1, needle.length);
    }
  });
  return matches;
}

export function selectMatch(editor: Editor, match: TextMatch) {
  editor.chain().focus().setTextSelection(match).scrollIntoView().run();
}
