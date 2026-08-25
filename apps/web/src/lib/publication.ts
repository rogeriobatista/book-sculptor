export type SocialPostDraft = {
  platform: string;
  text: string;
  status: "draft" | "scheduled" | "published";
  scheduled_at?: string | null;
};

export type SocialIntegration = {
  platform: string;
  enabled: boolean;
  status: "disconnected" | "connected" | "coming_soon";
  auto_publish: boolean;
};

export type StoreTarget = {
  platform: string;
  status: "not_started" | "in_progress" | "published";
  notes: string;
};

export type PublicationProfile = {
  synopsis: string;
  short_description: string;
  back_cover: string;
  keywords: string;
  categories: string;
  social_posts: SocialPostDraft[];
  social_integrations: SocialIntegration[];
  store_targets: StoreTarget[];
};

export type PublicationSection =
  | "synopsis"
  | "social"
  | "covers"
  | "exports"
  | "stores"
  | "integrations";

export type PublicationGenerateKind =
  | "synopsis"
  | "back_cover"
  | "social_posts"
  | "keywords";

export const PUBLICATION_SECTIONS: PublicationSection[] = [
  "synopsis",
  "social",
  "covers",
  "exports",
  "stores",
  "integrations",
];

export type SocialArtAsset = {
  id: string;
  format_id: string;
  url: string;
  quote_text: string;
  width: number;
  height: number;
  created_at: string;
};

export type SocialAccountConnection = {
  id: string;
  platform: string;
  account_label: string;
  status: string;
  connected: boolean;
  dev: boolean;
  created_at: string;
  updated_at: string;
};

export type PublishQueueJob = {
  id: string;
  book_id: string;
  platform: string;
  post_text: string;
  social_asset_id?: string | null;
  asset_url?: string | null;
  scheduled_at?: string | null;
  status: string;
  external_post_id?: string;
  error?: string | null;
  created_at: string;
  updated_at: string;
};

export const SOCIAL_ART_FORMATS = [
  "instagram_post",
  "instagram_story",
  "x_post",
  "facebook",
] as const;

export type SocialArtFormat = (typeof SOCIAL_ART_FORMATS)[number];

export const SOCIAL_PLATFORMS = [
  "instagram",
  "facebook",
  "x",
  "threads",
  "tiktok",
  "linkedin",
] as const;

export const STORE_PLATFORMS = [
  "kdp",
  "apple_books",
  "google_play",
  "kobo",
  "ingram_spark",
  "direct",
] as const;

/** Soft limits aligned with common retailer guidance (KDP / Apple / Google). */
export const PUBLISH_LIMITS = {
  shortDescriptionSoft: 280,
  shortDescriptionHard: 500,
  synopsisSoft: 4000,
  synopsisHard: 8000,
  backCoverSoft: 1500,
  backCoverHard: 8000,
  keywordsMax: 7,
  keywordsRecommendedMin: 3,
  socialPostSoft: 280,
} as const;

export const STORE_HELP_URLS: Record<string, string> = {
  kdp: "https://kdp.amazon.com/en_US/help/topic/G200646050",
  apple_books: "https://authors.apple.com/",
  google_play: "https://play.google.com/books/publish/",
  kobo: "https://www.kobo.com/us/en/p/writinglife",
  ingram_spark: "https://www.ingramspark.com/",
  direct: "",
};

export type ReadinessItemId =
  | "pitch"
  | "synopsis"
  | "back_cover"
  | "keywords"
  | "categories"
  | "cover"
  | "epub";

export type ReadinessItem = {
  id: ReadinessItemId;
  done: boolean;
};

export function splitKeywords(raw: string): string[] {
  return raw
    .split(/[,;]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

export function joinKeywords(parts: string[]): string {
  return parts.map((part) => part.trim()).filter(Boolean).join(", ");
}

export function emptyPublicationProfile(): PublicationProfile {
  return {
    synopsis: "",
    short_description: "",
    back_cover: "",
    keywords: "",
    categories: "",
    social_posts: [],
    social_integrations: SOCIAL_PLATFORMS.map((platform) => ({
      platform,
      enabled: false,
      status: "coming_soon",
      auto_publish: false,
    })),
    store_targets: STORE_PLATFORMS.map((platform) => ({
      platform,
      status: "not_started",
      notes: "",
    })),
  };
}

function mergeStoreTargets(existing: StoreTarget[] | undefined): StoreTarget[] {
  const byPlatform = new Map(
    (existing || []).map((item) => [item.platform, item] as const),
  );
  const merged = STORE_PLATFORMS.map(
    (platform) =>
      byPlatform.get(platform) ?? {
        platform,
        status: "not_started" as const,
        notes: "",
      },
  );
  for (const item of existing || []) {
    if (!STORE_PLATFORMS.includes(item.platform as (typeof STORE_PLATFORMS)[number])) {
      merged.push(item);
    }
  }
  return merged;
}

export function publicationFromBookSettings(
  settings: Record<string, unknown> | undefined,
): PublicationProfile {
  const raw = settings?.publication;
  if (!raw || typeof raw !== "object") return emptyPublicationProfile();
  const data = raw as Partial<PublicationProfile>;
  const base = emptyPublicationProfile();
  return {
    synopsis: String(data.synopsis || ""),
    short_description: String(data.short_description || ""),
    back_cover: String(data.back_cover || ""),
    keywords: String(data.keywords || ""),
    categories: String(data.categories || ""),
    social_posts: Array.isArray(data.social_posts) ? data.social_posts : base.social_posts,
    social_integrations: Array.isArray(data.social_integrations)
      ? data.social_integrations
      : base.social_integrations,
    store_targets: mergeStoreTargets(
      Array.isArray(data.store_targets) ? data.store_targets : undefined,
    ),
  };
}

export function computePublicationReadiness(input: {
  profile: PublicationProfile;
  hasCover: boolean;
  hasReadyEpub?: boolean;
}): { score: number; done: number; total: number; items: ReadinessItem[] } {
  const { profile, hasCover, hasReadyEpub = false } = input;
  const keywords = splitKeywords(profile.keywords);
  const items: ReadinessItem[] = [
    { id: "pitch", done: profile.short_description.trim().length >= 40 },
    { id: "synopsis", done: profile.synopsis.trim().length >= 200 },
    { id: "back_cover", done: profile.back_cover.trim().length >= 80 },
    {
      id: "keywords",
      done:
        keywords.length >= PUBLISH_LIMITS.keywordsRecommendedMin &&
        keywords.length <= PUBLISH_LIMITS.keywordsMax,
    },
    { id: "categories", done: profile.categories.trim().length > 0 },
    { id: "cover", done: hasCover },
    { id: "epub", done: hasReadyEpub },
  ];
  const done = items.filter((item) => item.done).length;
  const total = items.length;
  const score = Math.round((done / total) * 100);
  return { score, done, total, items };
}

export function counterTone(length: number, soft: number, hard: number): "ok" | "warn" | "over" {
  if (length > hard) return "over";
  if (length > soft) return "warn";
  return "ok";
}
