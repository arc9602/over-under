import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { buttonVariants } from "@/components/ui/button";

export default async function LandingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) redirect("/dashboard");

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 text-center">
      <div className="max-w-md space-y-6">
        <div>
          <h1 className="text-5xl font-black tracking-tighter text-primary">OVER/UNDER</h1>
          <p className="text-muted-foreground mt-2 text-lg">
            Private prediction markets with friends.
          </p>
        </div>

        <div className="space-y-3 text-sm text-muted-foreground max-w-xs mx-auto">
          <p>🎲 Make a bet on anything</p>
          <p>🔗 Share a link, challenge a friend</p>
          <p>✅ Settle it when the event happens</p>
          <p>💰 Track who owes what</p>
        </div>

        <Link href="/login" className={buttonVariants({ className: "font-black px-8 py-6 text-base" })}>
          Continue with Google
        </Link>
      </div>
    </div>
  );
}
