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

function serializedWorkbook(visit: Visit): XLSX.WorkBook {
  const bytes = XLSX.write(buildXLSXWorkbook(visit), {
    type: 'buffer',
    bookType: 'xlsx',
  });
  return XLSX.read(bytes, { type: 'buffer' });
}

function rows(workbook: XLSX.WorkBook, sheetName: string): unknown[][] {
  return XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
    header: 1,
    defval: '',
    blankrows: false,
  }) as unknown[][];
}

function findingFor(
  visit: Visit,
  sectionIndex: number,
  pointIndex: number,
  id: string,
  state: Finding['state'],
): Finding {
  const section = visit.sections[sectionIndex];
  const point = section.points[pointIndex];
  const photos = (['ANTES', 'DESPUES'] as const).map((type, index) => ({
    id: `${id}-photo-${type.toLowerCase()}`,
    uri: `data:image/jpeg;base64,${id}-${type.toLowerCase()}`,
    type,
    timestamp: index,
    objectPath: `/photos/${id}-${type.toLowerCase()}.jpg`,
    uploadStatus: 'uploaded' as const,
  }));

  return {
    id,
    sectionId: section.id,
    pointId: point.id,
    description: `Observación ${id}`,
    responsible: `Responsable ${id}`,
    priority: 'ALTA',
    startDate: '2026-01-01',
    commitmentDate: '2026-01-03',
    completedDate: state === 'CORREGIDO' ? '2026-01-04' : null,
    state,
    photos,
  };
}

function withFindings(visit: Visit): Visit {
  const firstFinding = findingFor(visit, 0, 0, 'finding-first', 'ABIERTO');
  const secondFinding = findingFor(visit, 1, 1, 'finding-second', 'CORREGIDO');
  const nokPointIds = new Set([firstFinding.pointId, secondFinding.pointId]);

  return {
    ...visit,
    sections: visit.sections.map((section) => ({
      ...section,
      points: section.points.map((point) =>
        nokPointIds.has(point.id) ? { ...point, status: 'NOK' as const } : point,
      ),
    })),
    findings: [firstFinding, secondFinding],
  };
}

describe('runtime report generation', () => {
  it('writes a real XLSX workbook with every catalog sheet', () => {
    const workbook = serializedWorkbook(reportVisit());
    expect(workbook.SheetNames).toEqual(REPORT_WORKBOOK_SHEET_NAMES);
    expect(workbook.SheetNames.length).toBe(CHECKLIST_SHEETS.length + 3);
  });

  it('keeps the catalog order, headers, and 16 slots for a visit without NOK', () => {
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

    const workbook = serializedWorkbook(reportVisit());
    for (const [index, sheet] of CHECKLIST_SHEETS.entries()) {
      const sheetRows = rows(workbook, sheet.name);
      expect(sheetRows).toHaveLength(sheet.points.length + 1);
      expect(sheetRows[0]).toEqual([...CHECKLIST_REPORT_HEADERS]);
      expect(sheetRows.slice(1).map((row) => row[0])).toEqual([...sheet.points]);
      expect(sheetRows.slice(1).every((row) =>
        row.length === CHECKLIST_REPORT_HEADERS.length &&
        row[1] === 'PENDING' &&
        row.slice(2).every((value) => value === ''),
      )).toBe(true);
      expect(workbook.SheetNames[index + 1]).toBe(sheet.name);
    }

    expect(rows(workbook, 'HOJA DE SEG')).toEqual([SEGMENT_REPORT_HEADERS]);
    const photoRows = rows(workbook, 'REPORTE FOTOGRAFICO');
    expect(photoRows).toHaveLength(PHOTO_SLOT_COUNT + 1);
    expect(photoRows[0]).toEqual([...PHOTO_REPORT_HEADERS]);
    expect(photoRows.slice(1).map((row) => row[0])).toEqual(
      Array.from({ length: PHOTO_SLOT_COUNT }, (_, index) => String(index + 1)),
    );
    expect(photoRows.slice(1).every((row) =>
      row.length === PHOTO_REPORT_HEADERS.length &&
      row.slice(1).every((value) => value === ''),
    )).toBe(true);
  });

  it('keeps NOK findings linked to follow-up rows and photo slots in order', () => {
    const workbook = serializedWorkbook(withFindings(reportVisit()));

    const firstSectionRows = rows(workbook, CHECKLIST_SHEETS[0].name);
    expect(firstSectionRows[1]).toEqual([
      'Falla de AC',
      'NOK',
      'Observación finding-first',
      'ALTA',
      'Responsable finding-first',
      '2026-01-03',
    ]);

    const secondSectionRows = rows(workbook, CHECKLIST_SHEETS[1].name);
    expect(secondSectionRows[2]).toEqual([
      'Baterías y cableado',
      'NOK',
      'Observación finding-second',
      'ALTA',
      'Responsable finding-second',
      '2026-01-03',
    ]);

    expect(rows(workbook, 'HOJA DE SEG')).toEqual([
      [...SEGMENT_REPORT_HEADERS],
      [
        'Alarmas de fuerza',
        'Falla de AC',
        'Responsable finding-first',
        'Observación finding-first',
        '2026-01-01',
        'PENDIENTE',
      ],
      [
        'Planta Huawei',
        'Baterías y cableado',
        'Responsable finding-second',
        'Observación finding-second',
        '2026-01-01',
        '2026-01-04',
      ],
    ]);

    const photoRows = rows(workbook, 'REPORTE FOTOGRAFICO');
    expect(photoRows).toHaveLength(PHOTO_SLOT_COUNT + 1);
    expect(photoRows.slice(1, 5)).toEqual([
      ['1', 'Alarmas de fuerza', 'Falla de AC', 'Observación finding-first', 'ABIERTO', 'ANTES', 'uploaded', '/photos/finding-first-antes.jpg'],
      ['2', 'Alarmas de fuerza', 'Falla de AC', 'Observación finding-first', 'ABIERTO', 'DESPUES', 'uploaded', '/photos/finding-first-despues.jpg'],
      ['3', 'Planta Huawei', 'Baterías y cableado', 'Observación finding-second', 'CORREGIDO', 'ANTES', 'uploaded', '/photos/finding-second-antes.jpg'],
      ['4', 'Planta Huawei', 'Baterías y cableado', 'Observación finding-second', 'CORREGIDO', 'DESPUES', 'uploaded', '/photos/finding-second-despues.jpg'],
    ]);
    expect(photoRows.slice(5).map((row) => row[0])).toEqual(
      Array.from({ length: PHOTO_SLOT_COUNT - 4 }, (_, index) => String(index + 5)),
    );
    expect(photoRows.slice(5).every((row) =>
      row.length === PHOTO_REPORT_HEADERS.length &&
      row.slice(1).every((value) => value === ''),
    )).toBe(true);
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