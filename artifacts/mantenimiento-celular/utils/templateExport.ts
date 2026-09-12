import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';
import type { TemplateExportResult } from '../lib/templateApi';

/** Persists only the verified bytes returned by the template export endpoint. */
export async function saveAndShareTemplateExport(result: TemplateExportResult): Promise<void> {
  if (!result.base64 || !result.fileName || !result.mime) {
    throw new Error('El servidor no devolvió un archivo verificable.');
  }
  if (Platform.OS === 'web') {
    const binary = atob(result.base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    const blob = new Blob([bytes], { type: result.mime });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = result.fileName;
    link.click();
    URL.revokeObjectURL(url);
    return;
  }
  const uri = `${FileSystem.cacheDirectory}${result.fileName}`;
  await FileSystem.writeAsStringAsync(uri, result.base64, {
    encoding: FileSystem.EncodingType.Base64,
  });
  await Sharing.shareAsync(uri, { mimeType: result.mime, dialogTitle: result.fileName });
}