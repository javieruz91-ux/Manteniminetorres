const fs = require('fs');
let code = fs.readFileSync('artifacts/mantenimiento-celular/context/VisitContext.tsx', 'utf8');

const regex = /const updateVisit = async \([\s\S]*?        return v;\n      \}\);\n    \}\);\n  \};/g;

const replacement = `const updateVisit = async (id: string, data: Partial<Visit>): Promise<void> => {
    await updateAndPersist(prev => {
      const existing = prev.find(v => v.id === id);
      if (!existing) throw new Error("Visita no encontrada");
      if (existing.lifecycleStatus === 'CERRADA') throw new Error("No se puede editar una visita cerrada");
      
      return prev.map(v => {
        if (v.id === id) {
          const { lifecycleStatus, auditEvents, operationId, serverVersion, syncStatus, syncAttemptCount, nextAttemptAt, syncError, confirmedAt, closedAt, reopenedAt, ...safeData } = data;
          
          const nextData = { 
            ...v, 
            ...safeData, 
            clientUpdatedAt: new Date().toISOString() 
          };
          nextData.operationId = Crypto.randomUUID();
          nextData.syncStatus = 'PENDIENTE';
          return nextData as Visit;
        }
        return v;
      });
    });
  };

  const closeVisit = async (id: string, auditEvent: AuditEvent): Promise<void> => {
    await updateAndPersist(prev => {
      const existing = prev.find(v => v.id === id);
      if (!existing) throw new Error("Visita no encontrada");
      if (existing.lifecycleStatus !== 'BORRADOR' && existing.lifecycleStatus !== 'ABIERTA' && existing.lifecycleStatus !== 'REABIERTA') {
        throw new Error("Transición inválida: Solo visitas abiertas pueden ser cerradas.");
      }
      
      return prev.map(v => {
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
      });
    });
  };

  const reopenVisit = async (id: string, auditEvent: AuditEvent): Promise<void> => {
    await updateAndPersist(prev => {
      const existing = prev.find(v => v.id === id);
      if (!existing) throw new Error("Visita no encontrada");
      if (existing.lifecycleStatus !== 'CERRADA') {
        throw new Error("Transición inválida: Solo visitas cerradas pueden ser reabiertas.");
      }
      
      return prev.map(v => {
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
      });
    });
  };

  const deleteVisit = async (id: string): Promise<void> => {
    await updateAndPersist(prev => {
      const existing = prev.find(v => v.id === id);
      if (!existing) throw new Error("Visita no encontrada");
      if (existing.lifecycleStatus === 'CERRADA') {
        throw new Error("No se puede eliminar una visita cerrada.");
      }
      if (existing.syncStatus === 'SINCRONIZANDO') {
        throw new Error("No se puede eliminar una visita mientras se sincroniza.");
      }
      return prev.filter(v => v.id !== id);
    });
  };

  const updatePointStatus = async (visitId: string, sectionId: string, pointId: string, status: ChecklistStatus): Promise<void> => {
    await updateAndPersist(prev => {
      const existing = prev.find(v => v.id === visitId);
      if (!existing) throw new Error("Visita no encontrada");
      if (existing.lifecycleStatus === 'CERRADA') throw new Error("No se puede editar una visita cerrada.");

      return prev.map(v => {
        if (v.id === visitId) {
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
      const existing = prev.find(v => v.id === visitId);
      if (!existing) throw new Error("Visita no encontrada");
      if (existing.lifecycleStatus === 'CERRADA') throw new Error("No se puede editar una visita cerrada.");

      return prev.map(v => {
        if (v.id === visitId) {
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
