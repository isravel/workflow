import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  ...(process.env.WORKFLOW_DEV_ALL === "1" ? { distDir: "next-dev-all" } : {}),
};

export default nextConfig;
