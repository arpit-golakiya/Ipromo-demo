import { TemplateDetails } from "@/components/TemplateDetails";

export default async function TemplatePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <main className="mx-auto w-full max-w-[1400px] px-3 py-6 sm:px-4 md:px-6">
      <TemplateDetails
        id={id}
        showSidebar={false}
        backHref="/templates"
        backLabel="Back to Templates"
      />
    </main>
  );
}