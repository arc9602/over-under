import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AppNav } from "@/components/layout/AppNav";
import { MobileBottomNav } from "@/components/layout/MobileBottomNav";
import { WalletProvider } from "@/components/wallet/WalletProvider";
import type { Profile } from "@/lib/types";

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

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  if (!profile) redirect("/login");

  // Wallet context lives here rather than in the root layout so the auth
  // routes (login, signup) stay server-rendered and free of the Privy bundle.
  // `children` is still server-rendered and passed through as a slot.
  return (
    <WalletProvider>
      <div className="min-h-screen flex flex-col">
        <AppNav profile={profile as Profile} />
        <main className="flex-1 max-w-5xl mx-auto w-full px-4 py-6 pb-20 sm:pb-6">
          {children}
        </main>
        <MobileBottomNav />
      </div>
    </WalletProvider>
  );
}
