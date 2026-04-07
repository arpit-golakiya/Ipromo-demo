import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["three"],
  // Dev-only Strict Mode double-mount can dispose WebGL and leave a blank canvas on some GPUs.
  reactStrictMode: false,
};

export default nextConfig;
