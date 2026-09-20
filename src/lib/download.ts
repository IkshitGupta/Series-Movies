import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Share } from 'react-native';

export interface SaveOrShareParams {
  /** File contents — raw bytes (e.g. a ZIP) or text (e.g. a CSV). */
  data: Uint8Array | string;
  /** Suggested file name including extension, e.g. `seen-it-export-2026-08-23.zip`. */
  filename: string;
  /** MIME type, e.g. `application/zip` or `text/csv`. */
  mimeType: string;
  /** Title shown in the native share sheet. */
  dialogTitle?: string;
}

/**
 * Hand a generated file to the user.
 *
 * On native this writes a temp file and opens the OS share sheet (the expected
 * mobile UX). Metro resolves `download.web.ts` for web, which triggers a browser
 * download instead.
 */
export async function saveOrShare({
  data,
  filename,
  mimeType,
  dialogTitle,
}: SaveOrShareParams): Promise<void> {
  const file = new File(Paths.document, filename);
  if (file.exists) file.delete();
  file.create();
  file.write(data);
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(file.uri, { mimeType, dialogTitle });
  } else {
    await Share.share({ url: file.uri, title: dialogTitle ?? filename });
  }
}
