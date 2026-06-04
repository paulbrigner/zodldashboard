import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  outputFileTracingIncludes: {
    "/zodl-roadmap": ["./.private/zodl-roadmap/**/*"],
    "/pgpz-roadmap": ["./.private/pgpz-roadmap/**/*"],
    "/arktouros": ["./.private/arktouros/**/*"],
  },
};

export default nextConfig;
