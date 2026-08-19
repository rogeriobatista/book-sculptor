"use client";

import { ClerkProvider } from "@clerk/nextjs";
import type { ReactNode } from "react";
import { DEV_AUTH_BYPASS } from "@/lib/dev-auth";

type Props = {
  children: ReactNode;
  locale?: string;
};

function redirectOrigins(): Array<string | RegExp> {
  const configured = (process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "");
  const origins: Array<string | RegExp> = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    /^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/,
    /^https:\/\/[a-z0-9-]+\.ngrok-free\.app$/,
    /^https:\/\/[a-z0-9-]+\.ngrok-free\.dev$/,
    /^https:\/\/[a-z0-9]+\.ngrok\.io$/,
  ];
  if (configured) origins.unshift(configured);
  return origins;
}

export function AuthProviders({ children, locale = "en" }: Props) {
  const clerkKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  if (DEV_AUTH_BYPASS || !clerkKey) {
    return <>{children}</>;
  }

  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "");
  const signInUrl = appUrl ? `${appUrl}/${locale}/sign-in` : `/${locale}/sign-in`;
  const signUpUrl = appUrl ? `${appUrl}/${locale}/sign-up` : `/${locale}/sign-up`;
  const afterSignIn = appUrl
    ? `${appUrl}/${locale}/dashboard`
    : `/${locale}/dashboard`;
  const afterSignOut = appUrl ? `${appUrl}/${locale}` : `/${locale}`;

  return (
    <ClerkProvider
      publishableKey={clerkKey}
      allowedRedirectOrigins={redirectOrigins()}
      signInUrl={signInUrl}
      signUpUrl={signUpUrl}
      afterSignOutUrl={afterSignOut}
      signInFallbackRedirectUrl={afterSignIn}
      signUpFallbackRedirectUrl={afterSignIn}
    >
      {children}
    </ClerkProvider>
  );
}
