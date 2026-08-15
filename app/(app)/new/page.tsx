import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";

const choices = [
  {
    href: "/bets/new",
    title: "New Bet",
    description:
      "Create a private wager, invite friends, and settle it together.",
    action: "Create a bet",
  },
  {
    href: "/markets/new",
    title: "New Market",
    description:
      "Create a prediction market where people can trade Yes and No.",
    action: "Create a market",
  },
];

export default function NewPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Create something new</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Choose what you want to launch.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {choices.map((choice) => (
          <Card key={choice.href}>
            <CardContent className="flex h-full flex-col p-5">
              <h2 className="text-lg font-semibold">{choice.title}</h2>
              <p className="mt-2 flex-1 text-sm text-muted-foreground">
                {choice.description}
              </p>
              <Link
                href={choice.href}
                className={buttonVariants({ className: "mt-5 w-full font-bold" })}
              >
                {choice.action}
              </Link>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
