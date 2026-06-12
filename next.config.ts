import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  outputFileTracingIncludes: {
    "/zodl-roadmap": ["./.private/zodl-roadmap/**/*"],
    "/zodl-roadmap/content": ["./.private/zodl-roadmap/**/*"],
    "/zodl-roadmap/[...assetPath]": ["./.private/zodl-roadmap/**/*"],
    "/pgpz-roadmap": ["./.private/pgpz-roadmap/**/*"],
    "/pgpz-roadmap/content": ["./.private/pgpz-roadmap/**/*"],
    "/pgpz-roadmap/[...assetPath]": ["./.private/pgpz-roadmap/**/*"],
    "/arktouros": ["./.private/arktouros/**/*"],
    "/arktouros/content": ["./.private/arktouros/**/*"],
    "/arktouros/[...assetPath]": ["./.private/arktouros/**/*"],
    "/2026-zodl-summit": ["./.private/2026-zodl-summit/**/*"],
    "/2026-zodl-summit/content": ["./.private/2026-zodl-summit/**/*"],
    "/2026-zodl-summit/[...assetPath]": ["./.private/2026-zodl-summit/**/*"],
  },
};

export default nextConfig;
