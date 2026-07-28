"use client";

import { useState, useTransition } from "react";
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
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSuccess(false);
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = await updateProfile(formData);
      if (result?.error) {
        setError(result.error);
      } else {
        setSuccess(true);
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

      {error && <p className="text-sm text-destructive">{error}</p>}
      {success && <p className="text-sm text-primary">Saved.</p>}

      <Button type="submit" className="w-full font-bold" disabled={isPending}>
        {isPending ? "Saving…" : "Save Changes"}
      </Button>
    </form>
  );
}
