"use client";

import { UserButton } from "@clerk/nextjs";
import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { ThemeToggle } from "@/components/ThemeToggle";
import { DEV_AUTH_BYPASS } from "@/lib/dev-auth";
import { useAppAuth } from "@/lib/use-app-auth";

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function SiteHeader() {
  const t = useTranslations("nav");
  const common = useTranslations("common");
  const { isSignedIn } = useAppAuth();
  const pathname = usePathname();

  return (
    <header className="site-header">
      <Link href="/" className="brand-mark">
        {common("appName")}
      </Link>
      <nav className="nav-links" aria-label="Primary">
        {!isSignedIn ? <Link href="/" data-active={isActive(pathname, "/")}>{t("home")}</Link> : null}
        <Link href="/pricing" data-active={isActive(pathname, "/pricing")}>
          {t("pricing")}
        </Link>
        <ThemeToggle />
        {isSignedIn ? (
          <>
            <Link href="/books" data-active={isActive(pathname, "/books")}>
              {t("books")}
            </Link>
            {DEV_AUTH_BYPASS ? (
              <span className="muted" style={{ fontSize: "0.85rem", padding: "0 0.5rem" }}>
                Dev
              </span>
            ) : (
              <span className="nav-user">
                <UserButton />
              </span>
            )}
          </>
        ) : (
          <Link href="/sign-in" className="btn btn-primary" style={{ marginLeft: "0.35rem" }}>
            {t("signIn")}
          </Link>
        )}
      </nav>
    </header>
  );
}
