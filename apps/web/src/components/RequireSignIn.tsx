"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { DEV_AUTH_BYPASS } from "@/lib/dev-auth";
import { useAppAuth } from "@/lib/use-app-auth";

type Props = {
  children: ReactNode;
};

export function RequireSignIn({ children }: Props) {
  const { isLoaded, isSignedIn } = useAppAuth();
  const t = useTranslations("nav");
  const common = useTranslations("common");

  if (DEV_AUTH_BYPASS || (isLoaded && isSignedIn)) {
    return <>{children}</>;
  }

  if (!isLoaded) {
    return null;
  }

  return (
    <div className="page-auth">
      <div className="panel empty-state">
        <p className="muted">{common("signInContinue")}</p>
        <Link href="/sign-in" className="btn btn-primary">
          {t("signIn")}
        </Link>
      </div>
    </div>
  );
}
