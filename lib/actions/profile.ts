"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { lineText } from "@/lib/validation/common";

const updateProfileSchema = z.object({
  // The username regex already excludes everything DECEPTIVE_CHARS covers, so
  // this field needs nothing further. display_name is the one that did: it
  // accepts arbitrary Unicode by design (real names are not ASCII), which is
  // also what made it the place to hide a bidi override or a zero-width
  // character and render as somebody else.
  username: z
    .string()
    .min(3)
    .max(20)
    .regex(/^[a-z0-9_]+$/, "Lowercase letters, numbers, and underscores only"),
  displayName: lineText(1, 50),
  // A checkbox's FormData entry is "on" when checked and absent (null) when
  // not -- there's no unchecked value to read. preprocess turns both of
  // those into a real boolean before the schema sees them.
  discoverableByEmail: z.preprocess((v) => v === "on", z.boolean()),
});

export async function updateProfile(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const parsed = updateProfileSchema.safeParse({
    username: formData.get("username"),
    displayName: formData.get("displayName"),
    discoverableByEmail: formData.get("discoverableByEmail"),
  });

  if (!parsed.success) {
    return { error: "Invalid form data", details: parsed.error.flatten() };
  }

  const { username, displayName, discoverableByEmail } = parsed.data;

  // Only discoverable_by_email is grantable beyond the three columns 017
  // already opened up (username, display_name are two of those three) --
  // migration 021 grants UPDATE on it specifically. Any other new column
  // added to this object will save nothing until a migration grants it too.
  const { error } = await supabase
    .from("profiles")
    .update({
      username,
      display_name: displayName,
      discoverable_by_email: discoverableByEmail,
    })
    .eq("id", user.id);

  if (error) {
    if (error.code === "23505") {
      return { error: "That username is already taken" };
    }
    return { error: error.message };
  }

  revalidatePath("/settings");
  revalidatePath("/dashboard");
  return { success: true };
}
