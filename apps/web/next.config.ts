import createNextIntlPlugin from "next-intl/plugin";
import type { NextConfig } from "next";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const apiInternal = (
  process.env.API_INTERNAL_URL || "http://127.0.0.1:8000"
).replace(/\/$/, "");

function tunnelDevOrigins(): string[] {
  const origins = [
    "*.ngrok-free.dev",
    "*.ngrok-free.app",
    "*.ngrok.app",
    "*.ngrok.io",
    "*.trycloudflare.com",
  ];
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || "").trim();
  if (appUrl) {
    try {
      origins.unshift(new URL(appUrl).host);
    } catch {
      /* ignore invalid APP_URL */
    }
  }
  return origins;
}

const nextConfig: NextConfig = {
  // Next 15.2+ blocks cross-origin /_next assets in dev (403) unless listed.
  // Tunnels (ngrok / cloudflare) hit the server as a different Origin than localhost.
  allowedDevOrigins: tunnelDevOrigins(),
  async rewrites() {
    return [
      {
        source: "/api/v1/:path*",
        destination: `${apiInternal}/api/v1/:path*`,
      },
    ];
  },
};

export default withNextIntl(nextConfig);
