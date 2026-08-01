import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    // A stray lockfile above this directory makes Next infer the wrong
    // workspace root, which changes where it resolves files from.
    root: __dirname,
  },
};

export default nextConfig;
