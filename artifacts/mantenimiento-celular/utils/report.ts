import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as Print from 'expo-print';
import { Platform } from 'react-native';
import { Visit } from '../types';
import * as XLSX from 'xlsx';

export async function generateAndShareXLSX(visit: Visit) {
  const wb = XLSX.utils.book_new();

  const presentationData = [
    ['REPORTE DE MANTENIMIENTO PREVENTIVO'],
    [],
    ['Sitio ID', visit.siteId],
    ['Nombre del Sitio', visit.siteName],
    ['Orden de Trabajo', visit.workOrder],
    ['Técnico', visit.technician],
    ['Fecha', new Date(visit.visitDate).toLocaleDateString()],
    ['Ciclo de Vida', visit.lifecycleStatus],
    ['Sincronización', visit.syncStatus]
  ];
  const wsPresentation = XLSX.utils.aoa_to_sheet(presentationData);
  wsPresentation['!cols'] = [{ wch: 20 }, { wch: 30 }];
  XLSX.utils.book_append_sheet(wb, wsPresentation, 'PRESENTACION');

  const SHEET_NAMES = [
    'ALARMAS DE FUERZA', 'PLANTA HUAWEI', 'INFRAESTRUCTURA', 
    'ELECTROMECANICA', 'TIERRAS', 'TRANSMISION'
  ];

  const CANONICAL_SHEETS = [
    'ALARMAS DE FUERZA', 'PLANTA HUAWEI', 'INFRAESTRUCTURA', 
    'ELECTROMECANICA', 'TIERRAS', 'TRANSMISION'
  ];

  for (const sheetName of CANONICAL_SHEETS) {
    const section = visit.sections.find(s => s.title.toUpperCase() === sheetName || s.name.toUpperCase() === sheetName);
    const data = [
      ['Punto', 'Estado', 'Hallazgo', 'Prioridad', 'Responsable', 'Fecha Compromiso']
    ];
    
    if (section) {
      section.points.forEach(point => {
        const finding = visit.findings.find(f => f.pointId === point.id);
        data.push([
          point.title,
          point.status,
          finding ? finding.description : '',
          finding ? finding.priority : '',
          finding ? finding.responsible : '',
          finding ? finding.commitmentDate : ''
        ]);
      });
    }
    
    const ws = XLSX.utils.aoa_to_sheet(data);
    ws['!cols'] = [{ wch: 25 }, { wch: 10 }, { wch: 40 }, { wch: 15 }, { wch: 20 }, { wch: 15 }];
    ws['!freeze'] = { ySplit: 1, xSplit: 0, topRow: 1, activePane: 'bottomLeft', state: 'frozen' } as any;
    ws['!autofilter'] = { ref: `A1:F${data.length}` };
    
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
  }

  const segData = [
    ['Hoja', 'Punto', 'A quien corresponde', 'Descripción', 'Fecha de inicio', 'Fecha realizado OK']
  ];
  visit.sections.forEach(section => {
    section.points.forEach(point => {
      const finding = visit.findings.find(f => f.pointId === point.id);
      if (finding) {
        segData.push([
          section.title,
          point.title,
          finding.responsible,
          finding.description,
          finding.startDate,
          finding.state === 'CORREGIDO' && finding.completedDate ? finding.completedDate : 'PENDIENTE'
        ]);
      }
    });
  });
  const wsSeg = XLSX.utils.aoa_to_sheet(segData);
  wsSeg['!cols'] = [{ wch: 20 }, { wch: 25 }, { wch: 20 }, { wch: 40 }, { wch: 15 }, { wch: 20 }];
  wsSeg['!freeze'] = { ySplit: 1, xSplit: 0, topRow: 1, activePane: 'bottomLeft', state: 'frozen' } as any;
  wsSeg['!autofilter'] = { ref: `A1:F${segData.length}` };
  XLSX.utils.book_append_sheet(wb, wsSeg, 'HOJA DE SEG');

  const photoData = [
    ['Punto', 'Tipo', 'Estado de Subida', 'Ruta de Archivo']
  ];
  visit.findings.forEach(f => {
    const section = visit.sections.find(s => s.id === f.sectionId);
    const point = section?.points.find(p => p.id === f.pointId);
    f.photos.forEach(p => {
      photoData.push([
        point ? point.title : '',
        p.type,
        p.uploadStatus,
        p.objectPath || 'N/A'
      ]);
    });
  });
  const wsPhoto = XLSX.utils.aoa_to_sheet(photoData);
  wsPhoto['!cols'] = [{ wch: 25 }, { wch: 15 }, { wch: 15 }, { wch: 50 }];
  wsPhoto['!freeze'] = { ySplit: 1, xSplit: 0, topRow: 1, activePane: 'bottomLeft', state: 'frozen' } as any;
  wsPhoto['!autofilter'] = { ref: `A1:D${photoData.length}` };
  XLSX.utils.book_append_sheet(wb, wsPhoto, 'REPORTE FOTOGRAFICO');

  const EXPECTED_SHEETS = ['PRESENTACION', ...CANONICAL_SHEETS, 'HOJA DE SEG', 'REPORTE FOTOGRAFICO'];
  if (wb.SheetNames.length !== 9 || !wb.SheetNames.every((name, i) => name === EXPECTED_SHEETS[i])) {
    throw new Error("Error de aserción: La estructura del archivo Excel no coincide con el estándar requerido (exactamente 9 hojas).");
  }

  const b64 = XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });
  const filename = `mantenimiento_${visit.siteId}_${visit.workOrder}.xlsx`;

  if (Platform.OS === 'web') {
    const blob = new Blob([s2ab(atob(b64))], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
  } else {
    const uri = FileSystem.cacheDirectory + filename;
    await FileSystem.writeAsStringAsync(uri, b64, { encoding: FileSystem.EncodingType.Base64 });
    await Sharing.shareAsync(uri);
  }
}

