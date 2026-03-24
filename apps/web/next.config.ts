import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: [
    "@multica/ui",
    "@multica/sdk",
    "@multica/types",
    "@multica/utils",
  ],
};

export default nextConfig;
