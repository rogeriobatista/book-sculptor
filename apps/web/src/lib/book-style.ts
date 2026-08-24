import type { Book } from "@/lib/client-api";

export type BookPov = "first" | "third_limited" | "third_omniscient" | "second";

export type BookStyleProfile = {
  genre: string;
  tone: string;
  pov: BookPov;
  audience: string;
  style_notes: string;
  avoid_words: string;
  reference_authors: string;
  use_prior_chapters: boolean;
  prior_chapter_count: number;
};

export const DEFAULT_BOOK_STYLE: BookStyleProfile = {
  genre: "",
  tone: "",
  pov: "third_limited",
  audience: "",
  style_notes: "",
  avoid_words: "",
  reference_authors: "",
  use_prior_chapters: true,
  prior_chapter_count: 2,
};

export const POV_OPTIONS: BookPov[] = [
  "first",
  "third_limited",
  "third_omniscient",
  "second",
];

export function parseBookStyle(settings: Record<string, unknown> | undefined): BookStyleProfile {
  const raw = settings?.ai_style;
  if (!raw || typeof raw !== "object") return { ...DEFAULT_BOOK_STYLE };
  const data = raw as Record<string, unknown>;
  const pov = String(data.pov || "third_limited");
  const safePov = POV_OPTIONS.includes(pov as BookPov)
    ? (pov as BookPov)
    : "third_limited";
  const count = Number(data.prior_chapter_count);
  return {
    genre: String(data.genre || ""),
    tone: String(data.tone || ""),
    pov: safePov,
    audience: String(data.audience || ""),
    style_notes: String(data.style_notes || ""),
    avoid_words: String(data.avoid_words || ""),
    reference_authors: String(data.reference_authors || ""),
    use_prior_chapters: data.use_prior_chapters !== false,
    prior_chapter_count: Number.isFinite(count) ? Math.min(4, Math.max(0, count)) : 2,
  };
}

export function bookStyleFromBook(book: Book | null | undefined): BookStyleProfile {
  return parseBookStyle(book?.settings);
}

export function isBookStyleConfigured(profile: BookStyleProfile): boolean {
  return Boolean(
    profile.genre.trim() ||
      profile.tone.trim() ||
      profile.style_notes.trim() ||
      profile.audience.trim() ||
      profile.reference_authors.trim() ||
      profile.avoid_words.trim() ||
      profile.pov !== "third_limited",
  );
}

export function mergeBookSettingsWithStyle(
  settings: Record<string, unknown> | undefined,
  style: BookStyleProfile,
): Record<string, unknown> {
  return {
    ...(settings || {}),
    ai_style: style,
  };
}
