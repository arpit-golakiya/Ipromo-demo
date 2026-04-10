import { Suspense } from "react";
import Configurator from "@/components/Configurator";

export default function Home() {
  return (
    <Suspense fallback={null}>
      <Configurator />
    </Suspense>
  );
}
