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
  "part",
  "chapter",
  "epilogue",
  "afterword",
  "appendix",
  "other",
] as const;

export type ChapterKind = (typeof CHAPTER_KINDS)[number];

export type ChapterTreeNode = {
  chapter: Chapter;
  children: ChapterTreeNode[];
};

export function buildChapterTree(chapters: Chapter[]): ChapterTreeNode[] {
  const sorted = [...chapters].sort((a, b) => a.position - b.position);
  const nodes = new Map<string, ChapterTreeNode>();
  for (const chapter of sorted) {
    nodes.set(chapter.id, { chapter, children: [] });
  }
  const roots: ChapterTreeNode[] = [];
  for (const chapter of sorted) {
    const node = nodes.get(chapter.id);
    if (!node) continue;
    if (chapter.parent_id && nodes.has(chapter.parent_id)) {
      nodes.get(chapter.parent_id)?.children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

export function filterChapterIdsWithAncestors(
  chapters: Chapter[],
  query: string,
): Set<string> | null {
  const needle = query.trim().toLowerCase();
  if (!needle) return null;
  const byId = new Map(chapters.map((chapter) => [chapter.id, chapter]));
  const visible = new Set<string>();
  for (const chapter of chapters) {
    const haystack = `${chapter.full_label} ${chapter.title}`.toLowerCase();
    if (!haystack.includes(needle)) continue;
    visible.add(chapter.id);
    let parentId = chapter.parent_id;
    while (parentId && byId.has(parentId)) {
      visible.add(parentId);
      parentId = byId.get(parentId)?.parent_id ?? null;
    }
  }
  return visible;
}

export function flattenChapterTree(
  roots: ChapterTreeNode[],
  collapsedPartIds: Set<string>,
  visibleIds: Set<string> | null,
): { node: ChapterTreeNode; depth: number }[] {
  const rows: { node: ChapterTreeNode; depth: number }[] = [];

  function walk(nodes: ChapterTreeNode[], depth: number) {
    for (const node of nodes) {
      if (visibleIds && !visibleIds.has(node.chapter.id)) {
        const hasVisibleChild = node.children.some(
          (child) =>
            visibleIds.has(child.chapter.id) ||
            child.children.some((grand) => visibleIds.has(grand.chapter.id)),
        );
        if (!hasVisibleChild) continue;
      }
      rows.push({ node, depth });
      const isPart = node.chapter.kind === "part";
      const collapsed = isPart && collapsedPartIds.has(node.chapter.id);
      if (!collapsed && node.children.length > 0) {
        walk(node.children, depth + 1);
      }
    }
  }

  walk(roots, 0);
  return rows;
}

export function kindTranslationKey(
  kind: string,
):
  | "kindDedication"
  | "kindPrologue"
  | "kindPart"
  | "kindChapter"
  | "kindEpilogue"
  | "kindAfterword"
  | "kindAppendix"
  | "kindOther" {
  if (kind === "dedication") return "kindDedication";
  if (kind === "prologue") return "kindPrologue";
  if (kind === "part") return "kindPart";
  if (kind === "epilogue") return "kindEpilogue";
  if (kind === "afterword") return "kindAfterword";
  if (kind === "appendix") return "kindAppendix";
  if (kind === "chapter") return "kindChapter";
  return "kindOther";
}

export const ADD_SECTION_GROUPS: ReadonlyArray<{
  labelKey:
    | "addSectionGroupFront"
    | "addSectionGroupBody"
    | "addSectionGroupBack";
  kinds: readonly ChapterKind[];
}> = [
  { labelKey: "addSectionGroupFront", kinds: ["dedication", "prologue"] },
  { labelKey: "addSectionGroupBody", kinds: ["part", "chapter"] },
  {
    labelKey: "addSectionGroupBack",
    kinds: ["epilogue", "afterword", "appendix", "other"],
  },
];

export function defaultSectionTitle(
  kind: ChapterKind,
  chapters: Chapter[],
  labels: {
    chapter: string;
    part: string;
    kindLabel: (kind: ChapterKind) => string;
  },
): string {
  if (kind === "chapter") {
    const count = chapters.filter((chapter) => chapter.kind === "chapter").length;
    return `${labels.chapter} ${count + 1}`;
  }
  if (kind === "part") {
    const count = chapters.filter((chapter) => chapter.kind === "part").length;
    return `${labels.part} ${count + 1}`;
  }
  return labels.kindLabel(kind);
}

export function sectionKindShowsIndex(kind: string): boolean {
  return kind === "chapter" || kind === "part";
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
