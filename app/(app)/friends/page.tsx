import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  getFriendRequestsForUser,
  getFriendsForUser,
} from "@/lib/queries/friends";
import { FriendsPageClient } from "@/components/friends/FriendsPageClient";

export default async function FriendsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [friends, requests] = await Promise.all([
    getFriendsForUser(user.id),
    getFriendRequestsForUser(user.id),
  ]);

  return (
    <div className="mx-auto max-w-2xl">
      <FriendsPageClient
        friends={friends}
        incoming={requests.incoming}
        outgoing={requests.outgoing}
      />
    </div>
  );
}
