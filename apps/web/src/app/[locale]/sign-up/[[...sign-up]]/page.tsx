"use client";

import { SignUp } from "@clerk/nextjs";
import { useLocale } from "next-intl";

export default function SignUpPage() {
  const locale = useLocale();
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "");
  const afterSignUp = appUrl
    ? `${appUrl}/${locale}/dashboard`
    : `/${locale}/dashboard`;

  return (
    <div className="page" style={{ display: "grid", placeItems: "center", padding: "2rem 1rem" }}>
      <SignUp
        routing="hash"
        forceRedirectUrl={afterSignUp}
        signInUrl={`/${locale}/sign-in`}
      />
    </div>
  );
}
