import { describe, expect, it } from 'vitest';
import {
  closeVisit,
  createDraftVisit,
  createImportedSections,
  buildTemplateSyncSnapshot,
  buildStatusPointWire,
  getCloseEligibility,
  isSyncDue,
  markSyncError,
  retryDelayMs,
  saveFindingAndStatus,
  setPointStatus,
  migrateVisitToCatalog,
} from '../utils/maintenanceRules';
import {
  buildTemplateMappingsPatch,
  getTemplateExportBlockReason,
  validateTemplateMappings,
} from '../utils/templateValidation';
import type { Finding, Photo, TemplateField, TemplateDescriptor, Visit } from '../types';

const ids = (() => {
  let index = 0;
  return () => `id-${++index}`;
})();
const now = () => '2026-01-02T03:04:05.000Z';

const importedFields: TemplateField[] = [
  { id: 'title', label: 'PRESENTACION', sheet: 'PRESENTACION', section: '', type: 'text', target: { cell: 'A1' }, isTitle: true, editable: false },
  { id: 'status-1', label: 'Estado del equipo', sheet: 'ENERGIA', section: 'Planta', subsection: 'Rectificador', type: 'status', target: { cell: 'B4' }, options: ['OK', 'NOK', 'SC', 'NA'], required: true },
  { id: 'text-1', label: 'Región', sheet: 'PRESENTACION', section: 'Datos', type: 'text', target: { cell: 'B2' }, required: true },
  { id: 'number-1', label: 'Potencia', sheet: 'ENERGIA', section: 'Medidas', type: 'number', target: { cell: 'B5' } },
  { id: 'date-1', label: 'Fecha', sheet: 'PRESENTACION', section: 'Datos', type: 'date', target: { cell: 'B3' } },
  { id: 'selection-1', label: 'Central', sheet: 'PRESENTACION', section: 'Datos', type: 'selection', target: { cell: 'B6' }, options: ['Sí', 'No'] },
  { id: 'measurement-1', label: 'Voltaje', sheet: 'ENERGIA', section: 'Medidas', type: 'measurement', target: { cell: 'B7' } },
  { id: 'observation-1', label: 'Observación', sheet: 'ENERGIA', section: 'Notas', type: 'observation', target: { cell: 'B8' } },
];

function template() {
  return {
    id: 'template-1',
    version: '3',
    hash: 'sha256-template-1',
    schemaVersion: 2,
  };
}

function draft(): Visit {
  return createDraftVisit(
    { template: template(), templateFields: importedFields },
    { id: ids, now },
  );
}

function photo(id: string, type: Photo['type']): Photo {
  return { id, uri: `data:image/jpeg;base64,${id}`, type, timestamp: 1, objectPath: null, uploadStatus: 'pending' };
}

function finding(visit: Visit): Finding {
  const point = visit.sections[0].points[0];
  return {
    id: 'finding-1',
    sectionId: visit.sections[0].id,
    pointId: point.id,
    description: 'Cable deteriorado',
    responsible: 'Mantenimiento',
    priority: 'ALTA',
    startDate: '2026-01-02',
    commitmentDate: '2026-01-03',
    completedDate: null,
    state: 'ABIERTO',
    photos: [photo('before', 'ANTES')],
  };
}

function allStatusPoints(visit: Visit, status: 'OK' | 'NOK' | 'SC' = 'OK'): Visit {
  return {
    ...visit,
    sections: visit.sections.map(section => ({
      ...section,
      points: section.points.map(point => ({ ...point, status })),
    })),
    responses: { ...visit.responses, 'status-1': status, 'text-1': 'Andina' },
  };
}

