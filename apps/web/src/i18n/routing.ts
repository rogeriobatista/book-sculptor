import { defineRouting } from "next-intl/routing";

export const routing = defineRouting({
  locales: ["en", "pt-BR", "es"],
  defaultLocale: "en",
  localePrefix: "always",
  pathnames: {
    "/": "/",
    "/pricing": "/pricing",
    "/dashboard": "/dashboard",
    "/books": "/books",
    "/books/new": "/books/new",
    "/books/[bookId]": "/books/[bookId]",
    "/sign-in": "/sign-in",
    "/sign-up": "/sign-up",
  },
});

export type AppLocale = (typeof routing.locales)[number];
export type AppPathname = keyof typeof routing.pathnames;
