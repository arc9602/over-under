import { CreateBetForm } from "@/components/bet/CreateBetForm";
import { multiOptionBetsEnabled } from "@/lib/features";

export default function NewBetPage() {
  return (
    <div className="max-w-lg mx-auto">
      <h1 className="text-2xl font-black mb-6">New Bet</h1>
      <CreateBetForm multiOptionEnabled={multiOptionBetsEnabled()} />
    </div>
  );
}
