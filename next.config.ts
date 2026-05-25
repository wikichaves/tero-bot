import type { NextConfig } from "next";
import path from "node:path";
import createNextIntlPlugin from "next-intl/plugin";

// WIK-151: next-intl plugin. Apunta al request config que resuelve
// el locale per-request (cookie → profile → Accept-Language → en).
const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  turbopack: {
    root: path.resolve(__dirname),
  },
  experimental: {
    serverActions: {
      // Default is 1 MB which rebotes a phone-sized photo. Server-side we
      // still cap at 5 MB inside `uploadPropertyThumbnail` — this is just
      // the transport ceiling so the request reaches the action at all.
      bodySizeLimit: "10mb",
    },
  },
};

export default withNextIntl(nextConfig);
