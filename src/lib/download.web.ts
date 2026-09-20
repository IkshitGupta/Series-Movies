import type { SaveOrShareParams } from '@/lib/download';

/**
 * Trigger a browser download of a generated file (Blob + object URL + anchor).
 *
 * Web counterpart of the native share-sheet `saveOrShare`. Metro resolves this
 * file for the `web` platform; native uses `download.ts`.
 */
export async function saveOrShare({ data, filename, mimeType }: SaveOrShareParams): Promise<void> {
  // `data` is always a plain Uint8Array or string at runtime; the cast placates
  // the DOM lib's stricter `BlobPart` (ArrayBufferView<ArrayBuffer>) typing.
  const blob = new Blob([data as BlobPart], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Revoke on the next tick so the download has started.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
