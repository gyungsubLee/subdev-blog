export function downloadFile(
  name,
  contents,
  mime = "text/markdown;charset=utf-8",
) {
  const link = document.createElement("a");
  const url = URL.createObjectURL(new Blob([contents], { type: mime }));
  link.href = url;
  link.download = name.replace(/[\\/:*?"<>|]/g, "-");
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
