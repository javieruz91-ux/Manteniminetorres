export type ChecklistStatus = 'PENDING' | 'OK' | 'NOK' | 'SC' | 'NA';
export type FindingPriority = 'BAJA' | 'MEDIA' | 'ALTA' | 'CRITICA';
export type FindingState = 'ABIERTO' | 'CORREGIDO';
export type VisitSnapshotLifecycleStatus = 'BORRADOR' | 'ABIERTA' | 'CERRADA' | 'REABIERTA';
export type VisitSnapshotSyncStatus = 'PENDIENTE' | 'SINCRONIZANDO' | 'SINCRONIZADO' | 'ERROR';

export type TemplateFieldType =
  | 'text'
  | 'number'
  | 'date'
  | 'selection'
  | 'measurement'
  | 'observation'
  | 'status';
export type TemplateEvidenceSlot = 'none' | 'photo' | 'observation';

export interface TemplateTarget {
  cell?: string;
  range?: string;
}

export interface TemplateField {
  id: string;
  label: string;
  fullText?: string;
  sheet: string;
  section: string;
  subsection?: string;
  type: TemplateFieldType;
  evidenceSlot?: TemplateEvidenceSlot;
  options?: string[];
  required?: boolean;
  applicability?: string;
  target?: TemplateTarget;
  editable?: boolean;
  isTitle?: boolean;
  mapped?: boolean;
  /** UI classification; presentation cells remain in the catalog for export but are not questions. */
  logical?: boolean;
}

export interface TemplateUnmappedCell {
  id: string;
  sheet: string;
  cell: string;
  /** Immutable descriptor identity, e.g. REPORTE FOTOGRAFICO!B4. */
  target?: string;
  value?: string;
  fullText?: string;
}

export interface TemplateDescriptor {
  id: string;
  version: string;
  hash: string;
  fileName: string;
  uploadedAt: string;
  ready: boolean;
  sheets: number;
  sections: number;
  fields: number;
  unmappedCells: TemplateUnmappedCell[];
}

export interface TemplateCatalog {
  descriptor: TemplateDescriptor;
  fields: TemplateField[];
}

export interface VisitTemplatePin {
  id: string;
  version: string;
  hash: string;
}

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
  /** The exact catalog revision used to create this draft. */
  template?: VisitTemplatePin;
  /** Values keyed by stable imported field id, including empty values. */
  responses: Record<string, unknown>;
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
  catalogMigrationNotice?: string;
}
