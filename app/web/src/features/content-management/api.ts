export async function requestApi<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, { credentials: "same-origin", ...options });
  const data = await response.json();
  if (!response.ok) {
    throw Object.assign(
      new Error(typeof data.error === "string" ? data.error : "요청을 완료하지 못했습니다. 다시 확인하십시오."),
      { status: response.status },
    );
  }
  return data as T;
}

export function sendApi<T>(path: string, value: unknown, csrfToken: string): Promise<T> {
  return requestApi<T>(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-csrf-token": csrfToken },
    body: JSON.stringify(value),
  });
}

export async function uploadAttachment(file: File, csrfToken: string) {
  if (file.size > 5 * 1024 * 1024) throw new Error("첨부는 5MiB 이하로 선택하십시오.");
  const chunks: string[] = [];
  for (let start = 0; start < file.size; start += 1024 * 1024) {
    const content = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(",")[1]);
      reader.onerror = () => reject(new Error("첨부를 읽지 못했습니다. 파일을 다시 선택하십시오."));
      reader.readAsDataURL(file.slice(start, start + 1024 * 1024));
    });
    const blob = await sendApi<{ sha: string }>("/api/assets", { content }, csrfToken);
    chunks.push(blob.sha);
  }
  if (!chunks.length) throw new Error("빈 첨부는 업로드할 수 없습니다.");
  const blob = chunks.length === 1
    ? { sha: chunks[0], size: file.size }
    : await sendApi<{ sha: string; size: number }>("/api/assets", { chunks }, csrfToken);
  return { name: file.name, sha: blob.sha, size: blob.size };
}
