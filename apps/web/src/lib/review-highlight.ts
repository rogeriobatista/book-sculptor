import { Mark, mergeAttributes, type JSONContent } from "@tiptap/core";
import type { Editor } from "@tiptap/react";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

export type ReviewCommentRef = {
  id: string;
  kind: string;
  status: string;
  quote: string;
  proposed_text?: string | null;
};

export const ReviewHighlight = Mark.create({
  name: "reviewHighlight",
  inclusive: false,
  excludes: "",
  addAttributes() {
    return {
      commentId: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-comment-id"),
        renderHTML: (attributes) =>
          attributes.commentId ? { "data-comment-id": attributes.commentId } : {},
      },
      kind: {
        default: "comment",
        parseHTML: (element) => element.getAttribute("data-review-kind") || "comment",
        renderHTML: (attributes) => ({ "data-review-kind": attributes.kind }),
      },
      status: {
        default: "open",
        parseHTML: (element) => element.getAttribute("data-review-status") || "open",
        renderHTML: (attributes) => ({ "data-review-status": attributes.status }),
      },
      proposedText: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-proposed-text"),
        renderHTML: (attributes) =>
          attributes.proposedText
            ? { "data-proposed-text": attributes.proposedText }
            : {},
      },
      trackChange: {
        default: false,
        parseHTML: (element) => element.getAttribute("data-track-change") === "true",
        renderHTML: (attributes) =>
          attributes.trackChange ? { "data-track-change": "true" } : {},
      },
    };
  },
  parseHTML() {
    return [{ tag: "mark[data-comment-id]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      "mark",
      mergeAttributes(HTMLAttributes, { class: "review-text-mark" }),
      0,
    ];
  },
});

export function charOffsetToPos(doc: ProseMirrorNode, target: number): number {
  if (target <= 0) return 0;
  const size = doc.content.size;
  for (let pos = 0; pos <= size; pos += 1) {
    if (doc.textBetween(0, pos, "\n\n").length >= target) return pos;
  }
  return size;
}

export function findQuoteRange(
  doc: ProseMirrorNode,
  quote: string,
): { from: number; to: number } | null {
  const needle = quote.trim();
  if (!needle) return null;
  const full = doc.textBetween(0, doc.content.size, "\n\n");
  const idx = full.indexOf(needle);
  if (idx === -1) return null;
  const from = charOffsetToPos(doc, idx);
  const to = charOffsetToPos(doc, idx + needle.length);
  if (to <= from) return null;
  return { from, to };
}

export function stripReviewMarksFromJson(node: JSONContent): JSONContent {
  if (!node) return node;
  const next: JSONContent = { ...node };
  if (Array.isArray(next.marks)) {
    next.marks = next.marks.filter((mark) => mark.type !== "reviewHighlight");
    if (!next.marks.length) delete next.marks;
  }
  if (Array.isArray(next.content)) {
    next.content = next.content.map(stripReviewMarksFromJson);
  }
  return next;
}

function isTrackChangeSuggestion(comment: ReviewCommentRef): boolean {
  return (
    comment.kind === "suggestion" &&
    comment.status === "open" &&
    Boolean(comment.proposed_text?.trim())
  );
}

export function applyReviewHighlights(editor: Editor, comments: ReviewCommentRef[]) {
  const markType = editor.state.schema.marks.reviewHighlight;
  if (!markType) return;

  let tr = editor.state.tr;

  editor.state.doc.descendants((node, pos) => {
    if (!node.isText || !markType.isInSet(node.marks)) return;
    tr = tr.removeMark(pos, pos + node.nodeSize, markType);
  });

  const doc = tr.doc;
  const claimed = new Set<string>();

  for (const comment of comments) {
    const quote = comment.quote?.trim();
    if (!quote) continue;
    const range = findQuoteRange(doc, quote);
    if (!range) continue;
    const rangeKey = `${range.from}:${range.to}`;
    if (claimed.has(rangeKey)) continue;
    claimed.add(rangeKey);
    const trackChange = isTrackChangeSuggestion(comment);
    tr = tr.addMark(
      range.from,
      range.to,
      markType.create({
        commentId: comment.id,
        kind: comment.kind,
        status: comment.status,
        proposedText: trackChange ? comment.proposed_text!.trim() : null,
        trackChange,
      }),
    );
  }

  if (tr.docChanged) editor.view.dispatch(tr);
}

export function jumpToQuote(editor: Editor, quote: string): boolean {
  const range = findQuoteRange(editor.state.doc, quote.trim());
  if (!range) return false;
  editor.chain().focus().setTextSelection(range).scrollIntoView().run();
  return true;
}

export function readingCommentIdFromEvent(target: EventTarget | null): string | null {
  if (!(target instanceof Element)) return null;
  const mark = target.closest("mark.review-text-mark[data-comment-id]");
  return mark?.getAttribute("data-comment-id") || null;
}

export function isOpenTrackChangeMark(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  const mark = target.closest("mark.review-text-mark[data-track-change='true']");
  return Boolean(mark);
}
