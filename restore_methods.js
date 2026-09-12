const fs = require('fs');
let code = fs.readFileSync('artifacts/mantenimiento-celular/context/VisitContext.tsx', 'utf8');

const replacement = `  const deleteVisit = async (id: string): Promise<void> => {
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
  };

  const savePhoto = async`;

code = code.replace(/  const savePhoto = async/, replacement);
fs.writeFileSync('artifacts/mantenimiento-celular/context/VisitContext.tsx', code);
