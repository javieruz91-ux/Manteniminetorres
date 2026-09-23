import { createHash } from "node:crypto";
import {
  GetVisitParams,
  GetVisitResponse,
  ListVisitsResponse,
  SyncVisitBody,
  SyncVisitHeader,
  SyncVisitResponse,
} from "@workspace/api-zod";
import {
  db,
  excelTemplatesTable,
  visitAuditEventsTable,
  visitOperationsTable,
  visitPhotosTable,
  visitRevisionsTable,
  visitsTable,
} from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { Router, type IRouter, type Request, type Response } from "express";
import {
  ObjectNotFoundError,
  ObjectStorageService,
} from "../lib/objectStorage";

const router: IRouter = Router();
const TRANSIENT_SYNC_STATUS = "SINCRONIZADO" as const;
const CLOSED_STATUSES = new Set(["CERRADA"]);
const REOPENED_STATUSES = new Set(["REABIERTA"]);
const ALLOWED_LIFECYCLE_STATUSES = new Set([
  "BORRADOR",
  "ABIERTA",
  "CERRADA",
  "REABIERTA",
]);
const objectStorageService = new ObjectStorageService();

type AuthenticatedRequest = Request & {
  user: NonNullable<Request["user"]>;
};

class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConflictError";
  }
}

class InvalidSnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidSnapshotError";
  }
}

function requireAuthentication(
  req: Request,
  res: Response,
): req is AuthenticatedRequest {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Authentication required" });
    return false;
  }
  return true;
}

