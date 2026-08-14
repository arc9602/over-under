import type { NextConfig } from "next";

import { STATIC_SECURITY_HEADERS } from "./lib/security/headers";

const nextConfig: NextConfig = {
  // The framework version is free reconnaissance -- it maps a target straight
  // onto the CVE list for that release. Nothing in the app reads it.
  poweredByHeader: false,

  /**
   * Backstop for the paths middleware does not run on.
   *
   * middleware.ts sets the same headers plus a per-request CSP nonce, and its
   * matcher deliberately excludes static assets and images. Those responses
   * still want nosniff and HSTS, so they are set here as well. Where both
   * apply, middleware's copy wins -- it runs later and calls headers.set().
   */
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [...STATIC_SECURITY_HEADERS],
      },
    ];
  },
};

export default nextConfig;
