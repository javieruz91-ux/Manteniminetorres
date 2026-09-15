import {
  AuditEvent,
  ChecklistStatus,
  Finding,
  Visit,
  VisitSnapshotSyncStatus,
  TemplateField,
  Section,
  ChecklistPoint,
  CURRENT_CATALOG_SCHEMA_VERSION,
} from '../types';
import { stableTemplateFieldKey, templateFieldRef } from './templateFields';

export interface DraftInput {
  siteId?: string;
  siteName?: string;
  workOrder?: string;
  technician?: string;
  template?: {
    id: string;
    version: string;
    hash: string;
    schemaVersion?: number;
  };
  templateFields?: TemplateField[];
}

export type LegacyVisit = Visit & { templateFields?: TemplateField[] };

export interface DraftDependencies {
  now?: () => string;
  id?: () => string;
}

const isoDate = /^\d{4}-\d{2}-\d{2}$/;
const editableStatuses = new Set(['BORRADOR', 'ABIERTA', 'REABIERTA']);

/** Creates a new local draft without depending on React, storage, or the network. */
export function createDraftVisit(
  data: DraftInput = {},
  dependencies: DraftDependencies = {},
): Visit {
  const now = dependencies.now ?? (() => new Date().toISOString());
  const id = dependencies.id ?? (() => crypto.randomUUID());
  const timestamp = now();
  const templateFields = data.templateFields ?? [];

  return {
    id: id(),
    siteId: data.siteId ?? '',
    siteName: data.siteName ?? '',
    workOrder: data.workOrder ?? '',
    technician: data.technician ?? '',
    visitDate: timestamp,
    clientUpdatedAt: timestamp,
    lifecycleStatus: 'BORRADOR',
    syncStatus: 'PENDIENTE',
    closedAt: null,
    reopenedAt: null,
    serverVersion: 0,
    template: data.template
      ? {
          ...data.template,
          schemaVersion: data.template.schemaVersion ?? CURRENT_CATALOG_SCHEMA_VERSION,
        }
      : undefined,
    responses: Object.fromEntries(templateFields.map(field => [field.id, ''])),
    sections: createImportedSections(templateFields),
    findings: [],
    auditEvents: [],
    operationId: id(),
    syncAttemptCount: 0,
  };
}

/**
 * Legacy Section/ChecklistPoint consumers only receive imported status fields.
 * Every other imported field is rendered from the active catalog/responses.
 */
export function createImportedSections(fields: TemplateField[]): Section[] {
  const grouped = new Map<string, TemplateField[]>();
  for (const field of fields) {
    if (field.type !== 'status' || field.isTitle || field.editable === false) continue;
    const key = `${field.sheet}\u0000${field.section || field.sheet}\u0000${field.subsection || ''}`;
    const existing = grouped.get(key) ?? [];
    existing.push(field);
    grouped.set(key, existing);
  }
  return [...grouped.entries()].map(([key, statusFields]) => {
    const [sheet, section, subsection] = key.split('\u0000');
    const title = subsection ? `${section} · ${subsection}` : section;
    const points: ChecklistPoint[] = statusFields.map(field => ({
      id: field.id,
      title: field.label,
      status: 'PENDING',
    }));
    return {
      id: `${sheet}:${section}:${subsection}`,
      name: sheet,
      title,
      status: 'PENDING',
      points,
    };
  });
}

/** Stable, JSON-safe source-of-truth portion of a visit sync payload. */
export function buildTemplateSyncSnapshot(
  visit: Pick<Visit, 'template' | 'responses'>,
  templateFields: TemplateField[],
): {
  template: { version: number; sha256: string };
  templateFields: Array<{
    id: string;
    sheet: string;
    subsection: string;
    key: string;
    label: string;
    responseType: TemplateField['type'];
    options: string[];
    required: boolean;
    applicability: string;
    evidenceSlot: 'none' | 'photo' | 'observation';
    target: string;
    sourceEvidence: string;
    confidence: number;
    state: 'mapped' | 'ignored' | 'unresolved';
  }>;
  responses: Record<string, string | number | boolean | null>;
} {
  if (!visit.template) throw new Error('Falta cargar la plantilla Excel original.');
  return {
    template: { version: Number(visit.template.version), sha256: visit.template.hash },
    templateFields: templateFields.map(field => {
      const ref = templateFieldRef(field);
      return {
        id: field.id,
        sheet: field.sheet,
        subsection: field.subsection || field.section,
        key: ref || field.id,
        label: field.label,
        responseType: field.type,
        options: field.options || [],
        required: Boolean(field.required),
        applicability: field.applicability || '',
        evidenceSlot: field.evidenceSlot || (field.type === 'observation' ? 'observation' : 'photo'),
        target: `${field.sheet}!${ref}`,
        sourceEvidence: field.fullText || field.label,
        confidence: 1,
        state: field.mapped === false ? 'unresolved' : 'mapped',
      };
    }),
    responses: Object.fromEntries(
      Object.entries(visit.responses ?? {}).filter(([, value]) =>
        value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean',
      ),
    ) as Record<string, string | number | boolean | null>,
  };
}

