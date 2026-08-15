import { CreateBetForm } from "@/components/bet/CreateBetForm";

export default function NewBetPage() {
  return (
    <div className="max-w-lg mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold">New Bet</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Everyone stakes into one pool, and the winning side splits it.
        </p>
      </div>
      <CreateBetForm />
    </div>
  );
}
