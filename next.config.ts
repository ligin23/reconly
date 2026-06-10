import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Prevents Turbopack from opening its SQLite-backed filesystem cache,
  // which fails with EPERM on FUSE-mounted volumes (the Cowork sandbox).
  // (Formerly experimental.turbo.persistentCaching, renamed in Next 16.)
  experimental: {
    turbopackFileSystemCacheForDev: false,
    turbopackFileSystemCacheForBuild: false,
  },
};

export default nextConfig;
