import Link from "next/link";
import { Dices } from "lucide-react";
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
      {/* Tinted with the brand accent rather than a neutral secondary --
          this is a state the interface expects and explains, not a null
          result to apologize for. */}
      <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-4">
        <Dices className="size-5 text-primary" strokeWidth={1.5} />
      </div>
      <h3 className="font-semibold text-base">{title}</h3>
      <p className="text-muted-foreground text-sm mt-1 max-w-xs">{description}</p>
      {ctaLabel && ctaHref && (
        <Link href={ctaHref} className={buttonVariants({ className: "mt-4 font-semibold" })}>
          {ctaLabel}
        </Link>
      )}
    </div>
  );
}