function s2ab(s: string) {
  const buf = new ArrayBuffer(s.length);
  const view = new Uint8Array(buf);
  for (let i=0; i!==s.length; ++i) view[i] = s.charCodeAt(i) & 0xFF;
  return buf;
}

async function getImageBase64(uri: string): Promise<string | null> {
  if (Platform.OS === 'web') return uri;
  if (uri.startsWith('data:')) return uri;

  try {
    const fileInfo = await FileSystem.getInfoAsync(uri);
    if (!fileInfo.exists) return null;
    const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
    const extension = uri.split('.').pop()?.toLowerCase() === 'png' ? 'png' : 'jpeg';
    return `data:image/${extension};base64,${base64}`;
  } catch (error) {
    console.warn('Error reading image to base64', error);
    return null;
  }
}

function escapeHtml(unsafe: string) {
  return (unsafe || '').replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

export async function generateAndSharePDF(visit: Visit) {
  let html = `
    <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: 'Helvetica', 'Arial', sans-serif; color: #0F172A; padding: 20px; }
          h1 { color: #FF6B00; border-bottom: 2px solid #FF6B00; padding-bottom: 10px; }
          .info-table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
          .info-table th, .info-table td { border: 1px solid #E2E8F0; padding: 8px; text-align: left; }
          .info-table th { background-color: #F8FAFC; width: 30%; }
          .finding { margin-bottom: 30px; border: 1px solid #E2E8F0; padding: 10px; border-radius: 8px; }
  .photo-card { width: 100%; margin-bottom: 20px; page-break-inside: avoid; border: 1px solid #E2E8F0; padding: 10px; border-radius: 8px; }
          .finding-header { font-weight: bold; margin-bottom: 10px; font-size: 16px; background-color: #F1F5F9; padding: 8px; }
          .photos-grid { display: flex; flex-wrap: wrap; gap: 10px; }
          
          .photo-img { width: 100%; height: 200px; object-fit: contain; border: 1px solid #E2E8F0; border-radius: 4px; }
          .photo-label { font-size: 12px; font-weight: bold; text-align: center; margin-top: 4px; }
          .observations { font-size: 14px; margin-bottom: 10px; }
          .missing-photo { border: 1px dashed red; height: 200px; display: flex; align-items: center; justify-content: center; color: red; font-size: 12px; font-weight: bold; }
        </style>
      </head>
      <body>
        <h1>Reporte Fotográfico de Mantenimiento</h1>
        <table class="info-table">
          <tr><th>Sitio ID</th><td>${escapeHtml(visit.siteId)}</td></tr>
          <tr><th>Nombre del Sitio</th><td>${escapeHtml(visit.siteName)}</td></tr>
          <tr><th>Orden de Trabajo</th><td>${escapeHtml(visit.workOrder)}</td></tr>
          <tr><th>Técnico</th><td>${escapeHtml(visit.technician)}</td></tr>
          <tr><th>Fecha</th><td>${escapeHtml(new Date(visit.visitDate).toLocaleDateString())}</td></tr>
        </table>
        <h2>Evidencias de Hallazgos (NOK)</h2>
  `;

  if (visit.findings.length === 0) {
    html += `<p>No se registraron hallazgos (NOK) en esta visita.</p>`;
  } else {
    for (const finding of visit.findings) {
      const section = visit.sections.find(s => s.id === finding.sectionId);
      const point = section?.points.find(p => p.id === finding.pointId);
      
      const headerHtml = `
          <div class="finding-header" style="font-weight: bold; font-size: 16px; background-color: #F1F5F9; padding: 8px; margin-bottom: 10px;">
            Sección: ${escapeHtml(section?.title || '')} | Punto: ${escapeHtml(point?.title || '')}
          </div>
          <div class="observations" style="font-size: 14px; margin-bottom: 10px;">
            <strong>Descripción:</strong> ${escapeHtml(finding.description)}<br/>
            <strong>Responsable:</strong> ${escapeHtml(finding.responsible)} | <strong>Fecha Corrección:</strong> ${escapeHtml(finding.commitmentDate)} | <strong>Estado:</strong> ${escapeHtml(finding.state)}
          </div>
      `;

      html += `<div class="finding">`;
      html += headerHtml;
      
      if (finding.photos.length === 0) {
        html += `<p>No hay fotos registradas.</p>`;
      } else {
        html += `<div class="photos-grid" style="display: block;">`;
        for (const photo of finding.photos) {
          let base64Uri = await getImageBase64(photo.uri);
          
          if (base64Uri) {
            html += `
                <div class="photo-card" style="page-break-inside: avoid; border: 1px solid #E2E8F0; padding: 10px; margin-bottom: 20px;">
                  ${headerHtml}
                  <img src="${base64Uri}" class="photo-img" style="max-height: 400px;" />
                  <div class="photo-label">Evidencia: ${escapeHtml(photo.type)}</div>
                </div>
            `;
          } else {
            html += `
                <div class="photo-card" style="page-break-inside: avoid; border: 1px solid #E2E8F0; padding: 10px; margin-bottom: 20px;">
                  ${headerHtml}
                  <div class="missing-photo" style="height: 400px; border: 1px dashed red; display: flex; align-items: center; justify-content: center; color: red;">IMAGEN NO DISPONIBLE</div>
                  <div class="photo-label">Evidencia: ${escapeHtml(photo.type)} (Falta Archivo Local)</div>
                </div>
            `;
          }
        }
        html += `</div>`;
      }
      html += `</div>`;
    }
  }

  html += `
      </body>
    </html>
  `;

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