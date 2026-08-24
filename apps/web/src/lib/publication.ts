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
  "direct",
] as const;

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
    store_targets: Array.isArray(data.store_targets)
      ? data.store_targets
      : base.store_targets,
  };
}
