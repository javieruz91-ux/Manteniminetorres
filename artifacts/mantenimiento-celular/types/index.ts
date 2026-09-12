export type ChecklistStatus = 'PENDING' | 'OK' | 'NOK' | 'SC' | 'NA';
export type FindingPriority = 'BAJA' | 'MEDIA' | 'ALTA' | 'CRITICA';
export type FindingState = 'ABIERTO' | 'CORREGIDO';
export type VisitSnapshotLifecycleStatus = 'BORRADOR' | 'ABIERTA' | 'CERRADA' | 'REABIERTA';
export type VisitSnapshotSyncStatus = 'PENDIENTE' | 'SINCRONIZANDO' | 'SINCRONIZADO' | 'ERROR';

export type PhotoType = 'ANTES' | 'DESPUES' | 'GENERAL';
export type UploadStatus = 'pending' | 'uploading' | 'uploaded' | 'failed';

export interface Photo {
  id: string; // localId
  uri: string;
  type: PhotoType;
  timestamp: number;
  objectPath: string | null;
  uploadStatus: UploadStatus;
  size?: number | null;
}

export interface Finding {
  id: string;
  pointId: string;
  sectionId: string;
  description: string;
  responsible: string;
  priority: FindingPriority;
  startDate: string;
  commitmentDate: string;
  completedDate: string | null;
  photos: Photo[];
  state: FindingState;
}

export interface ChecklistPoint {
  id: string;
  title: string;
  status: ChecklistStatus;
  findings?: Finding[];
}

export interface Section {
  id: string;
  name: string;
  title: string;
  status: ChecklistStatus;
  points: ChecklistPoint[];
}

export interface AuditEvent {
  id: string;
  eventType: string;
  occurredAt: string;
  actorId?: string;
  metadata?: Record<string, unknown>;
}

export interface Visit {
  id: string; // Internal id / visitId
  siteId: string;
  siteName: string;
  workOrder: string;
  technician: string;
  visitDate: string;
  clientUpdatedAt: string;
  lifecycleStatus: VisitSnapshotLifecycleStatus;
  syncStatus: VisitSnapshotSyncStatus;
  closedAt: string | null;
  reopenedAt: string | null;
  sections: Section[];
  findings: Finding[];
  auditEvents: AuditEvent[];
  // Sync metadata
  operationId?: string;
  serverVersion?: number;
  confirmedAt?: string;
  syncAttemptCount?: number;
  nextAttemptAt?: number;
  syncError?: string;
  demoOnly?: boolean;
}
