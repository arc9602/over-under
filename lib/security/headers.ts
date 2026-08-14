/**
 * Response security headers, in one place because two things set them and
 * they must not drift:
 *
 *   middleware.ts  -- every rendered route and API route, plus the redirects
 *                     middleware itself returns (next.config's headers() never
 *                     runs for those; the redirect short-circuits routing).
 *   next.config.ts -- everything middleware's matcher skips, which is the
 *                     static asset paths.
 *
 * Nothing here imports `server-only`, reads a secret, or touches Node built-ins:
 * next.config.ts loads this at build time and middleware runs it on the edge
 * runtime, so it has to be safe in both.
 */

/**
 * The headers that are the same on every response and carry no per-request
 * state. CSP is not among them -- it needs a fresh nonce each time and is
 * built by buildCsp() below.
 */
export const STATIC_SECURITY_HEADERS: ReadonlyArray<{ key: string; value: string }> = [
  // HTTPS only, for two years, including subdomains. This app custodies USDC
  // and authenticates with a bearer cookie; a single plaintext request is a
  // session handoff to anyone on the path.
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  // Stops a response being reinterpreted as a type it did not declare. The
  // concrete case here is uploaded/proxied content and JSON error bodies that
  // echo user input -- MIME sniffing is what turns those into HTML.
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Redundant with frame-ancestors in the CSP below, kept for the browsers
  // and embedded webviews that honour one and not the other. Clickjacking a
  // withdrawal confirmation is the attack this closes.
  { key: "X-Frame-Options", value: "DENY" },
  // Invite links carry an invite_code in the path. Full-URL referrers would
  // hand that code to every third-party origin an outbound link touches.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Nothing in this app uses these; denying them means a compromised script
  // cannot either.
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
  },
];

/** Origins the app legitimately talks to, derived from config where possible. */
function connectSources(): string[] {
  const sources = new Set<string>(["'self'"]);

  // Supabase: REST/auth over https and realtime over wss on the same host.
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  if (supabaseUrl) {
    try {
      const { origin, host } = new URL(supabaseUrl);
      sources.add(origin);
      sources.add(`wss://${host}`);
    } catch {
      // Malformed config: fall through with no Supabase origin rather than
      // throwing here. A missing connect-src entry shows up as a blocked
      // request in the console; a throw in middleware takes the site down.
    }
  }

  // The chain RPC the browser reads balances from.
  const rpcUrl = process.env.NEXT_PUBLIC_RPC_URL?.trim() || "https://rpc-amoy.polygon.technology";
  try {
    sources.add(new URL(rpcUrl).origin);
  } catch {
    /* same reasoning as above */
  }

  // Privy custodies the wallets: its API, its embedded-wallet iframe, and the
  // RPC proxy that iframe signs through. Wildcarded by necessity -- Privy
  // shards these per app id, so the exact subdomain is not knowable here.
  sources.add("https://auth.privy.io");
  sources.add("https://*.privy.io");
  sources.add("wss://*.privy.io");
  sources.add("https://*.rpc.privy.systems");

  return [...sources];
}

/**
 * Builds the policy for one request.
 *
 * `'strict-dynamic'` is what makes the nonce worth having: it tells the
 * browser to trust scripts loaded BY an already-trusted script, which is how
 * Next's chunk loader works, and to ignore host allowlists in script-src
 * entirely. Without it a strict policy either blocks hydration or has to
 * allowlist an origin, and an allowlisted origin with one open redirect on it
 * is not a control at all.
 */
export function buildCsp(nonce: string, isDev = process.env.NODE_ENV === "development"): string {
  return [
    "default-src 'self'",
    // React uses eval() in development to rebuild server stacks in the
    // browser. It does not in production, and 'unsafe-eval' must not ship.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    // 'unsafe-inline' rather than a nonce, deliberately. React writes `style`
    // props as inline style ATTRIBUTES, which a nonce cannot cover -- nonces
    // apply to <style> elements only. Inline CSS is not a script execution
    // primitive, so this is a far smaller concession than it looks next to
    // script-src.
    "style-src 'self' 'unsafe-inline'",
    // Avatars come from Google OAuth and from profiles.avatar_url, which a
    // user sets themselves, so the host cannot be pinned. Images are an
    // exfiltration channel, not an execution one, and object-src/script-src
    // below are where execution is actually stopped.
    "img-src 'self' blob: data: https:",
    "font-src 'self' data:",
    `connect-src ${connectSources().join(" ")}`,
    // Privy's embedded wallet renders its signing UI in an iframe it hosts;
    // that is the only third-party frame this app loads.
    "frame-src 'self' https://auth.privy.io https://*.privy.io",
    "worker-src 'self' blob:",
    // No Flash/Java/plugin content, ever. Cheap and absolute.
    "object-src 'none'",
    // Stops an injected <base> from re-pointing every relative script URL at
    // an attacker's host -- the standard way a nonce-based policy is defeated.
    "base-uri 'self'",
    // A form on this page cannot POST to another origin, so an injected form
    // cannot exfiltrate what the user types into it.
    "form-action 'self'",
    // Nobody may frame us. Pairs with X-Frame-Options above.
    "frame-ancestors 'none'",
    "upgrade-insecure-requests",
  ].join("; ");
}

/**
 * Whether to enforce the policy or only report violations.
 *
 * Defaults to REPORT-ONLY, and that default is a deliberate admission rather
 * than timidity: this policy has never been exercised against a live Privy
 * session, and a wrong connect-src or frame-src here does not degrade the
 * wallet, it breaks it -- users unable to sign, deposit, or withdraw. Report-
 * only gets the violations into the console with nothing broken.
 *
 * Set CSP_ENFORCE=1 once the browser console is clean through a full login →
 * link wallet → deposit → trade → withdraw pass. The nonce plumbing is
 * identical either way, so flipping it changes one header name and nothing
 * else.
 */
export function cspHeaderName(): "Content-Security-Policy" | "Content-Security-Policy-Report-Only" {
  return process.env.CSP_ENFORCE === "1"
    ? "Content-Security-Policy"
    : "Content-Security-Policy-Report-Only";
}

/**
 * A fresh nonce, unique per request -- a reused nonce is the same as no nonce.
 *
 * 122 bits from the platform CSPRNG, hex-encoded. Hex is a subset of the CSP
 * grammar's base64-value, so the result needs no escaping on its way into the
 * header. crypto.randomUUID() rather than the Buffer-based encoding the
 * Next.js docs show: this runs on the edge runtime, where Buffer is not
 * guaranteed to exist.
 */
export function generateNonce(): string {
  return crypto.randomUUID().replace(/-/g, "");
}
