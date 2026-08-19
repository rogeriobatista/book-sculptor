import { NextIntlClientProvider } from "next-intl";
import { getMessages, setRequestLocale } from "next-intl/server";
import { hasLocale } from "next-intl";
import { notFound } from "next/navigation";
import { Source_Sans_3, Source_Serif_4 } from "next/font/google";
import type { ReactNode } from "react";
import { AuthProviders } from "@/components/AuthProviders";
import { SiteHeader } from "@/components/SiteHeader";
import { ThemeInitScript } from "@/components/ThemeInitScript";
import { ThemeProvider } from "@/components/ThemeProvider";
import { ToastProvider } from "@/components/ToastProvider";
import { routing } from "@/i18n/routing";

const sourceSerif = Source_Serif_4({
  subsets: ["latin", "latin-ext"],
  variable: "--font-source-serif",
  display: "swap",
});

const sourceSans = Source_Sans_3({
  subsets: ["latin", "latin-ext"],
  variable: "--font-source-sans",
  display: "swap",
});

type Props = {
  children: ReactNode;
  params: Promise<{ locale: string }>;
};

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({ children, params }: Props) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }

  setRequestLocale(locale);
  const messages = await getMessages();

  return (
    <AuthProviders locale={locale}>
      <html
        lang={locale}
        className={`${sourceSerif.variable} ${sourceSans.variable}`}
        suppressHydrationWarning
      >
        <head>
          <ThemeInitScript />
        </head>
        <body>
          <NextIntlClientProvider messages={messages}>
            <ThemeProvider>
              <ToastProvider>
                <div className="site-shell">
                  <SiteHeader />
                  <main className="site-main">{children}</main>
                  <footer className="site-footer">
                    <span>Book Sculptor</span>
                  </footer>
                </div>
              </ToastProvider>
            </ThemeProvider>
          </NextIntlClientProvider>
        </body>
      </html>
    </AuthProviders>
  );
}
