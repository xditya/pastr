import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Grammars are imported lazily by name; keep them out of the client bundle and
  // make sure the server bundle can resolve them at runtime.
  serverExternalPackages: ["@shikijs/langs", "@shikijs/themes", "shiki", "@shikijs/core", "@shikijs/engine-javascript"],
};

export default nextConfig;
