import { sql } from "drizzle-orm";
import {
  index,
  integer,
  jsonb,
  boolean,
  pgTable,
  text,
  timestamp,
  unique,
  varchar,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";

/** Immutable source workbook versions. Mapping edits intentionally live here as
 * JSON snapshots so every import remains reproducible and auditable. */
export const excelTemplatesTable = pgTable(
  "excel_templates",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    ownerId: varchar("owner_id").notNull(),
    version: integer("version").notNull(),
    fileName: text("file_name").notNull(),
    originalObjectPath: text("original_object_path").notNull(),
    sha256: varchar("sha256", { length: 64 }).notNull(),
    catalog: jsonb("catalog").notNull(),
    unmapped: jsonb("unmapped").notNull(),
    audit: jsonb("audit").notNull(),
    ready: boolean("ready").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("excel_templates_owner_version_unique").on(table.ownerId, table.version),
    index("excel_templates_owner_idx").on(table.ownerId),
    index("excel_templates_owner_ready_idx").on(table.ownerId, table.ready),
  ],
);

export const insertExcelTemplateSchema = createInsertSchema(excelTemplatesTable).omit({
  id: true,
  createdAt: true,
});
export type ExcelTemplate = typeof excelTemplatesTable.$inferSelect;
export type InsertExcelTemplate = typeof excelTemplatesTable.$inferInsert;