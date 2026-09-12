import * as XLSX from 'xlsx';
import { CHECKLIST_SHEETS } from '../data/checklist';
import { Visit } from '../types';

export const PHOTO_SLOT_COUNT = 16;

export interface PhotoSlot {
  slot: number;
  sectionTitle: string;
  pointTitle: string;
  observation: string;
  findingState: string;
  photo: Visit['findings'][number]['photos'][number] | null;
}

export function getNokItems(visit: Visit) {
  return visit.sections.flatMap((section) =>
    section.points
      .filter((point) => point.status === 'NOK')
      .map((point) => ({
        section,
        point,
        finding: visit.findings.find(
          (candidate) =>
            candidate.sectionId === section.id && candidate.pointId === point.id,
        ),
      }))
      .filter(
        (item): item is typeof item & { finding: NonNullable<typeof item.finding> } =>
          Boolean(item.finding),
      ),
  );
}

export function getPhotoSlots(visit: Visit): PhotoSlot[] {
  const slots: PhotoSlot[] = [];
  for (const item of getNokItems(visit)) {
    if (item.finding.photos.length === 0) {
      slots.push({
        slot: slots.length + 1,
        sectionTitle: item.section.title,
        pointTitle: item.point.title,
        observation: item.finding.description,
        findingState: item.finding.state,
        photo: null,
      });
      continue;
    }
    for (const photo of item.finding.photos) {
      slots.push({
        slot: slots.length + 1,
        sectionTitle: item.section.title,
        pointTitle: item.point.title,
        observation: item.finding.description,
        findingState: item.finding.state,
        photo,
      });
    }
  }
  while (slots.length < PHOTO_SLOT_COUNT) {
    slots.push({
      slot: slots.length + 1,
      sectionTitle: '',
      pointTitle: '',
      observation: '',
      findingState: '',
      photo: null,
    });
  }
  return slots;
}

/** Builds the same workbook used by the native/web download wrapper. */
export function buildXLSXWorkbook(visit: Visit): XLSX.WorkBook {
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
    ['Sincronización', visit.syncStatus],
  ];
  const wsPresentation = XLSX.utils.aoa_to_sheet(presentationData);
  wsPresentation['!cols'] = [{ wch: 20 }, { wch: 30 }];
  XLSX.utils.book_append_sheet(wb, wsPresentation, 'PRESENTACION');

  const canonicalSheetNames = CHECKLIST_SHEETS.map((sheet) => sheet.name);
  for (const sheetName of canonicalSheetNames) {
    const section = visit.sections.find(
      (candidate) =>
        candidate.title.toUpperCase() === sheetName ||
        candidate.name.toUpperCase() === sheetName,
    );
    const data: unknown[][] = [
      ['Punto', 'Estado', 'Hallazgo', 'Prioridad', 'Responsable', 'Fecha Compromiso'],
    ];
    if (section) {
      section.points.forEach((point) => {
        const finding = visit.findings.find((candidate) => candidate.pointId === point.id);
        data.push([
          point.title,
          point.status,
          finding ? finding.description : '',
          finding ? finding.priority : '',
          finding ? finding.responsible : '',
          finding ? finding.commitmentDate : '',
        ]);
      });
    }
    const ws = XLSX.utils.aoa_to_sheet(data);
    ws['!cols'] = [
      { wch: 25 },
      { wch: 10 },
      { wch: 40 },
      { wch: 15 },
      { wch: 20 },
      { wch: 15 },
    ];
    ws['!freeze'] = {
      ySplit: 1,
      xSplit: 0,
      topRow: 1,
      activePane: 'bottomLeft',
      state: 'frozen',
    } as any;
    ws['!autofilter'] = { ref: `A1:F${data.length}` };
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
  }

  const segData: unknown[][] = [
    ['Hoja', 'Punto', 'A quien corresponde', 'Descripción', 'Fecha de inicio', 'Fecha realizado OK'],
  ];
  getNokItems(visit).forEach(({ section, point, finding }) => {
    segData.push([
      section.title,
      point.title,
      finding.responsible,
      finding.description,
      finding.startDate,
      finding.state === 'CORREGIDO' && finding.completedDate
        ? finding.completedDate
        : 'PENDIENTE',
    ]);
  });
  const wsSeg = XLSX.utils.aoa_to_sheet(segData);
  wsSeg['!cols'] = [
    { wch: 20 },
    { wch: 25 },
    { wch: 20 },
    { wch: 40 },
    { wch: 15 },
    { wch: 20 },
  ];
  wsSeg['!freeze'] = {
    ySplit: 1,
    xSplit: 0,
    topRow: 1,
    activePane: 'bottomLeft',
    state: 'frozen',
  } as any;
  wsSeg['!autofilter'] = { ref: `A1:F${segData.length}` };
  XLSX.utils.book_append_sheet(wb, wsSeg, 'HOJA DE SEG');

  const photoData: unknown[][] = [
    ['Espacio', 'Hoja', 'Punto', 'Observaciones', 'Estado', 'Tipo de evidencia', 'Estado de Subida', 'Ruta de Archivo'],
  ];
  getPhotoSlots(visit).forEach((slot) => {
    photoData.push([
      String(slot.slot),
      slot.sectionTitle,
      slot.pointTitle,
      slot.observation,
      slot.findingState,
      slot.photo?.type || '',
      slot.photo?.uploadStatus || '',
      slot.photo?.objectPath || '',
    ]);
  });
  const wsPhoto = XLSX.utils.aoa_to_sheet(photoData);
  wsPhoto['!cols'] = [
    { wch: 10 },
    { wch: 22 },
    { wch: 28 },
    { wch: 48 },
    { wch: 14 },
    { wch: 18 },
    { wch: 18 },
    { wch: 50 },
  ];
  wsPhoto['!freeze'] = {
    ySplit: 1,
    xSplit: 0,
    topRow: 1,
    activePane: 'bottomLeft',
    state: 'frozen',
  } as any;
  wsPhoto['!autofilter'] = { ref: `A1:H${photoData.length}` };
  XLSX.utils.book_append_sheet(wb, wsPhoto, 'REPORTE FOTOGRAFICO');

  const expectedSheets = [
    'PRESENTACION',
    ...canonicalSheetNames,
    'HOJA DE SEG',
    'REPORTE FOTOGRAFICO',
  ];
  if (
    wb.SheetNames.length !== expectedSheets.length ||
    !wb.SheetNames.every((name, index) => name === expectedSheets[index])
  ) {
    throw new Error(
      `Error de aserción: el libro debe contener ${expectedSheets.length} hojas en el orden del catálogo.`,
    );
  }
  return wb;
}

