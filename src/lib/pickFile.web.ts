import type { DocumentPickerAsset } from 'expo-document-picker';

/**
 * Read a picked document's bytes on web.
 *
 * The web document picker returns a browser `File` on `asset.file`; we read it
 * via the Blob API. If that's missing we fall back to fetching the asset URI
 * (a blob:/data: URL), which is always readable in the browser.
 *
 * Metro resolves this file for the `web` platform; native uses `pickFile.ts`.
 */
export async function readDocumentBytes(asset: DocumentPickerAsset): Promise<Uint8Array> {
  const file = asset.file as unknown as Blob | undefined;
  if (file) return new Uint8Array(await file.arrayBuffer());
  const res = await fetch(asset.uri);
  return new Uint8Array(await res.arrayBuffer());
}
