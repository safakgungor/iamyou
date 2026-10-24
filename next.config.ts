import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // lib/inbox.ts reads the synthetic inbox at request time; ship just that file
  // with the assistant routes instead of tracing the whole project.
  outputFileTracingIncludes: {
    "/api/assistant/*": ["./data/synthetic/maya/inbox.json"],
    // The trial finder's offline fallback, read by app/api/trials/route.ts.
    "/api/trials": ["./data/public/clinicaltrials-ma-recruiting-2026-10-18.csv"],
  },
};

export default nextConfig;
