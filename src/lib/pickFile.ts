import type { DocumentPickerAsset } from 'expo-document-picker';
import { File } from 'expo-file-system';

/**
 * Read a picked document's bytes on native via expo-file-system.
 *
 * Metro resolves `pickFile.web.ts` for the web platform, which reads the
 * browser `File`/blob the web document picker returns instead.
 */
export async function readDocumentBytes(asset: DocumentPickerAsset): Promise<Uint8Array> {
  return new File(asset.uri).bytes();
}
