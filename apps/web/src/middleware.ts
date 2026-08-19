import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";

// next-intl only. clerkMiddleware hangs on Next.js 16 ("Failed to proxy").
// Auth for /dashboard and /books is enforced client-side via RequireSignIn.
export default createMiddleware(routing);

export const config = {
  matcher: [
    "/((?!api|_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
  ],
};
