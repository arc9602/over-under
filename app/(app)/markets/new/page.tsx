import { CreateMarketForm } from "@/components/market/CreateMarketForm";

export default function NewMarketPage() {
  return (
    <div className="max-w-lg mx-auto">
      <h1 className="text-2xl font-black mb-2">New Market</h1>
      <p className="text-sm text-muted-foreground mb-6">
        Contracts trade between 1¢ and 99¢ and pay out $1 if they&apos;re right. Buy the side you
        believe; whatever you pay is what you risk.
      </p>
      <CreateMarketForm />
    </div>
  );
}
