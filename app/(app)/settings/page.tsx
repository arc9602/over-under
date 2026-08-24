import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getOrCreateProfile } from "@/lib/queries/profiles";
import { ProfileSettingsForm } from "@/components/settings/ProfileSettingsForm";

export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Same reasoning as app/(app)/layout.tsx: a missing profile is a
  // provisioning failure, and bouncing an authenticated user to /login over it
  // is a loop, not a fix.
  const profile = await getOrCreateProfile(user);

  return (
    <div className="max-w-lg mx-auto">
      <h1 className="text-2xl font-bold mb-6">Settings</h1>
      <ProfileSettingsForm profile={profile} />
    </div>
  );
}
