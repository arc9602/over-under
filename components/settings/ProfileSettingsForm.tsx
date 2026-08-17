"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateProfile } from "@/lib/actions/profile";
import type { Profile } from "@/lib/types";

interface ProfileSettingsFormProps {
  profile: Profile;
}

export function ProfileSettingsForm({ profile }: ProfileSettingsFormProps) {
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = await updateProfile(formData);
      if (result?.error) {
        toast.error(result.error);
      } else {
        toast.success("Profile updated");
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor="displayName">Display Name</Label>
        <Input
          id="displayName"
          name="displayName"
          defaultValue={profile.display_name ?? ""}
          required
          maxLength={50}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="username">Username</Label>
        <Input
          id="username"
          name="username"
          defaultValue={profile.username}
          required
          minLength={3}
          maxLength={20}
          pattern="[a-z0-9_]+"
          title="Lowercase letters, numbers, and underscores only"
          onChange={(e) => {
            e.target.value = e.target.value.toLowerCase().replace(/\s/g, "");
          }}
        />
      </div>

      <div className="space-y-2">
        <label className="flex items-center gap-2 text-sm font-medium cursor-pointer">
          <input
            type="checkbox"
            name="discoverableByEmail"
            defaultChecked={profile.discoverable_by_email}
            className="accent-primary"
          />
          Let people find me by email
        </label>
        <p className="text-xs text-muted-foreground">
          When this is on, anyone who already knows your email address can
          find your account and send you a friend request. Turning it off
          means people can only find you by your username.
        </p>
      </div>

      <Button type="submit" className="w-full font-bold" disabled={isPending}>
        {isPending ? "Saving…" : "Save Changes"}
      </Button>
    </form>
  );
}
