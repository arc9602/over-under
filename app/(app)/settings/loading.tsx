import { Skeleton } from "@/components/ui/skeleton";

/**
 * SettingsPage awaits auth then a single-row profile fetch before it can
 * render ProfileSettingsForm -- shape below mirrors that form's two
 * label+input pairs and full-width submit button.
 */
export default function SettingsLoading() {
  return (
    <div className="max-w-lg mx-auto space-y-6">
      <Skeleton className="h-7 w-28" />
      <div className="space-y-5">
        <div className="space-y-2">
          <Skeleton className="h-3.5 w-24" />
          <Skeleton className="h-8 w-full" />
        </div>
        <div className="space-y-2">
          <Skeleton className="h-3.5 w-20" />
          <Skeleton className="h-8 w-full" />
        </div>
        <Skeleton className="h-8 w-full" />
      </div>
    </div>
  );
}
