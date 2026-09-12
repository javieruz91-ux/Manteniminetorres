const fs = require('fs');
let code = fs.readFileSync('artifacts/mantenimiento-celular/context/VisitContext.tsx', 'utf8');

const regex = /interface VisitContextValue \{[\s\S]*?\}/;
const replacement = `interface VisitContextValue {
  visits: Visit[];
  isLoading: boolean;
  isOnline: boolean;
  createVisit: (data: Partial<Visit>) => Promise<string>;
  updateVisit: (id: string, data: Partial<Visit>) => Promise<void>;
  closeVisit: (id: string, auditEvent: AuditEvent) => Promise<void>;
  reopenVisit: (id: string, auditEvent: AuditEvent) => Promise<void>;
  deleteVisit: (id: string) => Promise<void>;
  updatePointStatus: (visitId: string, sectionId: string, pointId: string, status: ChecklistStatus) => Promise<void>;
  saveFindingAndStatus: (visitId: string, pointId: string, sectionId: string, status: ChecklistStatus, finding: Finding | null) => Promise<void>;
  getVisit: (id: string) => Visit | undefined;
  savePhoto: (tempUri: string, visitId: string) => Promise<string>;
  triggerSync: () => void;
}`;

code = code.replace(regex, replacement);

fs.writeFileSync('artifacts/mantenimiento-celular/context/VisitContext.tsx', code);
