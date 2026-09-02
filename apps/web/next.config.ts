import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@cookbook/shared"],
  // Slim Docker runtime image — `next build` emits a self-contained
  // .next/standalone/server.js with a minimal node_modules copy.
  output: "standalone",
};

export default nextConfig;
