import { createInitialSections } from '../data/checklist';
import {
  AuditEvent,
  ChecklistStatus,
  Finding,
  Visit,
  VisitSnapshotSyncStatus,
} from '../types';

export interface DraftInput {
  siteId?: string;
  siteName?: string;
  workOrder?: string;
  technician?: string;
}

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
    sections: createInitialSections(),
    findings: [],
    auditEvents: [],
    operationId: id(),
    syncAttemptCount: 0,
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

  // A finding belongs to a NOK point. Leaving NOK must remove its photos too,
  // rather than leaving detached evidence in local state or sync payloads.
  const findings =
    status === 'NOK'
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
  if (status !== 'NOK') return next;
  if (!finding) {
    return {
      ...next,
      findings: next.findings.filter(
        (candidate) =>
          !(candidate.sectionId === sectionId && candidate.pointId === pointId),
      ),
    };
  }

  const findings = next.findings.filter(
    (candidate) => candidate.id !== finding.id && candidate.pointId !== pointId,
  );
  return { ...next, findings: [...findings, finding] };
}

export interface CloseEligibility {
  eligible: boolean;
  generalDataComplete: boolean;
  allPointsEvaluated: boolean;
  allNokHaveFindings: boolean;
  missingItems: string[];
}

export function getCloseEligibility(visit: Visit): CloseEligibility {
  const missingItems: string[] = [];
  const generalDataComplete = Boolean(
    visit.siteId && visit.siteName && visit.workOrder && visit.technician,
  );
  if (!generalDataComplete) missingItems.push('Datos generales del sitio incompletos.');

  let allPointsEvaluated = true;
  let allNokHaveFindings = true;
  for (const section of visit.sections) {
    for (const point of section.points) {
      if (point.status === 'PENDING') {
        allPointsEvaluated = false;
        missingItems.push(`Punto sin evaluar: ${section.title} - ${point.title}`);
      }
      if (point.status !== 'NOK') continue;

      const finding = visit.findings.find(
        (candidate) =>
          candidate.sectionId === section.id && candidate.pointId === point.id,
      );
      if (!finding) {
        allNokHaveFindings = false;
        missingItems.push(`Falta hallazgo para punto NOK: ${section.title} - ${point.title}`);
        continue;
      }
      if (!finding.description || !finding.responsible || !isoDate.test(finding.commitmentDate)) {
        allNokHaveFindings = false;
        missingItems.push(`Datos de hallazgo incompletos en: ${section.title} - ${point.title}`);
      }
      if (!finding.photos.some((photo) => photo.type === 'ANTES')) {
        allNokHaveFindings = false;
        missingItems.push(`Falta foto ANTES en hallazgo: ${section.title} - ${point.title}`);
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
    eligible: generalDataComplete && allPointsEvaluated && allNokHaveFindings,
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
): Visit {
  if (!editableStatuses.has(visit.lifecycleStatus)) {
    throw new Error('Transición inválida: Solo visitas abiertas pueden ser cerradas.');
  }
  if (!getCloseEligibility(visit).eligible) {
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