import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Standalone mode was previously enabled but removed because the
  // post-build NFT trace step (which produces the standalone artifact)
  // crashed with SIGSEGV on TrueNAS. The runner stage now uses
  // `next start` against the regular .next output instead.
  experimental: {
    webpackMemoryOptimizations: true,
  },
  async rewrites() {
    return [
      {
        source: "/prometheus/:path*",
        destination: "http://192.168.88.196:30104/:path*",
      },
    ];
  },
};

export default nextConfig;
