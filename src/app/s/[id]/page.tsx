import Configurator from "@/components/Configurator";

export default async function SharedConfiguratorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <Configurator shareId={id} />;
}