const WIRE_POINT_STATUSES: ChecklistStatus[] = ['PENDING', 'OK', 'NOK', 'SC', 'NA'];

/**
 * A wire point owns exactly one imported status field. Non-status responses
 * remain in the snapshot-level response map and must never be copied here.
 */
export function buildStatusPointWire(
  point: Pick<ChecklistPoint, 'id' | 'status'>,
  templateFields: TemplateField[],
  responses: Record<string, unknown>,
): { fields: Record<string, string>; status: ChecklistStatus } {
  const field = templateFields.find(candidate => candidate.id === point.id && candidate.type === 'status');
  if (!field) return { fields: {}, status: point.status };
  const response = responses[field.id];
  const status = WIRE_POINT_STATUSES.includes(response as ChecklistStatus)
    ? response as ChecklistStatus
    : point.status;
  return { fields: { [field.id]: status }, status };
}

/** Convenience metadata is derived from imported PRESENTACION responses only. */
export function getVisitConvenienceFields(
  visit: Pick<Visit, 'responses'>,
  templateFields: TemplateField[],
): Pick<Visit, 'siteId' | 'siteName' | 'workOrder' | 'technician'> {
  const presentation = templateFields.filter(
    field => field.sheet.toUpperCase() === 'PRESENTACION',
  );
  const find = (patterns: RegExp[]): string => {
    const field = presentation.find(candidate =>
      patterns.some(pattern => pattern.test(`${candidate.label} ${candidate.fullText ?? ''}`.toLowerCase())),
    );
    const value = field ? visit.responses?.[field.id] : undefined;
    return value == null ? '' : String(value);
  };
  return {
    siteId: find([/mnem[oó]nico/, /\bid\b/]),
    siteName: find([/nombre.*sitio/, /^sitio$/]),
    workOrder: find([/\bwo\b/, /orden.*trabajo/, /work.?order/]),
    technician: find([/ingenier/, /t[eé]cnic/, /responsable/]),
  };
}

function sectionStatus(field: TemplateField, responses: Record<string, unknown>): ChecklistStatus {
  const response = responses[field.id];
  return ['PENDING', 'OK', 'NOK', 'SC', 'NA'].includes(String(response))
    ? response as ChecklistStatus
    : 'PENDING';
}

export function sectionsForCatalog(
  fields: TemplateField[],
  responses: Record<string, unknown>,
): Section[] {
  return createImportedSections(fields).map(section => ({
    ...section,
    points: section.points.map(point => ({
      ...point,
      status: sectionStatus(fields.find(field => field.id === point.id)!, responses),
    })),
  }));
}

export function migrateVisitToCatalog(
  input: LegacyVisit,
  fields: TemplateField[],
  template: NonNullable<Visit['template']>,
  now = () => new Date().toISOString(),
): { visit: Visit; changed: boolean } {
  const legacyFields = Array.isArray(input.templateFields) ? input.templateFields : [];
  const sourceResponses = input.responses && typeof input.responses === 'object'
    ? { ...input.responses }
    : {};
  const byStableKey = new Map(legacyFields.map(field => [stableTemplateFieldKey(field), field]));
  const responses = { ...sourceResponses };
  for (const field of fields) {
    if (Object.prototype.hasOwnProperty.call(responses, field.id)) continue;
    const legacy = byStableKey.get(stableTemplateFieldKey(field));
    responses[field.id] = legacy && Object.prototype.hasOwnProperty.call(sourceResponses, legacy.id)
      ? sourceResponses[legacy.id]
      : '';
  }
  const next: Visit = {
    ...input,
    template: {
      ...template,
      schemaVersion: template.schemaVersion ?? CURRENT_CATALOG_SCHEMA_VERSION,
    },
    responses,
    sections: sectionsForCatalog(fields, responses),
    clientUpdatedAt: input.template?.hash === template.hash &&
      input.template?.schemaVersion === (template.schemaVersion ?? CURRENT_CATALOG_SCHEMA_VERSION) &&
      legacyFields.length === 0
      ? input.clientUpdatedAt
      : now(),
    catalogMigrationNotice: input.template?.hash === template.hash &&
      input.template?.schemaVersion === (template.schemaVersion ?? CURRENT_CATALOG_SCHEMA_VERSION) &&
      legacyFields.length === 0
      ? input.catalogMigrationNotice
      : 'Esta visita fue actualizada con la plantilla completa.',
  };
  const { templateFields: _legacyTemplateFields, ...withoutLegacyFields } = next as Visit & { templateFields?: TemplateField[] };
  void _legacyTemplateFields;
  return {
    visit: withoutLegacyFields,
    changed: legacyFields.length > 0 ||
      input.template?.hash !== template.hash ||
      input.template?.schemaVersion !== (template.schemaVersion ?? CURRENT_CATALOG_SCHEMA_VERSION) ||
      fields.some(field => !Object.prototype.hasOwnProperty.call(sourceResponses, field.id)),
  };
}

