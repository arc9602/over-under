import type { User } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/types";

/** Postgres unique_violation. */
const UNIQUE_VIOLATION = "23505";

/** Matches the 20-attempt ceiling in handle_new_user(). */
const MAX_USERNAME_ATTEMPTS = 20;

/**
 * The signed-in user's profile row, created if it does not exist yet.
 *
 * This replaces `if (!profile) redirect("/login")`, which sent a user holding a
 * perfectly valid session back to the login screen. Nothing on /login notices
 * that the visitor is already signed in, so they sign in again, land back on
 * the same page, and hit the same missing row. That is a loop with no exit,
 * because nothing anywhere in it ever creates the row it is waiting for -- and
 * signing in was never going to, since the session was never the problem.
 *
 * A missing profile is a provisioning failure, not an authentication failure.
 * handle_new_user() (supabase/migrations/005_google_oauth_username.sql) is
 * meant to write the row inside the auth.users insert; if that trigger did not
 * run for an account, only a write fixes it. So this writes it, deriving the
 * columns the same way the trigger does. RLS permits it: "Users can insert own
 * profile" is `WITH CHECK (auth.uid() = id)` (002_rls_policies.sql:16-17), so
 * the user's own client can provision the user's own row and nothing else.
 *
 * Read failures throw instead of redirecting. A transient PostgREST error and a
 * genuinely absent row are different problems, and the old code could not tell
 * them apart -- it discarded the error and treated both as "no profile", which
 * made a database hiccup indistinguishable from being signed out.
 */
export async function getOrCreateProfile(user: User): Promise<Profile> {
  const supabase = await createClient();

  // maybeSingle(), not single(): single() reports "no rows" as an error, which
  // is exactly the case this function exists to handle and not an error at all.
  const { data: existing, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();

  if (error) throw error;
  if (existing) return existing as Profile;

  const metadata = user.user_metadata ?? {};
  const emailLocalPart = user.email ? user.email.split("@")[0] : null;

  const displayName =
    metadata.display_name ?? metadata.full_name ?? metadata.name ?? emailLocalPart ?? null;
  const avatarUrl = metadata.avatar_url ?? metadata.picture ?? null;

  const base = usernameBase(
    metadata.username ?? metadata.full_name ?? metadata.name ?? emailLocalPart
  );

  for (let attempt = 0; attempt < MAX_USERNAME_ATTEMPTS; attempt++) {
    const username =
      attempt === 0 ? base : `${base}_${Math.floor(Math.random() * 10000)}`;

    const { data: created, error: insertError } = await supabase
      .from("profiles")
      .insert({
        id: user.id,
        username,
        display_name: displayName,
        avatar_url: avatarUrl,
      })
      .select("*")
      .single();

    if (!insertError) return created as Profile;
    if (insertError.code !== UNIQUE_VIOLATION) throw insertError;

    // Two different collisions arrive as the same error code, and they want
    // opposite responses. A clash on the id primary key means someone else --
    // a concurrent render of this same layout, or the trigger finally firing --
    // already created this user's row, so the work is done and the row is
    // there to be read. A clash on the username unique constraint means the
    // name is taken by a different account, so try another one.
    const { data: raced } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .maybeSingle();

    if (raced) return raced as Profile;
  }

  throw new Error(
    `Could not allocate a username for ${user.id} after ${MAX_USERNAME_ATTEMPTS} attempts`
  );
}

/**
 * The username stem, sanitised to what the column accepts.
 *
 * Deliberately the same derivation as handle_new_user(): lowercase, strip
 * anything outside [a-z0-9_], cap at 20 characters, and fall back to "user"
 * when that leaves nothing -- which a display name in a non-Latin script does.
 */
function usernameBase(raw: unknown): string {
  const cleaned = String(raw ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "")
    .slice(0, 20);

  return cleaned || "user";
}
