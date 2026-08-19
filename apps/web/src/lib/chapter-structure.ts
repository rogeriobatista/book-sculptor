import { type Chapter } from "@/lib/client-api";

export type ChapterSection = {
  id: string;
  title: string;
  index: number;
};

const SECTION_LINE =
  /^(?:parte|part|seção|secao|section)\s+(?:\d{1,2}|[ivxlcdm]{1,6})\s*[—:\-–]/i;

export function isSectionLine(text: string): boolean {
  return SECTION_LINE.test(text.trim());
}

export function extractSections(text: string): ChapterSection[] {
  const blocks = text.replace(/\r\n/g, "\n").split(/\n\n+/);
  const sections: ChapterSection[] = [];
  blocks.forEach((block, index) => {
    const trimmed = block.trim();
    if (!trimmed || !isSectionLine(trimmed)) return;
    sections.push({
      id: `section-${index}`,
      title: trimmed.length > 72 ? `${trimmed.slice(0, 69)}…` : trimmed,
      index,
    });
  });
  return sections;
}

export function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

export function chapterDisplayLabel(chapter: Chapter): string {
  return chapter.full_label || chapter.title || "";
}

export function chapterShortTitle(chapter: Chapter): string {
  return chapter.title || chapter.full_label || "";
}

export const CHAPTER_KINDS = [
  "dedication",
  "prologue",
  "chapter",
  "epilogue",
  "afterword",
  "appendix",
  "other",
] as const;

export type ChapterKind = (typeof CHAPTER_KINDS)[number];

export function kindTranslationKey(
  kind: string,
):
  | "kindDedication"
  | "kindPrologue"
  | "kindChapter"
  | "kindEpilogue"
  | "kindAfterword"
  | "kindAppendix"
  | "kindOther" {
  if (kind === "dedication") return "kindDedication";
  if (kind === "prologue") return "kindPrologue";
  if (kind === "epilogue") return "kindEpilogue";
  if (kind === "afterword") return "kindAfterword";
  if (kind === "appendix") return "kindAppendix";
  if (kind === "chapter") return "kindChapter";
  return "kindOther";
}

export function paragraphBlockFromText(text: string): Record<string, unknown> {
  if (isSectionLine(text)) {
    return {
      type: "heading",
      attrs: { level: 3 },
      content: text ? [{ type: "text", text }] : [],
    };
  }
  return {
    type: "paragraph",
    content: text ? [{ type: "text", text }] : [],
  };
}

function extractTextFromNode(node: Record<string, unknown>): string {
  const content = node.content;
  if (!Array.isArray(content)) return "";
  return content
    .map((item) => {
      if (!item || typeof item !== "object") return "";
      const chunk = item as Record<string, unknown>;
      return typeof chunk.text === "string" ? chunk.text : "";
    })
    .join("");
}

function normalizeDocSections(doc: Record<string, unknown>): Record<string, unknown> {
  const content = doc.content;
  if (!Array.isArray(content)) return doc;
  return {
    ...doc,
    content: content.map((node) => {
      if (!node || typeof node !== "object") return node;
      const block = node as Record<string, unknown>;
      if (block.type !== "paragraph") return block;
      const text = extractTextFromNode(block);
      if (isSectionLine(text)) return paragraphBlockFromText(text);
      return block;
    }),
  };
}

export function docFromChapterContent(chapter: Chapter): Record<string, unknown> {
  if (chapter.content_json && Object.keys(chapter.content_json).length) {
    return normalizeDocSections(chapter.content_json);
  }
  const paragraphs = (chapter.content_text || "")
    .split(/\n\n+/)
    .map((p) => p.trim());
  return {
    type: "doc",
    content: (paragraphs.length ? paragraphs : [""]).map((text) =>
      paragraphBlockFromText(text),
    ),
  };
}