function canonicalize(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalize(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`)
    .join(",")}}`;
}

function payloadHash(value: unknown): string {
  return createHash("sha256").update(canonicalize(value)).digest("hex");
}

function validDate(value: unknown): boolean {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function validateCanonicalResponses(
  catalog: Array<{
    id: string;
    required: boolean;
    responseType: string;
    options?: string[];
  }>,
  responses: Record<string, unknown>,
  sections: Array<{
    points: Array<{
      id: string;
      status: string;
      fields?: Record<string, unknown>;
      findings: unknown[];
    }>;
  }>,
  requireCompletion: boolean,
): void {
  const fieldsById = new Map(catalog.map((field) => [field.id, field]));
  if (fieldsById.size !== catalog.length) {
    throw new InvalidSnapshotError("Canonical template catalog contains duplicate field IDs");
  }
  for (const id of Object.keys(responses)) {
    if (!fieldsById.has(id)) {
      throw new InvalidSnapshotError(`Unknown imported response field: ${id}`);
    }
  }
  for (const field of catalog) {
    const value = responses[field.id];
    const empty = value === undefined || value === null || String(value).trim() === "";
    if (requireCompletion && field.required && empty) {
      throw new InvalidSnapshotError(`Required imported field ${field.id} is missing`);
    }
    if (empty) continue;
    if ((field.responseType === "number" || field.responseType === "measurement") &&
      (typeof value !== "number" || !Number.isFinite(value))) {
      throw new InvalidSnapshotError(`Imported field ${field.id} must be numeric`);
    }
    if ((field.responseType === "text" || field.responseType === "observation") &&
      typeof value !== "string") {
      throw new InvalidSnapshotError(`Imported field ${field.id} must be text`);
    }
    if (field.responseType === "date" &&
      (typeof value !== "string" || Number.isNaN(Date.parse(value)))) {
      throw new InvalidSnapshotError(`Imported field ${field.id} must be a valid date`);
    }
    if ((field.responseType === "selection" || field.responseType === "status") &&
      (!field.options?.includes(String(value)))) {
      throw new InvalidSnapshotError(`Imported field ${field.id} has an invalid option`);
    }
    if (field.responseType === "status") {
      const matches = sections.flatMap((section) => section.points).filter((point) =>
        point.fields && Object.prototype.hasOwnProperty.call(point.fields, field.id),
      );
      if (matches.length !== 1 || String(matches[0].fields?.[field.id]) !== String(value)) {
        throw new InvalidSnapshotError(`Status response ${field.id} is not bound to exactly one point`);
      }
      const canonicalStatus = String(value).toUpperCase();
      if (["OK", "SC", "NA", "NOK"].includes(canonicalStatus) &&
        matches[0].status !== canonicalStatus) {
        throw new InvalidSnapshotError(`Point status does not match canonical response ${field.id}`);
      }
      if (canonicalStatus === "NOK" &&
        matches[0].findings.length === 0) {
        throw new InvalidSnapshotError(`NOK status ${field.id} requires a NOK point finding`);
      }
    }
  }
}

function eventKind(eventType: string): "closed" | "reopened" | null {
  const normalized = eventType.trim().toUpperCase();
  if (
    ["CLOSE_VISIT", "CLOSED", "CLOSE", "CERRADA", "CERRADO"].includes(
      normalized,
    )
  ) {
    return "closed";
  }
  if (
    ["REOPEN_VISIT", "REOPENED", "REOPEN", "REABIERTA", "REABIERTO"].includes(
      normalized,
    )
  ) {
    return "reopened";
  }
  return null;
}

function hasNewTransitionEvent(
  incomingEvents: Array<{ id: string; eventType: string }>,
  persistedEvents: Array<{ eventId: string }>,
  eventType: "CLOSE_VISIT" | "REOPEN_VISIT",
): boolean {
  const persistedIds = new Set(persistedEvents.map((event) => event.eventId));
  return incomingEvents.some(
    (event) =>
      event.eventType.trim().toUpperCase() === eventType &&
      !persistedIds.has(event.id),
  );
}

function validateSnapshot(snapshot: {
  siteId?: string;
  siteName?: string;
  workOrder?: string;
  technician?: string;
  visitDate?: Date | null;
  lifecycleStatus: string;
  closedAt: Date | null;
  reopenedAt: Date | null;
  sections: Array<{
    id: string;
    name: string;
    points: Array<{
      id: string;
      status: string;
      findings: Array<{
        id: string;
        sectionId: string;
        pointId: string;
        description: string;
        responsible: string;
        priority: string;
        startDate: Date;
        commitmentDate: Date | null;
        completedDate: Date | null;
        state: string;
      }>;
    }>;
  }>;
  photos: Array<{
    sectionId?: string | null;
    pointId?: string | null;
    findingId?: string | null;
    type: string;
    objectPath: string | null;
    uploadStatus: string;
  }>;
  auditEvents: Array<{
    eventType: string;
    actorId?: string | null;
  }>;
  templateFields?: Array<{
    id: string;
    required: boolean;
    responseType: string;
  }>;
  responses?: Record<string, unknown>;
}, requireCompletion: boolean): void {
  validateCanonicalResponses(snapshot.templateFields ?? [], snapshot.responses ?? {}, snapshot.sections, requireCompletion);
  if (requireCompletion) {
    if (snapshot.visitDate && !validDate(snapshot.visitDate.toISOString())) {
      throw new InvalidSnapshotError("visitDate is invalid");
    }
  }

  const sectionIds = new Set(snapshot.sections.map((section) => section.id));
  if (sectionIds.size !== snapshot.sections.length) {
    throw new InvalidSnapshotError(
      "A visit snapshot cannot contain duplicate section IDs",
    );
  }
  const sectionNames = new Set(snapshot.sections.map((section) => section.name));
  if (sectionNames.size !== snapshot.sections.length) {
    throw new InvalidSnapshotError(
      "A visit snapshot cannot contain duplicate section names",
    );
  }

  const allPoints = snapshot.sections.flatMap((section) => section.points);
  const statusPointsRequired = (snapshot.templateFields ?? []).some(
    (field) => field.responseType === "status" && field.required,
  );
  const pointIds = new Set<string>();
  for (const section of snapshot.sections) {
    for (const point of section.points) {
      if (pointIds.has(point.id)) {
        throw new InvalidSnapshotError(
          `Point ${point.id} must be unique across the visit`,
        );
      }
      pointIds.add(point.id);
    }
  }
  if (requireCompletion && statusPointsRequired && allPoints.length === 0) {
    throw new InvalidSnapshotError(
      "A confirmed visit must contain checklist points",
    );
  }
  if (requireCompletion && statusPointsRequired && allPoints.some((point) => point.status === "PENDING")) {
    throw new InvalidSnapshotError(
      "Every point must be evaluated before confirmation",
    );
  }

  const findings = allPoints.flatMap((point) => point.findings);
  const findingsById = new Map<string, (typeof findings)[number]>();
  for (const finding of findings) {
    if (findingsById.has(finding.id)) {
      throw new InvalidSnapshotError(`Finding ${finding.id} is duplicated`);
    }
    findingsById.set(finding.id, finding);
  }
  for (const section of snapshot.sections) {
    for (const point of section.points) {
      const pointFindings = point.findings;
      for (const finding of pointFindings) {
        if (
          finding.sectionId !== section.id ||
          finding.pointId !== point.id
        ) {
          throw new InvalidSnapshotError(
            `Finding ${finding.id} must be nested in its claimed section and point`,
          );
        }
      }
       if (
         requireCompletion &&
         (point.status === "NOK" || point.status === "SC") &&
         pointFindings.length !== 1
       ) {
        throw new InvalidSnapshotError(
          `Point ${point.id} must have exactly one finding`,
        );
      }
       if (
         requireCompletion &&
         point.status !== "NOK" &&
         point.status !== "SC" &&
         pointFindings.length > 0
       ) {
        throw new InvalidSnapshotError(
          `Point ${point.id} cannot have a finding unless it is NOK`,
        );
      }
    }
  }
  for (const photo of snapshot.photos) {
    if (!photo.findingId || !photo.sectionId || !photo.pointId) {
      throw new InvalidSnapshotError(
        "Every snapshot photo must identify its section, point, and finding",
      );
    }
    const finding = findingsById.get(photo.findingId);
    if (!finding) {
      throw new InvalidSnapshotError(
        `Photo ${photo.findingId} references an unknown finding`,
      );
    }
    if (
      photo.sectionId !== finding.sectionId ||
      photo.pointId !== finding.pointId
    ) {
      throw new InvalidSnapshotError(
        `Photo for finding ${finding.id} must match its section and point`,
      );
    }
  }
  for (const finding of findings) {
    if (requireCompletion) {
      if (
        !finding.description.trim() ||
        !finding.responsible.trim() ||
        !finding.priority ||
        !validDate(finding.startDate.toISOString()) ||
        (finding.commitmentDate !== null && !validDate(finding.commitmentDate.toISOString()))
      ) {
        throw new InvalidSnapshotError(
          `Finding ${finding.id} is missing required fields`,
        );
      }
    }
    const findingPhotos = snapshot.photos.filter(
      (photo) =>
        photo.findingId === finding.id &&
        photo.sectionId === finding.sectionId &&
        photo.pointId === finding.pointId,
    );
    if (requireCompletion) {
      if (
        !findingPhotos.some(
          (photo) =>
           photo.uploadStatus === "uploaded" &&
           photo.objectPath,
        )
      ) {
        throw new InvalidSnapshotError(
          `Finding ${finding.id} requires at least one photo`,
        );
      }
      if (finding.state === "CORREGIDO") {
        if (!finding.completedDate || !validDate(finding.completedDate.toISOString())) {
          throw new InvalidSnapshotError(
            `Corrected finding ${finding.id} requires completedDate`,
          );
        }
        if (
          !findingPhotos.some(
            (photo) =>
              photo.type === "DESPUES" &&
              photo.uploadStatus === "uploaded" &&
              photo.objectPath,
          )
        ) {
          throw new InvalidSnapshotError(
            `Corrected finding ${finding.id} requires a DESPUES photo`,
          );
        }
      }
    }
  }

  if (!requireCompletion) return;

  const requiredEvent = CLOSED_STATUSES.has(snapshot.lifecycleStatus)
    ? "closed"
    : "reopened";
  if (
    !snapshot.auditEvents.some(
      (event) => eventKind(event.eventType) === requiredEvent,
    )
  ) {
    throw new InvalidSnapshotError(
      `A ${requiredEvent} audit event is required for this lifecycle status`,
    );
  }
  if (CLOSED_STATUSES.has(snapshot.lifecycleStatus) && !snapshot.closedAt) {
    throw new InvalidSnapshotError("closedAt is required when closing a visit");
  }
  if (REOPENED_STATUSES.has(snapshot.lifecycleStatus) && !snapshot.reopenedAt) {
    throw new InvalidSnapshotError(
      "reopenedAt is required when reopening a visit",
    );
  }
}

function parseVisitId(req: Request, res: Response): string | null {
  const parsed = GetVisitParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return null;
  }
  return parsed.data.visitId;
}

router.post(
  "/visits/sync",
  async (req: Request, res: Response): Promise<void> => {
    if (!requireAuthentication(req, res)) return;

    const header = SyncVisitHeader.safeParse({
      "Idempotency-Key": req.get("Idempotency-Key"),
    });
    if (!header.success) {
      res.status(400).json({ error: "Idempotency-Key header is required" });
      return;
    }
    const parsed = SyncVisitBody.safeParse(req.body);
    if (!parsed.success) {
      req.log.warn({ errors: parsed.error.flatten() }, "Invalid visit snapshot");
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const operationId = parsed.data.operationId;
    if (header.data["Idempotency-Key"] !== operationId) {
      res.status(400).json({
        error: "Idempotency-Key must exactly equal operationId",
      });
      return;
    }
    if (parsed.data.photos.some((photo) => photo.visitId !== parsed.data.visitId)) {
      res.status(400).json({ error: "Every photo must belong to the visit" });
      return;
    }
    if (!ALLOWED_LIFECYCLE_STATUSES.has(parsed.data.lifecycleStatus)) {
      res.status(400).json({
        error: "Unsupported visit lifecycle status",
      });
      return;
    }

    const ownerId = req.user.id;
    const { operationId: ignoredOperationId, ...inputSnapshot } = parsed.data;
    const requestHash = payloadHash(parsed.data);

    try {
      const result = await db.transaction(async (tx) => {
        // Serialize template replacement/import allocation with visit pin
        // validation for this owner.
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtext(${`template-owner:${ownerId}`}))`,
        );
        // Serialize one owner's retries for one operation. This makes the
        // select/insert sequence safe when two devices retry concurrently.
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtext(${`${ownerId}:${operationId}`}))`,
        );

        const [existingOperation] = await tx
          .select()
          .from(visitOperationsTable)
          .where(
            and(
              eq(visitOperationsTable.ownerId, ownerId),
              eq(visitOperationsTable.operationId, operationId),
            ),
          );
        if (existingOperation) {
          if (
            existingOperation.visitId !== inputSnapshot.visitId ||
            existingOperation.payloadHash !== requestHash
          ) {
            throw new ConflictError(
              "Idempotency key was already used for a different payload",
            );
          }
          return {
            confirmation: SyncVisitResponse.parse(existingOperation.confirmation),
            replay: true,
          };
        }

        const [pinnedTemplate] = await tx
          .select()
          .from(excelTemplatesTable)
          .where(
            and(
              eq(excelTemplatesTable.ownerId, ownerId),
              eq(excelTemplatesTable.version, inputSnapshot.template.version),
            ),
          );
        if (!pinnedTemplate) {
          throw new ConflictError(
            `Template version ${inputSnapshot.template.version} does not belong to this owner`,
          );
        }
        if (pinnedTemplate.sha256 !== inputSnapshot.template.sha256) {
          throw new ConflictError("Pinned template SHA-256 does not match the stored version");
        }
        if (!pinnedTemplate.ready) {
          throw new ConflictError("Pinned template is not ready for visits");
        }
        const canonicalTemplateFields = pinnedTemplate.catalog as unknown as Array<{
          id: string;
          required: boolean;
          responseType: string;
          options?: string[];
        }>;
        const incomingResponses = inputSnapshot.responses as Record<string, unknown>;
        validateCanonicalResponses(
          canonicalTemplateFields,
          incomingResponses,
          inputSnapshot.sections,
          inputSnapshot.lifecycleStatus === "CERRADA" ||
            inputSnapshot.lifecycleStatus === "REABIERTA",
        );

        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtext(${`${ownerId}:${inputSnapshot.visitId}`}))`,
        );
        const [existingVisit] = await tx
          .select()
          .from(visitsTable)
          .where(
            and(
              eq(visitsTable.ownerId, ownerId),
              eq(visitsTable.visitId, inputSnapshot.visitId),
            ),
          );
        if (existingVisit) {
          const retainedSnapshot = existingVisit.snapshot as {
            template?: { version?: number; sha256?: string };
            templateFields?: unknown;
          };
          if (
            retainedSnapshot.template?.version !== inputSnapshot.template.version ||
            retainedSnapshot.template?.sha256 !== inputSnapshot.template.sha256
          ) {
            throw new ConflictError("A visit's pinned template cannot change across revisions");
          }
          if (canonicalize(retainedSnapshot.templateFields ?? []) !== canonicalize(pinnedTemplate.catalog)) {
            throw new ConflictError("A visit's canonical template catalog cannot change across revisions");
          }
        }
        if (!existingVisit && inputSnapshot.lifecycleStatus === "REABIERTA") {
          throw new ConflictError(
            "A new visit may only start as BORRADOR, ABIERTA, or CERRADA",
          );
        }
        if (
          existingVisit &&
          (inputSnapshot.serverVersion !== existingVisit.serverVersion ||
            inputSnapshot.clientUpdatedAt.getTime() <=
              existingVisit.clientUpdatedAt.getTime())
        ) {
          throw new ConflictError("Visit snapshot is stale");
        }

        const nextVersion = existingVisit
          ? existingVisit.serverVersion + 1
          : 1;
        const retainedAuditRows = await tx
          .select()
          .from(visitAuditEventsTable)
          .where(
            and(
              eq(visitAuditEventsTable.ownerId, ownerId),
              eq(visitAuditEventsTable.visitId, inputSnapshot.visitId),
            ),
          );
        const incomingAuditIds = new Set(
          inputSnapshot.auditEvents.map((event) => event.id),
        );
        const retainedAuditEvents = [
          ...inputSnapshot.auditEvents,
          ...retainedAuditRows
            .filter((event) => !incomingAuditIds.has(event.eventId))
            .map((event) => ({
              id: event.eventId,
              eventType: event.eventType,
              occurredAt: event.occurredAt,
              actorId: event.actorId,
              metadata: event.metadata ?? undefined,
            })),
        ];
        const persistedSnapshot = {
          ...inputSnapshot,
          templateFields: canonicalTemplateFields,
          responses: incomingResponses,
          auditEvents: retainedAuditEvents,
          syncStatus: TRANSIENT_SYNC_STATUS,
          serverVersion: nextVersion,
        };
        if (existingVisit) {
          const legalNextStatuses =
            existingVisit.lifecycleStatus === "BORRADOR"
              ? ["BORRADOR", "ABIERTA", "CERRADA"]
              : existingVisit.lifecycleStatus === "ABIERTA"
                ? ["ABIERTA", "CERRADA"]
                : existingVisit.lifecycleStatus === "CERRADA"
                  ? ["REABIERTA"]
                  : existingVisit.lifecycleStatus === "REABIERTA"
                    ? ["REABIERTA", "CERRADA"]
                    : [];
          if (!legalNextStatuses.includes(persistedSnapshot.lifecycleStatus)) {
            throw new ConflictError(
              `Illegal visit lifecycle transition from ${existingVisit.lifecycleStatus} to ${persistedSnapshot.lifecycleStatus}`,
            );
          }
        }
        if (existingVisit?.lifecycleStatus === "CERRADA") {
          if (
            persistedSnapshot.lifecycleStatus !== "REABIERTA" ||
            !persistedSnapshot.reopenedAt ||
            !hasNewTransitionEvent(
              inputSnapshot.auditEvents,
              retainedAuditRows,
              "REOPEN_VISIT",
            )
          ) {
            throw new ConflictError(
              "A closed visit may only transition to REABIERTA with a new REOPEN_VISIT audit event",
            );
          }
        }
        if (
          existingVisit?.lifecycleStatus === "REABIERTA" &&
          persistedSnapshot.lifecycleStatus === "CERRADA" &&
          !hasNewTransitionEvent(
            inputSnapshot.auditEvents,
            retainedAuditRows,
            "CLOSE_VISIT",
          )
        ) {
          throw new ConflictError(
            "Reclosing a reopened visit requires a new CLOSE_VISIT audit event",
          );
        }
        if (
          existingVisit &&
          (existingVisit.lifecycleStatus === "BORRADOR" ||
            existingVisit.lifecycleStatus === "ABIERTA") &&
          persistedSnapshot.lifecycleStatus === "CERRADA" &&
          !hasNewTransitionEvent(
            inputSnapshot.auditEvents,
            retainedAuditRows,
            "CLOSE_VISIT",
          )
        ) {
          throw new ConflictError(
            "Closing a visit requires a new CLOSE_VISIT audit event",
          );
        }
        validateSnapshot(
          persistedSnapshot,
          CLOSED_STATUSES.has(persistedSnapshot.lifecycleStatus) ||
            REOPENED_STATUSES.has(persistedSnapshot.lifecycleStatus),
        );

        for (const event of persistedSnapshot.auditEvents) {
          const kind = eventKind(event.eventType);
          if (kind && event.actorId !== ownerId) {
            throw new InvalidSnapshotError(
              `${kind} audit events must be authored by the authenticated owner`,
            );
          }
          const [existingEvent] = await tx
            .select()
            .from(visitAuditEventsTable)
            .where(
              and(
                eq(visitAuditEventsTable.ownerId, ownerId),
                eq(visitAuditEventsTable.visitId, inputSnapshot.visitId),
                eq(visitAuditEventsTable.eventId, event.id),
              ),
            );
          if (existingEvent) {
            const incoming = payloadHash({
              eventType: event.eventType,
              occurredAt: event.occurredAt,
              actorId: event.actorId ?? null,
              metadata: event.metadata ?? null,
            });
            const retained = payloadHash({
              eventType: existingEvent.eventType,
              occurredAt: existingEvent.occurredAt,
              actorId: existingEvent.actorId,
              metadata: existingEvent.metadata,
            });
            if (incoming !== retained) {
              throw new ConflictError(`Audit event ${event.id} is immutable`);
            }
          } else {
            await tx
              .insert(visitAuditEventsTable)
              .values({
                ownerId,
                visitId: inputSnapshot.visitId,
                eventId: event.id,
                eventType: event.eventType,
                occurredAt: event.occurredAt,
                actorId: event.actorId ?? null,
                metadata: event.metadata ?? null,
              })
              .onConflictDoNothing();
          }
        }

        for (const photo of persistedSnapshot.photos) {
          if (photo.visitId !== inputSnapshot.visitId) {
            throw new ConflictError(
              `Photo ${photo.localId} belongs to a different visit`,
            );
          }
          if (photo.uploadStatus === "uploaded" && !photo.objectPath) {
            throw new ConflictError(
              `Photo ${photo.localId} is marked uploaded without an object path`,
            );
          }
          const [metadata] = await tx
            .select()
            .from(visitPhotosTable)
            .where(
              and(
                eq(visitPhotosTable.ownerId, ownerId),
                eq(visitPhotosTable.visitId, photo.visitId),
                eq(visitPhotosTable.localId, photo.localId),
              ),
            );
          if (
            metadata &&
            (metadata.sectionId !== (photo.sectionId ?? null) ||
              metadata.pointId !== (photo.pointId ?? null) ||
              metadata.findingId !== (photo.findingId ?? null))
          ) {
            throw new ConflictError(
              `Photo ${photo.localId} relationship cannot be reassigned`,
            );
          }
          if (photo.objectPath) {
            if (!metadata || metadata.objectPath !== photo.objectPath) {
              throw new ConflictError(
                `Photo ${photo.localId} does not belong to this owner upload`,
              );
            }
            if (photo.uploadStatus !== "uploaded") {
              throw new ConflictError(
                `Photo ${photo.localId} has an invalid upload status`,
              );
            }
            try {
              await objectStorageService.getObjectEntityFile(photo.objectPath);
            } catch (error) {
              if (error instanceof ObjectNotFoundError) {
                throw new ConflictError(`Photo ${photo.localId} is not uploaded`);
              }
              throw error;
            }
            await tx
              .update(visitPhotosTable)
              .set({ uploadStatus: "uploaded", updatedAt: new Date() })
              .where(eq(visitPhotosTable.id, metadata.id));
          }
        }

        const confirmation = SyncVisitResponse.parse({
          visitId: inputSnapshot.visitId,
          confirmedAt: new Date(),
          serverVersion: nextVersion,
          idempotentReplay: false,
        });
        await tx
          .insert(visitsTable)
          .values({
            visitId: inputSnapshot.visitId,
            ownerId,
            lifecycleStatus: persistedSnapshot.lifecycleStatus,
            syncStatus: TRANSIENT_SYNC_STATUS,
            siteId: persistedSnapshot.siteId ?? "",
            siteName: persistedSnapshot.siteName ?? "",
            workOrder: persistedSnapshot.workOrder ?? "",
            technician: persistedSnapshot.technician ?? "",
            visitDate: persistedSnapshot.visitDate,
            snapshot: persistedSnapshot,
            clientUpdatedAt: persistedSnapshot.clientUpdatedAt,
            closedAt: persistedSnapshot.closedAt,
            reopenedAt: persistedSnapshot.reopenedAt,
            serverVersion: nextVersion,
          })
          .onConflictDoUpdate({
            target: [visitsTable.ownerId, visitsTable.visitId],
            set: {
              lifecycleStatus: persistedSnapshot.lifecycleStatus,
              syncStatus: TRANSIENT_SYNC_STATUS,
              siteId: persistedSnapshot.siteId ?? "",
              siteName: persistedSnapshot.siteName ?? "",
              workOrder: persistedSnapshot.workOrder ?? "",
              technician: persistedSnapshot.technician ?? "",
              visitDate: persistedSnapshot.visitDate,
              snapshot: persistedSnapshot,
              clientUpdatedAt: persistedSnapshot.clientUpdatedAt,
              closedAt: persistedSnapshot.closedAt,
              reopenedAt: persistedSnapshot.reopenedAt,
              serverVersion: nextVersion,
              updatedAt: new Date(),
            },
          });

        const [revision] = await tx
          .insert(visitRevisionsTable)
          .values({
            ownerId,
            visitId: inputSnapshot.visitId,
            serverVersion: nextVersion,
            snapshot: persistedSnapshot,
          })
          .onConflictDoNothing()
          .returning({ id: visitRevisionsTable.id });
        if (!revision) {
          throw new ConflictError(
            `Visit revision ${inputSnapshot.visitId}@${nextVersion} already exists`,
          );
        }

        for (const photo of persistedSnapshot.photos) {
          const [existingPhoto] = await tx
            .select()
            .from(visitPhotosTable)
            .where(
              and(
                eq(visitPhotosTable.ownerId, ownerId),
                eq(visitPhotosTable.visitId, photo.visitId),
                eq(visitPhotosTable.localId, photo.localId),
              ),
            );
          if (existingPhoto?.objectPath && existingPhoto.objectPath !== photo.objectPath) {
            throw new ConflictError(`Photo ${photo.localId} cannot be reassigned`);
          }
          await tx
            .insert(visitPhotosTable)
            .values({
              ownerId,
              visitId: photo.visitId,
              sectionId: photo.sectionId ?? null,
              pointId: photo.pointId ?? null,
              findingId: photo.findingId ?? null,
              type: photo.type,
              localId: photo.localId,
              objectPath: photo.objectPath ?? existingPhoto?.objectPath ?? null,
              uploadStatus: photo.uploadStatus,
              contentType: photo.contentType ?? null,
              size: photo.size ?? null,
            })
            .onConflictDoUpdate({
              target: [
                visitPhotosTable.ownerId,
                visitPhotosTable.visitId,
                visitPhotosTable.localId,
              ],
              set: {
                sectionId: photo.sectionId ?? null,
                pointId: photo.pointId ?? null,
                findingId: photo.findingId ?? null,
                type: photo.type,
                objectPath: photo.objectPath ?? existingPhoto?.objectPath ?? null,
                uploadStatus: photo.uploadStatus,
                contentType: photo.contentType ?? null,
                size: photo.size ?? null,
                updatedAt: new Date(),
              },
            });
        }

        const inserted = await tx
          .insert(visitOperationsTable)
          .values({
            ownerId,
            operationId,
            visitId: inputSnapshot.visitId,
            payloadHash: requestHash,
            confirmation,
          })
          .onConflictDoNothing({
            target: [visitOperationsTable.ownerId, visitOperationsTable.operationId],
          })
          .returning({ id: visitOperationsTable.id });
        if (inserted.length === 0) {
          const [concurrentOperation] = await tx
            .select()
            .from(visitOperationsTable)
            .where(
              and(
                eq(visitOperationsTable.ownerId, ownerId),
                eq(visitOperationsTable.operationId, operationId),
              ),
            );
          if (
            !concurrentOperation ||
            concurrentOperation.visitId !== inputSnapshot.visitId ||
            concurrentOperation.payloadHash !== requestHash
          ) {
            throw new ConflictError(
              "Idempotency key was already used for a different payload",
            );
          }
          return {
            confirmation: SyncVisitResponse.parse(concurrentOperation.confirmation),
            replay: true,
          };
        }
        return { confirmation, replay: false };
      });

      // Reconcile durable photo metadata with the accepted snapshot. Object
      // deletion happens before row deletion so a failed cleanup remains
      // retryable on an idempotent replay instead of becoming invisible.
      const incomingPhotoIds = new Set(parsed.data.photos.map((photo) => photo.localId));
      await db.transaction(async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtext(${`${ownerId}:${inputSnapshot.visitId}`}))`,
        );
        const [currentVisit] = await tx
          .select({ serverVersion: visitsTable.serverVersion })
          .from(visitsTable)
          .where(
            and(
              eq(visitsTable.ownerId, ownerId),
              eq(visitsTable.visitId, inputSnapshot.visitId),
            ),
          );
        // A stale replay must never delete photos accepted by a newer revision.
        if (currentVisit?.serverVersion !== result.confirmation.serverVersion) return;

        const storedPhotos = await tx
          .select()
          .from(visitPhotosTable)
          .where(
            and(
              eq(visitPhotosTable.ownerId, ownerId),
              eq(visitPhotosTable.visitId, inputSnapshot.visitId),
            ),
          );
        for (const stalePhoto of storedPhotos) {
          if (incomingPhotoIds.has(stalePhoto.localId)) continue;
          if (stalePhoto.objectPath) {
            await objectStorageService.deleteObjectEntity(stalePhoto.objectPath);
          }
          await tx
            .delete(visitPhotosTable)
            .where(eq(visitPhotosTable.id, stalePhoto.id));
        }
      });

      res.json(
        SyncVisitResponse.parse({
          ...result.confirmation,
          idempotentReplay: result.replay,
        }),
      );
    } catch (error) {
      if (error instanceof InvalidSnapshotError) {
        res.status(400).json({ error: error.message });
        return;
      }
      if (error instanceof ConflictError) {
        res.status(409).json({ error: error.message });
        return;
      }
      req.log.error({ err: error, ownerId, operationId }, "Visit synchronization failed");
      res.status(500).json({ error: "Visit synchronization failed" });
    }
  },
);

router.get(
  "/visits",
  async (req: Request, res: Response): Promise<void> => {
    if (!requireAuthentication(req, res)) return;
    const rows = await db
      .select()
      .from(visitsTable)
      .where(eq(visitsTable.ownerId, req.user.id))
      .orderBy(desc(visitsTable.updatedAt));
    res.json(
      ListVisitsResponse.parse(rows.map((row) => row.snapshot)),
    );
  },
);

router.get(
  "/visits/:visitId",
  async (req: Request, res: Response): Promise<void> => {
    if (!requireAuthentication(req, res)) return;
    const visitId = parseVisitId(req, res);
    if (!visitId) return;
    const [visit] = await db
      .select()
      .from(visitsTable)
      .where(
        and(
          eq(visitsTable.ownerId, req.user.id),
          eq(visitsTable.visitId, visitId),
        ),
      );
    if (!visit) {
      res.status(404).json({ error: "Visit not found" });
      return;
    }
    res.json(GetVisitResponse.parse(visit.snapshot));
  },
);

export default router;