/** Continues an editable draft while preserving server/lifecycle metadata. */
export function continueDraftVisit(
  visit: Visit,
  data: DraftInput,
  dependencies: DraftDependencies = {},
): Visit {
  assertVisitEditable(visit);
  const now = dependencies.now ?? (() => new Date().toISOString());
  const id = dependencies.id ?? (() => crypto.randomUUID());
  return {
    ...visit,
    ...data,
    template: data.template
      ? {
          ...data.template,
          schemaVersion: data.template.schemaVersion ?? CURRENT_CATALOG_SCHEMA_VERSION,
        }
      : visit.template,
    clientUpdatedAt: now(),
    operationId: id(),
    syncStatus: 'PENDIENTE',
    syncError: undefined,
    nextAttemptAt: undefined,
  };
}

export function assertVisitEditable(visit: Visit): void {
  if (visit.lifecycleStatus === 'CERRADA') {
    throw new Error('No se puede editar una visita cerrada');
  }
}

export function setPointStatus(
  visit: Visit,
  sectionId: string,
  pointId: string,
  status: ChecklistStatus,
  dependencies: DraftDependencies = {},
): Visit {
  assertVisitEditable(visit);
  const now = dependencies.now ?? (() => new Date().toISOString());
  const id = dependencies.id ?? (() => crypto.randomUUID());
  const sections = visit.sections.map((section) =>
    section.id !== sectionId
      ? section
      : {
          ...section,
          points: section.points.map((point) =>
            point.id === pointId ? { ...point, status } : point,
          ),
        },
  );

  // A finding belongs to a NOK or SC point. Leaving both statuses removes its
  // photos too, rather than leaving detached evidence in local state or sync
  // payloads.
  const findings =
    status === 'NOK' || status === 'SC'
      ? visit.findings
      : visit.findings.filter(
          (finding) =>
            !(finding.sectionId === sectionId && finding.pointId === pointId),
        );
  return {
    ...visit,
    sections,
    findings,
    clientUpdatedAt: now(),
    operationId: id(),
    syncStatus: 'PENDIENTE',
  };
}

export function saveFindingAndStatus(
  visit: Visit,
  sectionId: string,
  pointId: string,
  status: ChecklistStatus,
  finding: Finding | null,
  dependencies: DraftDependencies = {},
): Visit {
  const next = setPointStatus(
    visit,
    sectionId,
    pointId,
    status,
    dependencies,
  );
  if (status !== 'NOK' && status !== 'SC') return next;
  if (!finding) {
    return {
      ...next,
      findings: next.findings.filter(
        (candidate) =>
          !(candidate.sectionId === sectionId && candidate.pointId === pointId),
      ),
    };
  }

  const stableFinding: Finding = {
    ...finding,
    id: `finding:${pointId}`,
    pointId,
    sectionId,
  };
  const findings = next.findings.filter(
    (candidate) => candidate.pointId !== pointId,
  );
  return { ...next, findings: [...findings, stableFinding] };
}

export interface CloseEligibility {
  eligible: boolean;
  generalDataComplete: boolean;
  allPointsEvaluated: boolean;
  allNokHaveFindings: boolean;
  missingItems: string[];
}

