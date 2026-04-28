import { LookbookTemplates } from "@/components/LookbookTemplates";

export default function LookbookPage() {
  return (
    <main className="mx-auto w-full max-w-[1400px] px-3 py-6 sm:px-4 md:px-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold text-white">Lookbook</h1>
        <p className="text-sm text-zinc-300">templates.</p>
      </div>

      <LookbookTemplates />
    </main>
  );
}

