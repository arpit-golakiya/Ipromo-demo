/** Use lookbook title as download filename; strip characters invalid on common filesystems. */
export function lookbookPdfFilename(title: string): string {
  const base = title.trim() || "lookbook";
  const safe = base.replace(/[/\\?%*:|"<>]/g, "").trim() || "lookbook";
  return `${safe}.pdf`;
}
