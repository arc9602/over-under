import { CreateMarketForm } from "@/components/market/CreateMarketForm";

export default function NewMarketPage() {
  return (
    <div className="max-w-lg mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold">New Market</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Contracts trade between 1¢ and 99¢ and pay out $1 if they&apos;re right.
        </p>
      </div>
      <CreateMarketForm />
    </div>
  );
}
