import type { NextConfig } from "next";
import path from "node:path";

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

export default nextConfig;
