import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

// "experimental-edge" is correct here, and it is NOT the same setting as the
// route segment config of the same name. Do not "modernise" this line.
//
// The docs say the opposite, which is the trap. version-15.md says "we will now
// error if `experimental-edge` is used", and route-segment-config/runtime.md
// lists only 'nodejs' | 'edge'. Both are describing `export const runtime` in a
// page/layout/route file. The middleware entry point is validated separately
// and has not moved to the stable value. `next build` on 16.2.11, verbatim:
//
//   Error: Page /middleware provided runtime 'edge', the edge runtime for
//   rendering is currently experimental. Use runtime 'experimental-edge'
//   instead.
//
// So the build refuses 'edge' here and demands 'experimental-edge'. Changing it
// to match the docs breaks the build outright -- which is at least loud.
//
// The file also stays named `middleware` rather than `proxy`, despite the
// deprecation warning the build prints. Per version-16.md: "The `edge` runtime
// is **NOT** supported in `proxy`. The `proxy` runtime is `nodejs`, and it
// cannot be configured. If you want to continue using the `edge` runtime, keep
// using `middleware`." Renaming would silently move session refresh to Node.
export const runtime = "experimental-edge";

export async function middleware(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