describe('dynamic template maintenance rules', () => {
  it('creates a pinned draft with every imported response and no title point', () => {
    const visit = draft();
    expect(visit.template).toEqual(template());
    expect(Object.keys(visit.responses)).toHaveLength(importedFields.length);
    expect(visit.sections.flatMap(section => section.points).map(point => point.id)).toEqual(['status-1']);
    expect(createImportedSections(importedFields)[0].points[0].title).toBe('Estado del equipo');
  });

  it('supports every imported response type without synthesizing catalog fields', () => {
    const visit = draft();
    const next = Object.entries({
      'text-1': 'Andina',
      'number-1': 12,
      'date-1': '2026-01-02',
      'selection-1': 'Sí',
      'measurement-1': 48.5,
      'observation-1': 'Sin novedades',
    }).reduce((current, [fieldId, value]) => ({
      ...current,
      responses: { ...current.responses, [fieldId]: value },
    }), visit);
    expect(next.responses).toMatchObject({
      'text-1': 'Andina',
      'number-1': 12,
      'date-1': '2026-01-02',
      'selection-1': 'Sí',
      'measurement-1': 48.5,
      'observation-1': 'Sin novedades',
    });
    expect(createDraftVisit().sections).toEqual([]);
    expect(createDraftVisit().responses).toEqual({});
  });

  it('serializes and restores the exact pinned template, fields and every typed response', () => {
    const visit = draft();
    const filled: Visit = {
      ...visit,
      responses: {
        ...visit.responses,
        'status-1': 'OK',
        'text-1': 'Andina',
        'number-1': 12,
        'date-1': '2026-01-02',
        'selection-1': 'Sí',
        'measurement-1': 48.5,
        'observation-1': 'Sin novedades',
      },
    };
    const restored = JSON.parse(JSON.stringify(buildTemplateSyncSnapshot(filled, importedFields)));
    expect(restored.template).toEqual({ version: 3, sha256: template().hash });
    expect(restored.templateFields).toHaveLength(importedFields.length);
    expect(restored.templateFields.map((field: { id: string }) => field.id)).toEqual(importedFields.map(field => field.id));
    expect(restored.templateFields.find((field: { id: string }) => field.id === 'status-1')).toMatchObject({
      responseType: 'status',
      evidenceSlot: 'photo',
      target: 'ENERGIA!B4',
      options: ['OK', 'NOK', 'SC', 'NA'],
    });
    expect(restored.responses).toEqual(filled.responses);
  });

  it('serializes two status fields onto exactly one owning point each', () => {
    const fields = [
      ...importedFields,
      {
        id: 'status-2',
        label: 'Estado del banco',
        sheet: 'ENERGIA',
        section: 'Planta',
        subsection: 'Banco',
        type: 'status' as const,
        target: { range: 'B10:C10' },
      },
    ];
    const responses = { 'status-1': 'OK', 'status-2': 'NOK', 'text-1': 'Norte' };
    const points = [
      buildStatusPointWire({ id: 'status-1', status: 'PENDING' }, fields, responses),
      buildStatusPointWire({ id: 'status-2', status: 'PENDING' }, fields, responses),
    ];
    const restored = JSON.parse(JSON.stringify({ points }));
    expect(restored.points[0]).toEqual({ fields: { 'status-1': 'OK' }, status: 'OK' });
    expect(restored.points[1]).toEqual({ fields: { 'status-2': 'NOK' }, status: 'NOK' });
    const occurrences = restored.points.flatMap((point: { fields: Record<string, string> }) => Object.keys(point.fields));
    expect(occurrences).toEqual(['status-1', 'status-2']);
    expect(new Set(occurrences).size).toBe(2);
  });

  it('requires imported required fields and a finding/photo for NOK before close', () => {
    let visit = allStatusPoints(draft(), 'NOK');
    expect(getCloseEligibility(visit, importedFields).eligible).toBe(false);
    expect(getCloseEligibility(visit, importedFields).missingItems.join('\n')).toContain('Falta hallazgo');
    visit = saveFindingAndStatus(visit, visit.sections[0].id, 'status-1', 'NOK', finding(visit), { id: ids, now });
    expect(getCloseEligibility(visit, importedFields).eligible).toBe(true);
    visit = { ...visit, responses: { ...visit.responses, 'text-1': '' } };
    expect(getCloseEligibility(visit, importedFields).missingItems.join('\n')).toContain('Campo requerido');
  });

  it('allows a clearly local demo visit to close without a real workbook', () => {
    let visit = allStatusPoints(createDraftVisit({
      templateFields: importedFields,
    }), 'OK');
    visit = { ...visit, demoOnly: true };
    expect(getCloseEligibility(visit).eligible).toBe(true);
    expect(visit.template).toBeUndefined();
    expect(getTemplateExportBlockReason(visit, null)).toContain('Falta cargar');
  });

  it('removes NOK finding evidence when leaving NOK and preserves lifecycle rules', () => {
    const nokDraft = allStatusPoints(draft(), 'NOK');
    let visit = saveFindingAndStatus(nokDraft, nokDraft.sections[0].id, 'status-1', 'NOK', finding(nokDraft), { id: ids, now });
    expect(visit.findings).toHaveLength(1);
    visit = setPointStatus(visit, nokDraft.sections[0].id, 'status-1', 'OK', { id: ids, now });
    expect(visit.findings).toHaveLength(0);
    const closed = closeVisit(allStatusPoints(draft()), { id: 'close', eventType: 'CLOSE_VISIT', occurredAt: now() }, { id: ids, now }, importedFields);
    expect(closed.lifecycleStatus).toBe('CERRADA');
  });

  it('keeps one stable finding for NOK and SC and removes it on OK/NA', () => {
    const scDraft = allStatusPoints(draft(), 'SC');
    const first = saveFindingAndStatus(
      scDraft,
      scDraft.sections[0].id,
      'status-1',
      'SC',
      { ...finding(scDraft), id: 'temporary-id' },
      { id: ids, now },
    );
    expect(first.findings).toHaveLength(1);
    expect(first.findings[0].id).toBe('finding:status-1');
    const replaced = saveFindingAndStatus(
      first,
      first.sections[0].id,
      'status-1',
      'SC',
      { ...finding(first), id: 'another-temporary-id', description: 'Actualizado' },
      { id: ids, now },
    );
    expect(replaced.findings).toHaveLength(1);
    expect(replaced.findings[0].description).toBe('Actualizado');
    expect(setPointStatus(replaced, replaced.sections[0].id, 'status-1', 'NA', { id: ids, now }).findings).toHaveLength(0);
  });

  it('migrates a partial legacy visit without losing responses', () => {
    const legacy = {
      ...draft(),
      templateFields: importedFields.slice(0, 3),
      responses: { 'text-1': 'Conservada', 'legacy-key': 'No se elimina' },
    };
    const result = migrateVisitToCatalog(legacy, importedFields, template());
    expect(result.changed).toBe(true);
    expect((result.visit as Visit & { templateFields?: TemplateField[] }).templateFields).toBeUndefined();
    expect(result.visit.responses['text-1']).toBe('Conservada');
    expect(result.visit.responses['legacy-key']).toBe('No se elimina');
    expect(Object.keys(result.visit.responses)).toHaveLength(importedFields.length + 1);
  });

  it('blocks export without a pinned ready template or with unresolved audit cells', () => {
    const descriptor = (overrides: Partial<TemplateDescriptor> = {}): TemplateDescriptor => ({
      id: 'template-1', version: '3', hash: 'hash', fileName: 'original.xlsx', uploadedAt: now(),
      schemaVersion: 2, ready: true, sheets: 1, sections: 1, fields: 1, unmappedCells: [], ...overrides,
    });
    expect(getTemplateExportBlockReason({}, descriptor())).toBe('Falta cargar la plantilla Excel original');
    expect(getTemplateExportBlockReason({ template: template() }, descriptor({ ready: false }))).toContain('sin mapear');
    expect(getTemplateExportBlockReason({ template: template() }, descriptor())).toBeNull();
  });

  it('validates complete mappings, status options, exact targets and ignore reasons', () => {
    const base = {
      id: 'cell-1', label: 'Estado', fullText: 'Estado del equipo', sheet: 'ENERGIA',
      section: 'Planta', subsection: 'Rectificador', type: 'status' as const,
      options: ['OK', 'NOK', 'SC', 'NA'], required: true, applicability: 'Indoor', evidenceSlot: 'photo' as const,
      target: { cell: 'B4' },
    };
    expect(validateTemplateMappings([base])).toEqual([]);
    expect(validateTemplateMappings([{ ...base, options: ['OK'] }])).not.toEqual([]);
    expect(validateTemplateMappings([{ ...base, ignore: true }])[0].message).toContain('razón');
    expect(validateTemplateMappings([{ ...base, target: {} }])).not.toEqual([]);
    expect(validateTemplateMappings([{ ...base, target: { range: 'B4:C8' } }])).toEqual([]);
    expect(validateTemplateMappings([{ ...base, target: { range: 'B4:C' } }])[0].message).toContain('A1');
    expect(validateTemplateMappings([{ ...base, target: { cell: 'ENERGIA!B4' } }])[0].message).toContain('A1');
    expect(validateTemplateMappings([{ ...base, evidenceSlot: 'invalid' as never }])[0].message).toContain('evidencia');
  });

  it('adapts a descriptor candidate to the exact generated PATCH identity and evidence slot', () => {
    const patch = buildTemplateMappingsPatch([{
      id: 'candidate-photo',
      candidateTarget: 'REPORTE FOTOGRAFICO!B4',
      label: 'Evidencia antes',
      fullText: 'Fotografía del equipo antes de corregir',
      sheet: 'REPORTE FOTOGRAFICO',
      section: 'Evidencias',
      subsection: 'Antes',
      type: 'observation',
      evidenceSlot: 'photo',
      target: { cell: 'B4' },
      options: [],
      required: false,
      applicability: 'NOK',
    }]);
    expect(patch.mappings[0].candidateTarget).toBe('REPORTE FOTOGRAFICO!B4');
    expect(patch.mappings[0].field).toMatchObject({
      target: 'REPORTE FOTOGRAFICO!B4',
      evidenceSlot: 'photo',
      responseType: 'observation',
    });
    const rangePatch = buildTemplateMappingsPatch([{
      id: 'candidate-range',
      candidateTarget: 'REPORTE FOTOGRAFICO!B4:C8',
      label: 'Rango evidencia',
      fullText: 'Rango combinado',
      sheet: 'REPORTE FOTOGRAFICO',
      section: 'Evidencias',
      type: 'text',
      evidenceSlot: 'none',
      target: { range: 'B4:C8' },
    }]);
    expect(rangePatch.mappings[0].candidateTarget).toBe('REPORTE FOTOGRAFICO!B4:C8');
    expect(rangePatch.mappings[0].field?.target).toBe('REPORTE FOTOGRAFICO!B4:C8');
  });

  it('keeps retry scheduling and exponential backoff', () => {
    const visit = draft();
    expect(isSyncDue(visit, 100)).toBe(true);
    expect(retryDelayMs(1)).toBe(2_000);
    expect(retryDelayMs(2)).toBe(4_000);
    expect(retryDelayMs(99)).toBe(3_600_000);
    const error = markSyncError({ ...visit, syncAttemptCount: 2 }, 'offline', 1000);
    expect(error.syncStatus).toBe('ERROR');
    expect(error.nextAttemptAt).toBe(5000);
  });
});