export function getCloseEligibility(visit: Visit, templateFields: TemplateField[] = []): CloseEligibility {
  const missingItems: string[] = [];
  const responses = visit.responses ?? {};
  const hasTemplate = Boolean(
    visit.demoOnly || (visit.template?.id && templateFields.length > 0),
  );
  if (!hasTemplate) missingItems.push('Falta cargar la plantilla Excel original.');
  const requiredFields = templateFields.filter(
    field => field.required && !field.isTitle && field.editable !== false,
  );
  const missingRequired = requiredFields.filter(field => {
    const value = responses[field.id];
    return value === undefined || value === null || String(value).trim() === '';
  });
  const generalDataComplete = hasTemplate && missingRequired.length === 0;
  if (!generalDataComplete) missingItems.push('Datos generales del sitio incompletos.');
  for (const field of missingRequired) {
    missingItems.push(`Campo requerido sin completar: ${field.label}`);
  }

  let allPointsEvaluated = true;
  let allNokHaveFindings = true;
  for (const section of visit.sections) {
    for (const point of section.points) {
      if (point.status === 'PENDING') {
        allPointsEvaluated = false;
        missingItems.push(`Punto sin evaluar: ${section.title} - ${point.title}`);
      }
      if (point.status !== 'NOK' && point.status !== 'SC') continue;

      const finding = visit.findings.find(
        (candidate) =>
          candidate.sectionId === section.id && candidate.pointId === point.id,
      );
      if (!finding) {
        allNokHaveFindings = false;
        missingItems.push(`Falta hallazgo para punto NOK: ${section.title} - ${point.title}`);
        continue;
      }
      if (!finding.description?.trim()) {
        allNokHaveFindings = false;
        missingItems.push(`Falta descripción del hallazgo: ${section.title} - ${point.title}`);
      }
      if (!finding.photos.length) {
        allNokHaveFindings = false;
        missingItems.push(`Falta fotografía en hallazgo: ${section.title} - ${point.title}`);
      }
      if (finding.state === 'CORREGIDO') {
        if (!finding.photos.some((photo) => photo.type === 'DESPUES')) {
          allNokHaveFindings = false;
          missingItems.push(`Falta foto DESPUES en hallazgo corregido: ${section.title} - ${point.title}`);
        }
        if (!finding.completedDate || !isoDate.test(finding.completedDate)) {
          allNokHaveFindings = false;
          missingItems.push(`Fecha de corrección inválida en: ${section.title} - ${point.title}`);
        }
      }
    }
  }
  return {
    eligible:
      hasTemplate &&
      templateFields.every(field => field.isTitle || field.editable === false || !field.required ||
        (responses[field.id] !== undefined &&
          responses[field.id] !== null &&
          String(responses[field.id]).trim() !== '')) &&
      generalDataComplete && allPointsEvaluated && allNokHaveFindings,
    generalDataComplete,
    allPointsEvaluated,
    allNokHaveFindings,
    missingItems,
  };
}

export function closeVisit(
  visit: Visit,
  auditEvent: AuditEvent,
  dependencies: DraftDependencies = {},
  templateFields: TemplateField[] = [],
): Visit {
  if (!editableStatuses.has(visit.lifecycleStatus)) {
    throw new Error('Transición inválida: Solo visitas abiertas pueden ser cerradas.');
  }
  if (!getCloseEligibility(visit, templateFields).eligible) {
    throw new Error('La visita no cumple los requisitos para ser cerrada.');
  }
  const now = dependencies.now ?? (() => new Date().toISOString());
  const id = dependencies.id ?? (() => crypto.randomUUID());
  return {
    ...visit,
    lifecycleStatus: 'CERRADA',
    closedAt: now(),
    auditEvents: [...visit.auditEvents, auditEvent],
    nextAttemptAt: Date.now(),
    syncAttemptCount: 0,
    syncStatus: 'PENDIENTE',
    operationId: id(),
    clientUpdatedAt: now(),
  };
}

export function reopenVisit(
  visit: Visit,
  auditEvent: AuditEvent,
  dependencies: DraftDependencies = {},
): Visit {
  if (visit.lifecycleStatus !== 'CERRADA') {
    throw new Error('Transición inválida: Solo visitas cerradas pueden ser reabiertas.');
  }
  const now = dependencies.now ?? (() => new Date().toISOString());
  const id = dependencies.id ?? (() => crypto.randomUUID());
  return {
    ...visit,
    lifecycleStatus: 'REABIERTA',
    reopenedAt: now(),
    auditEvents: [...visit.auditEvents, auditEvent],
    nextAttemptAt: Date.now(),
    syncAttemptCount: 0,
    syncStatus: 'PENDIENTE',
    operationId: id(),
    clientUpdatedAt: now(),
  };
}

export const MAX_RETRY_DELAY_MS = 60 * 60 * 1000;

export function retryDelayMs(attemptCount: number): number {
  return Math.min(1000 * Math.pow(2, Math.max(attemptCount, 1)), MAX_RETRY_DELAY_MS);
}

export function isSyncDue(
  visit: Pick<Visit, 'syncStatus' | 'nextAttemptAt'>,
  now = Date.now(),
): boolean {
  return (
    (visit.syncStatus === 'PENDIENTE' || visit.syncStatus === 'ERROR') &&
    (visit.nextAttemptAt ?? 0) <= now
  );
}

export function markSyncError(
  visit: Visit,
  error: string,
  now = Date.now(),
): Visit {
  const attemptCount = visit.syncAttemptCount ?? 1;
  return {
    ...visit,
    syncStatus: 'ERROR' as VisitSnapshotSyncStatus,
    syncError: error,
    nextAttemptAt: now + retryDelayMs(attemptCount),
  };
}