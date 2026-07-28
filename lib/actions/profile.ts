"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

const updateProfileSchema = z.object({
  username: z
    .string()
    .min(3)
    .max(20)
    .regex(/^[a-z0-9_]+$/, "Lowercase letters, numbers, and underscores only"),
  displayName: z.string().min(1).max(50),
});

export async function updateProfile(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const parsed = updateProfileSchema.safeParse({
    username: formData.get("username"),
    displayName: formData.get("displayName"),
  });

  if (!parsed.success) {
    return { error: "Invalid form data", details: parsed.error.flatten() };
  }

  const { username, displayName } = parsed.data;

  const { error } = await supabase
    .from("profiles")
    .update({ username, display_name: displayName })
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
