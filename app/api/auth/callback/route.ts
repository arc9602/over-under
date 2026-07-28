import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const cookieStore = await cookies();
  // The OAuth (Google) flow can't reliably carry a nested ?redirect= query
  // param through Google's consent screen and back, so it's passed via a
  // short-lived cookie instead. Email-link flows (signup confirmation) don't
  // go through that round-trip and still use the query param directly.
  const redirect =
    searchParams.get("redirect") ?? cookieStore.get("oauth_redirect")?.value ?? "/dashboard";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      const response = NextResponse.redirect(`${origin}${redirect}`);
      response.cookies.delete("oauth_redirect");
      return response;
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`);
}
