import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as Print from 'expo-print';
import { Platform } from 'react-native';
import * as XLSX from 'xlsx';
import { Visit } from '../types';
import {
  buildPDFHtml,
  buildXLSXWorkbook,
  getNokItems,
  getPhotoSlots,
  PHOTO_SLOT_COUNT,
  CHECKLIST_REPORT_HEADERS,
  SEGMENT_REPORT_HEADERS,
  PHOTO_REPORT_HEADERS,
  REPORT_WORKBOOK_SHEET_NAMES,
} from './reportCore';

export {
  buildPDFHtml,
  buildXLSXWorkbook,
  getNokItems,
  getPhotoSlots,
  PHOTO_SLOT_COUNT,
} from './reportCore';

export async function generateAndShareXLSX(visit: Visit) {
  const wb = buildXLSXWorkbook(visit);
  const b64 = XLSXWriteBase64(wb);
  const filename = `mantenimiento_${visit.siteId}_${visit.workOrder}.xlsx`;

  if (Platform.OS === 'web') {
    const blob = new Blob([s2ab(atob(b64))], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
  } else {
    const uri = FileSystem.cacheDirectory + filename;
    await FileSystem.writeAsStringAsync(uri, b64, {
      encoding: FileSystem.EncodingType.Base64,
    });
    await Sharing.shareAsync(uri);
  }
}

function XLSXWriteBase64(workbook: ReturnType<typeof buildXLSXWorkbook>): string {
  return XLSX.write(workbook, { type: 'base64', bookType: 'xlsx' });
}

function s2ab(s: string) {
  const buf = new ArrayBuffer(s.length);
  const view = new Uint8Array(buf);
  for (let i = 0; i !== s.length; ++i) view[i] = s.charCodeAt(i) & 0xff;
  return buf;
}

async function getImageBase64(uri: string): Promise<string | null> {
  if (Platform.OS === 'web') return uri;
  if (uri.startsWith('data:')) return uri;
  try {
    const fileInfo = await FileSystem.getInfoAsync(uri);
    if (!fileInfo.exists) return null;
    const base64 = await FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    const extension = uri.split('.').pop()?.toLowerCase() === 'png' ? 'png' : 'jpeg';
    return `data:image/${extension};base64,${base64}`;
  } catch (error) {
    console.warn('Error reading image to base64', error);
    return null;
  }
}

export async function generateAndSharePDF(visit: Visit) {
  const html = await buildPDFHtml(visit, getImageBase64);
  try {
    const { uri } = await Print.printToFileAsync({ html });
    const filename = `reporte_fotografico_${visit.siteId}_${visit.workOrder}.pdf`;
    if (Platform.OS === 'web') {
      const link = document.createElement('a');
      link.href = uri;
      link.download = filename;
      link.click();
    } else {
      const newUri = FileSystem.cacheDirectory + filename;
      await FileSystem.copyAsync({ from: uri, to: newUri });
      await Sharing.shareAsync(newUri);
    }
  } catch (error) {
    console.error('Error generating PDF', error);
    alert('Ocurrió un error al generar el PDF.');
  }
}