import { getRequestConfig } from "next-intl/server";
import { hasLocale } from "next-intl";
import { routing } from "./routing";
// Static JSON catalogs (re-import on message key changes — Turbopack can cache otherwise).
import en from "../../messages/en.json";
import ptBR from "../../messages/pt-BR.json";
import es from "../../messages/es.json";

/** Message catalogs keyed by locale. Bump when adding keys: landing-v3. */
const catalogs = {
  en,
  "pt-BR": ptBR,
  es,
} as const;

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested)
    ? requested
    : routing.defaultLocale;

  return {
    locale,
    messages: catalogs[locale],
    onError(error) {
      if (process.env.NODE_ENV === "development") {
        console.error("[i18n]", error);
      }
    },
    getMessageFallback({ namespace, key }) {
      return namespace ? `${namespace}.${key}` : key;
    },
  };
});


