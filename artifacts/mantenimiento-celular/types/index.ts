export type ChecklistStatus = 'PENDING' | 'OK' | 'NOK' | 'SC' | 'NA';
export type FindingPriority = 'BAJA' | 'MEDIA' | 'ALTA' | 'CRITICA';
export type FindingState = 'ABIERTO' | 'CORREGIDO';
export type VisitStatus = 'BORRADOR' | 'LISTO_PARA_SINCRONIZAR' | 'SINCRONIZADO';

export interface Photo {
  id: string;
  uri: string;
  type: 'ANTES' | 'DESPUES' | 'GENERAL';
  timestamp: number;
}

export interface Finding {
  id: string;
  pointId: string;
  sectionId: string;
  description: string;
  responsible: string;
  priority: FindingPriority;
  commitmentDate: string;
  photos: Photo[];
  state: FindingState;
}

export interface ChecklistPoint {
  id: string;
  title: string;
  status: ChecklistStatus;
}

export interface Section {
  id: string;
  title: string;
  points: ChecklistPoint[];
}

export interface Visit {
  id: string;
  siteId: string;
  siteName: string;
  workOrder: string;
  technician: string;
  date: string;
  status: VisitStatus;
  sections: Section[];
  findings: Finding[];
}
