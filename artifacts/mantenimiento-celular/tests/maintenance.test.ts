import { describe, expect, it } from 'vitest';
import {
  closeVisit,
  continueDraftVisit,
  createDraftVisit,
  getCloseEligibility,
  isSyncDue,
  markSyncError,
  reopenVisit,
  retryDelayMs,
  saveFindingAndStatus,
  setPointStatus,
} from '../utils/maintenanceRules';
import { Finding, Photo, Visit } from '../types';

const ids = (() => {
  let index = 0;
  return () => `id-${++index}`;
})();
const now = () => '2026-01-02T03:04:05.000Z';

function draft(): Visit {
  return createDraftVisit(
    { siteId: 'S1', siteName: 'Sitio', workOrder: 'OT-1', technician: 'Ana' },
    { id: ids, now },
  );
}

function photo(id: string, type: Photo['type']): Photo {
  return {
    id,
    uri: `data:image/jpeg;base64,${id}`,
    type,
    timestamp: 1,
    objectPath: null,
    uploadStatus: 'pending',
  };
}

function completeFinding(visit: Visit): Finding {
  return {
    id: 'finding-1',
    sectionId: visit.sections[0].id,
    pointId: visit.sections[0].points[0].id,
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

function allPoints(visit: Visit, status: 'OK' | 'NOK' = 'OK'): Visit {
  return {
    ...visit,
    sections: visit.sections.map((section) => ({
      ...section,
      points: section.points.map((point) => ({ ...point, status })),
    })),
  };
}

describe('maintenance business rules', () => {
  it('creates and continues a draft with fresh operation metadata', () => {
    const visit = draft();
    const continued = continueDraftVisit(
      visit,
      { siteName: 'Sitio actualizado' },
      { id: ids, now: () => '2026-01-03T03:04:05.000Z' },
    );
    expect(visit.lifecycleStatus).toBe('BORRADOR');
    expect(visit.sections).toHaveLength(10);
    expect(continued.siteName).toBe('Sitio actualizado');
    expect(continued.operationId).not.toBe(visit.operationId);
    expect(continued.syncStatus).toBe('PENDIENTE');
  });

  it('supports OK, SC and NA, and removes finding/photos when leaving NOK', () => {
    let visit = draft();
    const point = visit.sections[0].points[0];
    visit = saveFindingAndStatus(visit, visit.sections[0].id, point.id, 'NOK', completeFinding(visit), { id: ids, now });
    expect(visit.findings[0].photos).toHaveLength(1);
    for (const status of ['OK', 'SC', 'NA'] as const) {
      const next = setPointStatus(visit, visit.sections[0].id, point.id, status, { id: ids, now });
      expect(next.sections[0].points[0].status).toBe(status);
      expect(next.findings).toHaveLength(0);
      visit = next;
    }
  });

  it('requires a finding, required fields, and an ANTES photo for NOK', () => {
    let visit = allPoints(draft());
    visit = {
      ...visit,
      sections: visit.sections.map((section, index) =>
        index === 0
          ? { ...section, points: [{ ...section.points[0], status: 'NOK' }, ...section.points.slice(1)] }
          : section,
      ),
    };
    expect(getCloseEligibility(visit).eligible).toBe(false);
    expect(getCloseEligibility(visit).missingItems.join('\n')).toContain('Falta hallazgo');

    const finding = completeFinding(visit);
    visit = saveFindingAndStatus(visit, visit.sections[0].id, visit.sections[0].points[0].id, 'NOK', {
      ...finding,
      photos: [],
    }, { id: ids, now });
    expect(getCloseEligibility(visit).allNokHaveFindings).toBe(false);
    expect(getCloseEligibility(visit).missingItems.join('\n')).toContain('Falta foto ANTES');
  });

  it('allows close only when complete, is read-only after close, and audits reopen', () => {
    let visit = allPoints(draft());
    expect(getCloseEligibility(visit).eligible).toBe(true);
    visit = closeVisit(visit, { id: 'close', eventType: 'CLOSE_VISIT', occurredAt: now() }, { id: ids, now });
    expect(visit.lifecycleStatus).toBe('CERRADA');
    expect(() => continueDraftVisit(visit, { siteName: 'Nope' }, { id: ids, now })).toThrow(/cerrada/);
    const reopened = reopenVisit(
      visit,
      { id: 'reopen', eventType: 'REOPEN_VISIT', occurredAt: now(), metadata: { reason: 'Corrección' } },
      { id: ids, now },
    );
    expect(reopened.lifecycleStatus).toBe('REABIERTA');
    expect(reopened.auditEvents.at(-1)?.eventType).toBe('REOPEN_VISIT');
    expect(reopened.auditEvents.at(-1)?.metadata).toEqual({ reason: 'Corrección' });
  });

  it('handles offline queue due state and exponential retry backoff', () => {
    const visit = draft();
    expect(isSyncDue(visit, 100)).toBe(true);
    expect(retryDelayMs(1)).toBe(2_000);
    expect(retryDelayMs(2)).toBe(4_000);
    expect(retryDelayMs(99)).toBe(3_600_000);
    const error = markSyncError({ ...visit, syncAttemptCount: 2 }, 'offline', 1000);
    expect(error.syncStatus).toBe('ERROR');
    expect(error.nextAttemptAt).toBe(5000);
    expect(isSyncDue(error, 4999)).toBe(false);
    expect(isSyncDue(error, 5000)).toBe(true);
  });
});