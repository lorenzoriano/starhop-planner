export function downloadFile(file: File) {
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = file.name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function canShareFile(file: File) {
  try { return typeof navigator.share === "function" && !!navigator.canShare?.({files:[file]}); }
  catch { return false; }
}
export async function shareFile(file: File): Promise<"shared" | "cancelled" | "unavailable"> {
  if (!canShareFile(file)) return "unavailable";
  try { await navigator.share({files:[file]}); return "shared"; }
  catch (error) { return error instanceof Error && error.name === "AbortError" ? "cancelled" : "unavailable"; }
}