function escapeHtml(unsafe: string) {
  return (unsafe || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export async function buildPDFHtml(
  visit: Visit,
  resolveImage: (uri: string) => Promise<string | null> = async (uri) => uri,
): Promise<string> {
  const photoSlots = getPhotoSlots(visit);
  const visibleSlots = photoSlots.slice(0, PHOTO_SLOT_COUNT);
  const overflowSlots = photoSlots.slice(PHOTO_SLOT_COUNT);
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
          
          .photo-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; }
          .photo-slot { min-height: 265px; page-break-inside: avoid; border: 1px solid #CBD5E1; padding: 8px; }
          .slot-number { font-size: 11px; color: #64748B; font-weight: bold; }
          .slot-title { font-size: 12px; font-weight: bold; margin: 4px 0; min-height: 28px; }
          .photo-img { width: 100%; height: 145px; object-fit: contain; border: 1px solid #E2E8F0; }
          .photo-label { font-size: 10px; font-weight: bold; margin-top: 4px; }
          .observations { font-size: 11px; margin: 4px 0; min-height: 30px; }
          .missing-photo { border: 1px dashed #EF4444; height: 145px; display: flex; align-items: center; justify-content: center; color: #DC2626; font-size: 11px; font-weight: bold; }
          .overflow { margin-top: 20px; page-break-before: always; }
          .overflow-row { border-bottom: 1px solid #CBD5E1; padding: 6px 0; font-size: 11px; }
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
        <p>Los espacios 1 a ${PHOTO_SLOT_COUNT} corresponden al formato operativo de reporte fotográfico.</p>
  `;
  if (getNokItems(visit).length === 0) {
    html += `<p>No se registraron hallazgos (NOK) en esta visita. Los espacios quedan disponibles para el formato operativo.</p>`;
  }
  html += `<div class="photo-grid">`;
  for (const slot of visibleSlots) {
    const base64Uri = slot.photo ? await resolveImage(slot.photo.uri) : null;
    const location = [slot.sectionTitle, slot.pointTitle].filter(Boolean).join(' | ');
    html += `
      <div class="photo-slot">
        <div class="slot-number">ESPACIO ${slot.slot}</div>
        <div class="slot-title">${escapeHtml(location || 'Sin hallazgo NOK asignado')}</div>
        ${base64Uri ? `<img src="${base64Uri}" class="photo-img" />` : `<div class="missing-photo">${slot.photo ? 'IMAGEN NO DISPONIBLE' : 'SIN EVIDENCIA'}</div>`}
        <div class="photo-label">${escapeHtml(slot.photo?.type || '')} ${escapeHtml(slot.findingState)}</div>
        <div class="observations"><strong>Observación:</strong> ${escapeHtml(slot.observation || '—')}</div>
      </div>
    `;
  }
  html += `</div>`;
  if (overflowSlots.length > 0) {
    html += `<div class="overflow"><h2>Evidencias adicionales</h2><div class="photo-grid">`;
    for (const slot of overflowSlots) {
      const base64Uri = slot.photo ? await resolveImage(slot.photo.uri) : null;
      html += `
        <div class="photo-slot">
          <div class="slot-number">EVIDENCIA ${slot.slot}</div>
          <div class="slot-title">${escapeHtml(`${slot.sectionTitle} | ${slot.pointTitle}`)}</div>
          ${base64Uri ? `<img src="${base64Uri}" class="photo-img" />` : '<div class="missing-photo">IMAGEN NO DISPONIBLE</div>'}
          <div class="photo-label">${escapeHtml(slot.photo?.type || 'Sin foto')} ${escapeHtml(slot.findingState)}</div>
          <div class="observations"><strong>Observación:</strong> ${escapeHtml(slot.observation || '—')}</div>
        </div>`;
    }
    html += `</div></div>`;
  }
  return `${html}
      </body>
    </html>
  `;
}