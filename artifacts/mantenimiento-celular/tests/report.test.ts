import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { CHECKLIST_SHEETS } from '../data/checklist';
import {
  buildPDFHtml,
  buildXLSXWorkbook,
  CHECKLIST_REPORT_HEADERS,
  PHOTO_REPORT_HEADERS,
  PHOTO_SLOT_COUNT,
  REPORT_WORKBOOK_SHEET_NAMES,
  SEGMENT_REPORT_HEADERS,
} from '../utils/reportCore';
import { createDraftVisit } from '../utils/maintenanceRules';
import { Finding, Visit } from '../types';

function reportVisit(): Visit {
  return createDraftVisit(
    { siteId: 'SITE', siteName: 'Central', workOrder: 'OT-9', technician: 'Técnico' },
    { id: (() => { let n = 0; return () => `id-${++n}`; })(), now: () => '2026-01-02T00:00:00.000Z' },
  );
}

function withFinding(visit: Visit, photoCount: number): Visit {
  const section = visit.sections[0];
  const point = section.points[0];
  const finding: Finding = {
    id: 'finding-1',
    sectionId: section.id,
    pointId: point.id,
    description: 'Observación de prueba',
    responsible: 'Mantenimiento',
    priority: 'MEDIA',
    startDate: '2026-01-01',
    commitmentDate: '2026-01-03',
    completedDate: null,
    state: 'ABIERTO',
    photos: Array.from({ length: photoCount }, (_, index) => ({
      id: `photo-${index + 1}`,
      uri: `data:image/jpeg;base64,photo-${index + 1}`,
      type: index === 0 ? 'ANTES' as const : 'GENERAL' as const,
      timestamp: index,
      objectPath: `/photos/${index + 1}.jpg`,
      uploadStatus: 'uploaded' as const,
    })),
  };
  return {
    ...visit,
    sections: visit.sections.map((candidate) =>
      candidate.id === section.id
        ? { ...candidate, points: candidate.points.map((p) => p.id === point.id ? { ...p, status: 'NOK' as const } : p) }
        : candidate,
    ),
    findings: [finding],
  };
}

describe('runtime report generation', () => {
  it('writes a real XLSX workbook with every catalog sheet', () => {
    const workbook = buildXLSXWorkbook(reportVisit());
    const bytes = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    const parsed = XLSX.read(bytes, { type: 'buffer' });
    expect(parsed.SheetNames).toEqual(REPORT_WORKBOOK_SHEET_NAMES);
    expect(parsed.SheetNames.length).toBe(CHECKLIST_SHEETS.length + 3);
  });

  it('preserves the ten-sheet catalog order, points, headers, and 16 slots', () => {
    expect(CHECKLIST_SHEETS).toHaveLength(10);
    expect(CHECKLIST_SHEETS.map((sheet) => sheet.name)).toEqual([
      'ALARMAS DE FUERZA',
      'PLANTA HUAWEI',
      'INFRAESTRUCTURA',
      'ELECTROMECANICA',
      'TIERRAS',
      'TRANSMISION',
      'RADIOFRECUENCIA',
      'ENERGIA SOLAR',
      'SISTEMA DE SEGURIDAD',
      'OBRA CIVIL',
    ]);
    expect(CHECKLIST_SHEETS[6].points).toEqual([
      'Estado de antenas',
      'Conectores y jumpers',
      'Etiquetado de sectores',
    ]);
    expect(CHECKLIST_SHEETS[7].points).toEqual([
      'Paneles solares',
      'Controlador solar',
      'Cableado solar',
    ]);
    expect(CHECKLIST_SHEETS[8].points).toEqual([
      'CCTV y grabador',
      'Control de acceso',
      'Extintores y señalización',
    ]);
    expect(CHECKLIST_SHEETS[9].points).toEqual([
      'Losa y drenajes',
      'Canalizaciones',
      'Limpieza del sitio',
    ]);
    expect(CHECKLIST_REPORT_HEADERS).toEqual([
      'Punto',
      'Estado',
      'Hallazgo',
      'Prioridad',
      'Responsable',
      'Fecha Compromiso',
    ]);
    expect(SEGMENT_REPORT_HEADERS).toEqual([
      'Hoja',
      'Punto',
      'A quien corresponde',
      'Descripción',
      'Fecha de inicio',
      'Fecha realizado OK',
    ]);
    expect(PHOTO_REPORT_HEADERS).toEqual([
      'Espacio',
      'Hoja',
      'Punto',
      'Observaciones',
      'Estado',
      'Tipo de evidencia',
      'Estado de Subida',
      'Ruta de Archivo',
    ]);
    expect(PHOTO_SLOT_COUNT).toBe(16);
  });

  it('keeps PDF overflow evidence when there are more than 16 photos', async () => {
    const html = await buildPDFHtml(withFinding(reportVisit(), 17), async (uri) => uri);
    expect(html).toContain('ESPACIO 16');
    expect(html).not.toContain('ESPACIO 17');
    expect(html).toContain('Evidencias adicionales');
    expect(html).toContain('Observación de prueba');
    expect(html).toContain('photo-17');
  });
});