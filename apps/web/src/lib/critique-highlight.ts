import { Mark, mergeAttributes, type JSONContent } from "@tiptap/core";
import type { Editor } from "@tiptap/react";
import {
  findQuoteRange,
  jumpToQuote,
} from "@/lib/review-highlight";

export type CritiqueFindingRef = {
  id: string;
  category: string;
  severity?: string;
  quote: string;
  chapter_id?: string | null;
};

export const CritiqueHighlight = Mark.create({
  name: "critiqueHighlight",
  inclusive: false,
  excludes: "",
  addAttributes() {
    return {
      findingId: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-finding-id"),
        renderHTML: (attributes) =>
          attributes.findingId ? { "data-finding-id": attributes.findingId } : {},
      },
      category: {
        default: "style",
        parseHTML: (element) => element.getAttribute("data-critique-cat") || "style",
        renderHTML: (attributes) => ({
          "data-critique-cat": attributes.category || "style",
        }),
      },
      severity: {
        default: "moderate",
        parseHTML: (element) =>
          element.getAttribute("data-critique-severity") || "moderate",
        renderHTML: (attributes) => ({
          "data-critique-severity": attributes.severity || "moderate",
        }),
      },
      active: {
        default: false,
        parseHTML: (element) => element.getAttribute("data-critique-active") === "true",
        renderHTML: (attributes) =>
          attributes.active ? { "data-critique-active": "true" } : {},
      },
    };
  },
  parseHTML() {
    return [{ tag: "mark[data-finding-id]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      "mark",
      mergeAttributes(HTMLAttributes, { class: "critique-text-mark" }),
      0,
    ];
  },
});

export function stripCritiqueMarksFromJson(node: JSONContent): JSONContent {
  if (!node) return node;
  const next: JSONContent = { ...node };
  if (Array.isArray(next.marks)) {
    next.marks = next.marks.filter((mark) => mark.type !== "critiqueHighlight");
    if (!next.marks.length) delete next.marks;
  }
  if (Array.isArray(next.content)) {
    next.content = next.content.map(stripCritiqueMarksFromJson);
  }
  return next;
}

export function stripEditorOverlayMarksFromJson(node: JSONContent): JSONContent {
  if (!node) return node;
  const next: JSONContent = { ...node };
  if (Array.isArray(next.marks)) {
    next.marks = next.marks.filter(
      (mark) => mark.type !== "reviewHighlight" && mark.type !== "critiqueHighlight",
    );
    if (!next.marks.length) delete next.marks;
  }
  if (Array.isArray(next.content)) {
    next.content = next.content.map(stripEditorOverlayMarksFromJson);
  }
  return next;
}

export function applyCritiqueHighlights(
  editor: Editor,
  findings: CritiqueFindingRef[],
  options?: { chapterId?: string; activeFindingId?: string | null },
) {
  const markType = editor.state.schema.marks.critiqueHighlight;
  if (!markType) return;

  let tr = editor.state.tr;

  editor.state.doc.descendants((node, pos) => {
    if (!node.isText || !markType.isInSet(node.marks)) return;
    tr = tr.removeMark(pos, pos + node.nodeSize, markType);
  });

  const doc = tr.doc;
  const claimed = new Set<string>();
  const chapterId = options?.chapterId;
  const activeId = options?.activeFindingId || null;

  for (const finding of findings) {
    if (finding.chapter_id && chapterId && finding.chapter_id !== chapterId) {
      continue;
    }
    const quote = finding.quote?.trim();
    if (!quote) continue;
    const range = findQuoteRange(doc, quote);
    if (!range) continue;
    const rangeKey = `${range.from}:${range.to}`;
    if (claimed.has(rangeKey)) continue;
    claimed.add(rangeKey);
    tr = tr.addMark(
      range.from,
      range.to,
      markType.create({
        findingId: finding.id,
        category: finding.category,
        severity: finding.severity || "moderate",
        active: finding.id === activeId,
      }),
    );
  }

  if (tr.docChanged || tr.steps.length) {
    editor.view.dispatch(tr);
  }
}

export function applyCritiqueFix(
  editor: Editor,
  quote: string,
  replacement: string,
): boolean {
  const range = findQuoteRange(editor.state.doc, quote.trim());
  if (!range) return false;
  const text = replacement.trim();
  if (!text) return false;
  editor.view.dispatch(editor.state.tr.insertText(text, range.from, range.to));
  return true;
}

export function readingFindingIdFromEvent(target: EventTarget | null): string | null {
  if (!(target instanceof Element)) return null;
  const mark = target.closest("mark.critique-text-mark[data-finding-id]");
  return mark?.getAttribute("data-finding-id") || null;
}

export { jumpToQuote };
