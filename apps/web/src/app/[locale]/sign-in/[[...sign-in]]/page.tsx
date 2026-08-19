"use client";

import { SignIn } from "@clerk/nextjs";
import { useLocale } from "next-intl";

export default function SignInPage() {
  const locale = useLocale();
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "");
  const afterSignIn = appUrl
    ? `${appUrl}/${locale}/dashboard`
    : `/${locale}/dashboard`;

  return (
    <div className="page" style={{ display: "grid", placeItems: "center", padding: "2rem 1rem" }}>
      <SignIn
        routing="hash"
        forceRedirectUrl={afterSignIn}
        signUpUrl={`/${locale}/sign-up`}
      />
    </div>
  );
}
