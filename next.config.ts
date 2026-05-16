import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  outputFileTracingIncludes: {
    "/zodl-roadmap": ["./.private/zodl-roadmap/**/*"],
  },
};

export default nextConfig;
