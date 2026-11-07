/**
 * @file Browser file helpers.
 */

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);    // revoking immediately can cancel the download
}

export const downloadText = (text: string, filename: string, mime: string) =>
  downloadBlob(new Blob([text], { type: mime }), filename);

/** Opens the file picker; resolves null if the user cancels. */
export function pickFile(accept: string): Promise<File | null> {
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.addEventListener('cancel', () => resolve(null));
    input.click();
  });
}

export const readText = (file: File): Promise<string> =>
  new Promise((ok, fail) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result));
    r.onerror = () => fail(new Error('Could not read the file.'));
    r.readAsText(file);
  });

export const readDataUrl = (file: File): Promise<string> =>
  new Promise((ok, fail) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result));
    r.onerror = () => fail(new Error('Could not read the file.'));
    r.readAsDataURL(file);
  });
