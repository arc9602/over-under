import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getOrCreateProfile } from "@/lib/queries/profiles";
import { AppNav } from "@/components/layout/AppNav";
import { MobileBottomNav } from "@/components/layout/MobileBottomNav";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  // Missing profile used to redirect here too, which was the bug: /login has
  // no idea the visitor is already signed in, so it offers the one action that
  // cannot help -- signing in again -- and the next render lands right back
  // here. getOrCreateProfile provisions the row instead, and lets a genuine
  // read failure surface as an error rather than as a silent logout.
  const profile = await getOrCreateProfile(user);

  // No wallet provider here. It used to wrap this whole tree, which put
  // @privy-io/react-auth (and transitively @reown/appkit and @metamask/sdk)
  // into the Cloudflare server bundle -- client components are still
  // server-rendered -- producing a 23 MB handler against a 3 MiB Worker limit.
  // The provider now lives inside AppNav via WalletWidget, scoped to the only
  // subtree that consumes wallet context and loaded browser-side only.
  return (
    <div className="min-h-screen flex flex-col">
      <AppNav profile={profile} />
      <main className="flex-1 max-w-5xl mx-auto w-full px-4 py-6 pb-20 lg:pb-6">
        {children}
      </main>
      <MobileBottomNav />
    </div>
  );
}
