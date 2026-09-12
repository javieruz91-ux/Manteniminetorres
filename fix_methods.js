const fs = require('fs');
let code = fs.readFileSync('artifacts/mantenimiento-celular/context/VisitContext.tsx', 'utf8');

const regex = /const createVisit = \([\s\S]*?const saveFindingAndStatus = \([\s\S]*?\}\);\s*  \};/g;

const replacement = `const createVisit = async (data: Partial<Visit>): Promise<string> => {
    const newVisit: Visit = {
      id: Crypto.randomUUID(),
      siteId: data.siteId || '',
      siteName: data.siteName || '',
      workOrder: data.workOrder || '',
      technician: data.technician || '',
      visitDate: new Date().toISOString(),
      clientUpdatedAt: new Date().toISOString(),
      lifecycleStatus: 'BORRADOR',
      syncStatus: 'PENDIENTE',
      closedAt: null,
      reopenedAt: null,
      serverVersion: 0,
      sections: JSON.parse(JSON.stringify(INITIAL_SECTIONS)),
      findings: [],
      auditEvents: [],
      operationId: Crypto.randomUUID(),
      syncAttemptCount: 0
    };
    
    await updateAndPersist(prev => [newVisit, ...prev]);
    return newVisit.id;
  };

  const updateVisit = async (id: string, data: Partial<Visit>): Promise<void> => {
    await updateAndPersist(prev => {
      return prev.map(v => {
        if (v.id === id) {
          if (v.lifecycleStatus === 'CERRADA') return v; // Immutable except via reopen
          
          const nextData = { 
            ...v, 
            ...data, 
            clientUpdatedAt: new Date().toISOString() 
          };
          nextData.operationId = Crypto.randomUUID();
          nextData.syncStatus = 'PENDIENTE';
          return nextData;
        }
        return v;
      });
    });
  };

  const closeVisit = async (id: string, auditEvent: AuditEvent): Promise<void> => {
    await updateAndPersist(prev => prev.map(v => {
      if (v.id === id) {
        return {
          ...v,
          lifecycleStatus: 'CERRADA',
          closedAt: new Date().toISOString(),
          auditEvents: [...v.auditEvents, auditEvent],
          nextAttemptAt: Date.now(),
          syncAttemptCount: 0,
          syncStatus: 'PENDIENTE',
          operationId: Crypto.randomUUID(),
          clientUpdatedAt: new Date().toISOString()
        };
      }
      return v;
    }));
  };

  const reopenVisit = async (id: string, auditEvent: AuditEvent): Promise<void> => {
    await updateAndPersist(prev => prev.map(v => {
      if (v.id === id) {
        return {
          ...v,
          lifecycleStatus: 'REABIERTA',
          reopenedAt: new Date().toISOString(),
          auditEvents: [...v.auditEvents, auditEvent],
          nextAttemptAt: Date.now(),
          syncAttemptCount: 0,
          syncStatus: 'PENDIENTE',
          operationId: Crypto.randomUUID(),
          clientUpdatedAt: new Date().toISOString()
        };
      }
      return v;
    }));
  };

  const deleteVisit = async (id: string): Promise<void> => {
    await updateAndPersist(prev => prev.filter(v => v.id !== id));
  };

  const updatePointStatus = async (visitId: string, sectionId: string, pointId: string, status: ChecklistStatus): Promise<void> => {
    await updateAndPersist(prev => {
      return prev.map(v => {
        if (v.id === visitId) {
          if (v.lifecycleStatus === 'CERRADA') return v;
          const sections = v.sections.map(s => {
            if (s.id === sectionId) {
              const points = s.points.map(p => p.id === pointId ? { ...p, status } : p);
              return { ...s, points };
            }
            return s;
          });
          return { ...v, sections, clientUpdatedAt: new Date().toISOString(), operationId: Crypto.randomUUID(), syncStatus: 'PENDIENTE' };
        }
        return v;
      });
    });
  };

  const saveFindingAndStatus = async (visitId: string, pointId: string, sectionId: string, status: ChecklistStatus, finding: Finding | null): Promise<void> => {
    await updateAndPersist(prev => {
      return prev.map(v => {
        if (v.id === visitId) {
          if (v.lifecycleStatus === 'CERRADA') return v;
          const sections = v.sections.map(s => {
            if (s.id === sectionId) {
              const points = s.points.map(p => p.id === pointId ? { ...p, status } : p);
              return { ...s, points };
            }
            return s;
          });
          
          let findings = [...v.findings];
          if (finding) {
            const existingIdx = findings.findIndex(f => f.id === finding.id);
            if (existingIdx >= 0) {
              findings[existingIdx] = finding;
            } else {
              findings.push(finding);
            }
          } else {
            findings = findings.filter(f => f.pointId !== pointId);
          }

          return { ...v, sections, findings, clientUpdatedAt: new Date().toISOString(), operationId: Crypto.randomUUID(), syncStatus: 'PENDIENTE' };
        }
        return v;
      });
    });
  };`;

code = code.replace(regex, replacement);
fs.writeFileSync('artifacts/mantenimiento-celular/context/VisitContext.tsx', code);
