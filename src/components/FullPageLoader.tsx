"use client";

import { Loader2 } from "lucide-react";

export function FullPageLoader({ message }: { message: string }) {
  return (
    <div className="fixed inset-0 z-[500] flex flex-col items-center justify-center gap-4 bg-white/90 backdrop-blur-sm">
      <Loader2 className="h-10 w-10 animate-spin text-blue-600" />
      <p className="text-sm font-semibold text-slate-700">{message}</p>
    </div>
  );
}
