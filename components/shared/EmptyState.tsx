import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

interface EmptyStateProps {
  title: string;
  description: string;
  ctaLabel?: string;
  ctaHref?: string;
}

export function EmptyState({ title, description, ctaLabel, ctaHref }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
      <div className="w-12 h-12 rounded-full bg-secondary flex items-center justify-center mb-4">
        <span className="text-2xl">🎲</span>
      </div>
      <h3 className="font-bold text-lg">{title}</h3>
      <p className="text-muted-foreground text-sm mt-1 max-w-xs">{description}</p>
      {ctaLabel && ctaHref && (
        <Link href={ctaHref} className={buttonVariants({ className: "mt-4 font-bold" })}>
          {ctaLabel}
        </Link>
      )}
    </div>
  );
}
