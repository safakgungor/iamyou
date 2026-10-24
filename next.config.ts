import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // lib/inbox.ts reads the synthetic inbox at request time; ship just that file
  // with the assistant routes instead of tracing the whole project.
  outputFileTracingIncludes: {
    "/api/assistant/*": ["./data/synthetic/maya/inbox.json"],
  },
};

export default nextConfig;
