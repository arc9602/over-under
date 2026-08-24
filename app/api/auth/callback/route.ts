import { createServerClient } from "@supabase/ssr";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import type { Database } from "@/lib/types/database.types";
import { safeRedirectPath } from "@/lib/utils/safeRedirect";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const cookieStore = await cookies();
  const redirect = safeRedirectPath(
    searchParams.get("redirect") ?? cookieStore.get("oauth_redirect")?.value
  );

  /**
   * The bounce back to /login, keeping the destination the user was heading for.
   *
   * Both failure paths used to redirect to a bare
   * /login?error=auth_callback_failed. LoginForm reads its redirect target
   * straight off the URL (LoginForm.tsx:12), so the deep link that started the
   * whole flow was gone by the time the user saw the retry button -- and even a
   * second attempt that worked dropped them on /dashboard instead of the invite
   * or market they had followed. The oauth_redirect cookie could not rescue it,
   * because this handler clears that cookie on its way out.
   *
   * Returning a response other than the one the Supabase client wrote cookies
   * onto is safe here, which is worth stating because the sibling rule in
   * lib/supabase/middleware.ts is the opposite. Route handlers get a merge that
   * middleware does not: next/dist/server/route-modules/app-route/module.js
   * ("It's possible cookies were set in the handler, so we need to merge the
   * modified cookies and the returned response here") reattaches every
   * cookieStore mutation onto whatever response the handler returns. setAll
   * below writes through cookieStore as well as onto `response`, so the
   * framework carries those writes across regardless of which object comes back.
   */
  const failure = () => {
    const url = new URL(`${origin}/login`);
    url.searchParams.set("error", "auth_callback_failed");
    if (redirect !== "/dashboard") {
      url.searchParams.set("redirect", redirect);
    }

    const failed = NextResponse.redirect(url);
    // Cleared on this path too. Failure used to return without touching it,
    // leaving a stale target in the browser for the rest of its 600s max-age,
    // to be picked up by whatever reached this route next.
    failed.cookies.delete("oauth_redirect");
    return failed;
  };

  if (!code) return failure();

  const response = NextResponse.redirect(`${origin}${redirect}`);

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
            response.cookies.set(name, value, options);
          });
        },
      },
    }
  );

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return failure();

  response.cookies.delete("oauth_redirect");
  return response;
}
