import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { CHECKLIST_SHEETS } from '../data/checklist';
import { buildPDFHtml, buildXLSXWorkbook } from '../utils/reportCore';
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
    expect(parsed.SheetNames).toEqual([
      'PRESENTACION',
      ...CHECKLIST_SHEETS.map((sheet) => sheet.name),
      'HOJA DE SEG',
      'REPORTE FOTOGRAFICO',
    ]);
    expect(parsed.SheetNames.length).toBe(CHECKLIST_SHEETS.length + 3);
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