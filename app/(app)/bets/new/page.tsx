import { CreateBetForm } from "@/components/bet/CreateBetForm";

export default function NewBetPage() {
  return (
    <div className="max-w-lg mx-auto">
      <h1 className="text-2xl font-black mb-6">New Bet</h1>
      <CreateBetForm />
    </div>
  );
}
