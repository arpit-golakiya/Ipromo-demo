import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  eslint: {
    ignoreDuringBuilds: true, // ✅ ADD THIS
  },
  transpilePackages: ["three"],
  reactStrictMode: false,
};

export default nextConfig;