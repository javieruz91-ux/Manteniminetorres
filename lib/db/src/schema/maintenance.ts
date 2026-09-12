import { sql } from "drizzle-orm";
import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  varchar,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const visitsTable = pgTable(
  "maintenance_visits",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    visitId: varchar("visit_id").notNull(),
    ownerId: varchar("owner_id").notNull(),
    // Legacy column retained so development pushes never reinterpret old data.
    status: varchar("status").notNull().default("BORRADOR"),
    lifecycleStatus: varchar("lifecycle_status").notNull(),
    syncStatus: varchar("sync_status").notNull().default("SINCRONIZADO"),
    siteId: varchar("site_id").notNull().default(""),
    siteName: varchar("site_name").notNull().default(""),
    workOrder: varchar("work_order").notNull().default(""),
    technician: varchar("technician").notNull().default(""),
    visitDate: timestamp("visit_date", { withTimezone: true }),
    snapshot: jsonb("snapshot").notNull(),
    clientUpdatedAt: timestamp("client_updated_at", {
      withTimezone: true,
    }).notNull(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    reopenedAt: timestamp("reopened_at", { withTimezone: true }),
    serverVersion: integer("server_version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    unique("maintenance_visits_owner_visit_id_unique").on(
      table.ownerId,
      table.visitId,
    ),
    index("maintenance_visits_owner_id_idx").on(table.ownerId),
    index("maintenance_visits_visit_id_idx").on(table.visitId),
    index("maintenance_visits_updated_at_idx").on(table.updatedAt),
  ],
);

export const visitOperationsTable = pgTable(
  "maintenance_visit_operations",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    ownerId: varchar("owner_id").notNull(),
    operationId: varchar("operation_id").notNull(),
    visitId: varchar("visit_id").notNull(),
    payloadHash: varchar("payload_hash").notNull(),
    confirmation: jsonb("confirmation").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("maintenance_operations_owner_operation_unique").on(
      table.ownerId,
      table.operationId,
    ),
    index("maintenance_operations_owner_idx").on(table.ownerId),
    index("maintenance_operations_visit_idx").on(table.visitId),
  ],
);

export const visitRevisionsTable = pgTable(
  "maintenance_visit_revisions",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    ownerId: varchar("owner_id").notNull(),
    visitId: varchar("visit_id").notNull(),
    serverVersion: integer("server_version").notNull(),
    snapshot: jsonb("snapshot").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("maintenance_revisions_owner_visit_version_unique").on(
      table.ownerId,
      table.visitId,
      table.serverVersion,
    ),
    index("maintenance_revisions_owner_visit_idx").on(
      table.ownerId,
      table.visitId,
    ),
  ],
);

export const visitAuditEventsTable = pgTable(
  "maintenance_visit_audit_events",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    ownerId: varchar("owner_id").notNull(),
    visitId: varchar("visit_id").notNull(),
    eventId: varchar("event_id").notNull(),
    eventType: varchar("event_type").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    actorId: varchar("actor_id"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("maintenance_audit_owner_visit_event_unique").on(
      table.ownerId,
      table.visitId,
      table.eventId,
    ),
    index("maintenance_audit_owner_visit_idx").on(
      table.ownerId,
      table.visitId,
    ),
  ],
);

export const visitPhotosTable = pgTable(
  "maintenance_visit_photos",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    ownerId: varchar("owner_id").notNull(),
    visitId: varchar("visit_id").notNull(),
    sectionId: varchar("section_id"),
    pointId: varchar("point_id"),
    findingId: varchar("finding_id"),
    type: varchar("type").notNull(),
    localId: varchar("local_id").notNull(),
    objectPath: text("object_path"),
    uploadStatus: varchar("upload_status").notNull().default("pending"),
    contentType: varchar("content_type"),
    size: integer("size"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    unique("maintenance_photos_owner_visit_local_unique").on(
      table.ownerId,
      table.visitId,
      table.localId,
    ),
    unique("maintenance_photos_owner_object_unique").on(
      table.ownerId,
      table.objectPath,
    ),
    index("maintenance_photos_owner_visit_idx").on(
      table.ownerId,
      table.visitId,
    ),
  ],
);

export const insertVisitSchema = createInsertSchema(visitsTable).omit({
  createdAt: true,
  updatedAt: true,
});
export const insertVisitOperationSchema = createInsertSchema(
  visitOperationsTable,
).omit({ id: true, createdAt: true });
export const insertVisitRevisionSchema = createInsertSchema(
  visitRevisionsTable,
).omit({ id: true, createdAt: true });
export const insertVisitAuditEventSchema = createInsertSchema(
  visitAuditEventsTable,
).omit({ id: true, createdAt: true });
export const insertVisitPhotoSchema = createInsertSchema(visitPhotosTable).omit(
  { id: true, createdAt: true, updatedAt: true },
);

export type InsertVisit = z.infer<typeof insertVisitSchema>;
export type Visit = typeof visitsTable.$inferSelect;
export type VisitOperation = typeof visitOperationsTable.$inferSelect;
export type VisitRevision = typeof visitRevisionsTable.$inferSelect;
export type VisitAuditEvent = typeof visitAuditEventsTable.$inferSelect;
export type VisitPhoto = typeof visitPhotosTable.$inferSelect;