import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The repo's agent rules live at the root; do not generate a second set here.
  agentRules: false,
  output: "standalone",
};

export default nextConfig;
