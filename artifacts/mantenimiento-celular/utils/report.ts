import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as Print from 'expo-print';
import { Platform } from 'react-native';
import { Visit, Photo } from '../types';

function escapeCSV(val: string | undefined | null) {
  if (!val) return '';
  const stringVal = String(val);
  if (stringVal.includes(',') || stringVal.includes('"') || stringVal.includes('\n')) {
    return `"${stringVal.replace(/"/g, '""')}"`;
  }
  return stringVal;
}

export async function generateAndShareCSV(visit: Visit) {
  const BOM = '\uFEFF';
  const headers = [
    'Sitio ID', 'Sitio Nombre', 'Orden de Trabajo', 'Técnico', 'Fecha',
    'Sección', 'Punto', 'Estado',
    'Hoja', 'Punto', 'A quien corresponde', 'Descripción', 'Fecha de inicio', 'Fecha realizado OK'
  ];

  let csvContent = BOM + headers.join(',') + '\n';

  visit.sections.forEach(section => {
    section.points.forEach(point => {
      const finding = visit.findings.find(f => f.pointId === point.id);
      
      const row = [
        escapeCSV(visit.siteId),
        escapeCSV(visit.siteName),
        escapeCSV(visit.workOrder),
        escapeCSV(visit.technician),
        escapeCSV(new Date(visit.date).toLocaleDateString()),
        escapeCSV(section.title),
        escapeCSV(point.title),
        escapeCSV(point.status),
        finding ? escapeCSV(section.title) : '',
        finding ? escapeCSV(point.title) : '',
        finding ? escapeCSV(finding.responsible) : '',
        finding ? escapeCSV(finding.description) : '',
        finding ? escapeCSV(new Date(visit.date).toLocaleDateString()) : '',
        finding ? escapeCSV(finding.commitmentDate) : '',
      ];

      csvContent += row.join(',') + '\n';
    });
  });

  const filename = `mantenimiento_${visit.siteId}_${visit.workOrder}.csv`;

  if (Platform.OS === 'web') {
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
  } else {
    const uri = FileSystem.cacheDirectory + filename;
    await FileSystem.writeAsStringAsync(uri, csvContent, { encoding: FileSystem.EncodingType.UTF8 });
    await Sharing.shareAsync(uri);
  }
}

async function getImageBase64(uri: string): Promise<string> {
  if (Platform.OS === 'web') {
    return uri; // Web mostly uses data:image or blob:, which Print handles well or we can just fetch and convert.
    // If it's a blob url, we might need to convert it to base64 for window.print to work if it's external, but blob is usually fine.
  }
  
  if (uri.startsWith('data:')) {
    return uri;
  }

  try {
    const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
    const extension = uri.split('.').pop()?.toLowerCase() === 'png' ? 'png' : 'jpeg';
    return `data:image/${extension};base64,${base64}`;
  } catch (error) {
    console.warn('Error reading image to base64', error);
    return uri;
  }
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
          .finding { margin-bottom: 30px; page-break-inside: avoid; border: 1px solid #E2E8F0; padding: 10px; border-radius: 8px; }
          .finding-header { font-weight: bold; margin-bottom: 10px; font-size: 16px; background-color: #F1F5F9; padding: 8px; }
          .photos-grid { display: flex; flex-wrap: wrap; gap: 10px; }
          .photo-card { width: 48%; margin-bottom: 10px; }
          .photo-img { width: 100%; height: 200px; object-fit: contain; border: 1px solid #E2E8F0; border-radius: 4px; }
          .photo-label { font-size: 12px; font-weight: bold; text-align: center; margin-top: 4px; }
          .observations { font-size: 14px; margin-bottom: 10px; }
        </style>
      </head>
      <body>
        <h1>Reporte Fotográfico de Mantenimiento</h1>
        <table class="info-table">
          <tr><th>Sitio ID</th><td>${visit.siteId}</td></tr>
          <tr><th>Nombre del Sitio</th><td>${visit.siteName}</td></tr>
          <tr><th>Orden de Trabajo</th><td>${visit.workOrder}</td></tr>
          <tr><th>Técnico</th><td>${visit.technician}</td></tr>
          <tr><th>Fecha</th><td>${new Date(visit.date).toLocaleDateString()}</td></tr>
        </table>
        <h2>Evidencias de Hallazgos (NOK)</h2>
  `;

  if (visit.findings.length === 0) {
    html += `<p>No se registraron hallazgos (NOK) en esta visita.</p>`;
  } else {
    // Process up to 16 slots total (this is a rough requirement, we can just process all findings).
    // The prompt says "up to 16 photo/evidence slots", we'll just cap the total photos processed.
    let photoCount = 0;

    for (const finding of visit.findings) {
      if (photoCount >= 16) break;

      const section = visit.sections.find(s => s.id === finding.sectionId);
      const point = section?.points.find(p => p.id === finding.pointId);
      
      html += `
        <div class="finding">
          <div class="finding-header">
            Sección: ${section?.title} | Punto: ${point?.title}
          </div>
          <div class="observations">
            <strong>Descripción:</strong> ${finding.description}<br/>
            <strong>Responsable:</strong> ${finding.responsible} | <strong>Fecha Corrección:</strong> ${finding.commitmentDate}
          </div>
          <div class="photos-grid">
      `;

      for (const photo of finding.photos) {
        if (photoCount >= 16) break;
        
        let base64Uri = await getImageBase64(photo.uri);
        
        html += `
            <div class="photo-card">
              <img src="${base64Uri}" class="photo-img" />
              <div class="photo-label">Evidencia: ${photo.type}</div>
            </div>
        `;
        photoCount++;
      }

      html += `
          </div>
        </div>
      `;
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
      // In web, printToFileAsync sometimes returns a blob URL directly
      const link = document.createElement('a');
      link.href = uri;
      link.download = filename;
      link.click();
    } else {
      // Rename file to have a nice filename when sharing
      const newUri = FileSystem.cacheDirectory + filename;
      await FileSystem.moveAsync({ from: uri, to: newUri });
      await Sharing.shareAsync(newUri);
    }
  } catch (error) {
    console.error('Error generating PDF', error);
    alert('Ocurrió un error al generar el PDF.');
  }
}
