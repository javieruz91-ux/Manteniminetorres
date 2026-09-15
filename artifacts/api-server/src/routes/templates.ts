import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  ExportTemplateBody,
  ExportTemplateResponse,
  GetCurrentTemplateResponse,
  ImportTemplateBody,
  ImportTemplateResponse,
  PatchTemplateMappingsBody,
  PatchTemplateMappingsResponse,
} from "@workspace/api-zod";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db, excelTemplatesTable, visitPhotosTable, visitsTable } from "@workspace/db";
import { Router, type IRouter, type Request, type Response } from "express";
import {
  convertXlsxToPdf,
  embedEvidence,
  PHOTO_SLOT_COUNT,
  parseTemplate,
  prepareBlankTemplate,
  patchTemplate,
  sha256,
  verifyTemplate,
  resolveLocalSeparators,
  CATALOG_SCHEMA_VERSION,
  type TemplateCatalog,
  type TemplateField,
} from "../lib/xlsxTemplate";
import { ObjectStorageService } from "../lib/objectStorage";

const router: IRouter = Router();
const objectStorage = new ObjectStorageService();
const NOT_LOADED = "Falta cargar la plantilla Excel original";

function authenticated(req: Request, res: Response): req is Request & {
  user: NonNullable<Request["user"]>;
} {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Authentication required" });
    return false;
  }
  return true;
}

function descriptor(row: typeof excelTemplatesTable.$inferSelect | undefined) {
  if (!row) return null;
  const schemaAudit = Array.isArray(row.audit)
    ? row.audit.find((event): event is Record<string, unknown> =>
      event && typeof event === "object" && event.type === "catalog-schema")
    : undefined;
  return {
    ready: row.ready,
    version: row.version,
    schemaVersion: Number(schemaAudit?.version ?? 1),
    fileName: row.fileName,
    sha256: row.sha256,
    catalog: row.catalog,
    unmapped: row.unmapped,
    audit: row.audit,
  };
}

function localDescriptor(
  fileName: string,
  bytes: Buffer,
  parsed: TemplateCatalog,
) {
  return {
    ready: parsed.ready,
    version: "1",
    schemaVersion: parsed.schemaVersion ?? CATALOG_SCHEMA_VERSION,
    fileName,
    sha256: sha256(bytes),
    catalog: parsed.catalog,
    questions: parsed.questions ?? [],
    unmapped: parsed.unmapped,
    audit: parsed.audit,
  };
}

async function current(ownerId: string) {
  const [row] = await db.select().from(excelTemplatesTable)
    .where(eq(excelTemplatesTable.ownerId, ownerId))
    .orderBy(desc(excelTemplatesTable.version)).limit(1);
  return row;
}

function findOfficialWorkbook(): { fileName: string; filePath: string } | null {
  let directory = process.cwd();
  while (true) {
    const assetsDirectory = path.join(directory, "attached_assets");
    if (fs.existsSync(assetsDirectory)) {
      const fileName = fs.readdirSync(assetsDirectory)
        .find((candidate) => candidate.toLowerCase().endsWith(".xlsx"));
      if (fileName) {
        return { fileName, filePath: path.join(assetsDirectory, fileName) };
      }
    }
    const parent = path.dirname(directory);
    if (parent === directory) return null;
    directory = parent;
  }
}

router.get("/templates/trial-local", (_req, res) => {
  const workbook = findOfficialWorkbook();
  if (!workbook) {
    res.status(404).json({ error: NOT_LOADED });
    return;
  }
  try {
    const bytes = fs.readFileSync(workbook.filePath);
    const parsed = resolveLocalSeparators(parseTemplate(bytes));
    res.json({
      ...localDescriptor(workbook.fileName, bytes, parsed),
      source: {
        fileName: workbook.fileName,
        contentBase64: bytes.toString("base64"),
      },
    });
  } catch (error) {
    res.status(422).json({
      error: error instanceof Error ? error.message : "No se pudo leer el XLSX oficial.",
    });
  }
});

router.get("/templates/current", async (req, res) => {
  if (!authenticated(req, res)) return;
  const row = await current(req.user.id);
  if (!row) {
    res.status(404).json({ error: NOT_LOADED });
    return;
  }
  res.json(GetCurrentTemplateResponse.parse(descriptor(row)));
});

// Local-first onboarding: the device can parse its selected workbook without
// an account. It intentionally does not persist anything to the shared DB.
router.post("/templates/parse-local", async (req, res) => {
  const fileName = typeof req.body?.fileName === "string" ? req.body.fileName : "plantilla.xlsx";
  const encoded = typeof req.body?.contentBase64 === "string" ? req.body.contentBase64 : "";
  try {
    const bytes = Buffer.from(encoded, "base64");
    if (!bytes.length || bytes.toString("base64") !== encoded.replace(/\s/g, "")) {
      res.status(400).json({ error: "El archivo XLSX no es válido." });
      return;
    }
    const parsed = resolveLocalSeparators(parseTemplate(bytes));
    res.json(localDescriptor(fileName, bytes, parsed));
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : "No se pudo leer el archivo XLSX.",
    });
  }
});

// Local-first export. It uses the exact workbook bytes supplied by the device
// and never needs an authenticated server session.
router.post("/templates/export-local", async (req, res) => {
  const { fileName, contentBase64, format, snapshot, fields, photos } = req.body ?? {};
  try {
    const source = Buffer.from(String(contentBase64 ?? ""), "base64");
    if (!source.length) throw new Error("Falta el XLSX original.");
    const parsed = resolveLocalSeparators(parseTemplate(source));
    const exportCatalog = Array.isArray(fields) ? fields : parsed.catalog;
    const patched = patchTemplate(source, snapshot, exportCatalog);
    const evidencePhotos = Array.isArray(photos)
      ? photos.map((photo: { id: string; contentBase64: string; contentType?: string; target?: string }) => ({
          id: photo.id,
          bytes: Buffer.from(photo.contentBase64, "base64"),
          contentType: photo.contentType ?? "image/jpeg",
        target: photo.target,
        }))
      : [];
    const embedded = embedEvidence(patched.bytes, evidencePhotos, exportCatalog);
    if (!embedded.valid || embedded.consumedPhotoIds.length !== evidencePhotos.length) {
      res.status(400).json({ error: "Exportación bloqueada: " + embedded.details.join("; ") });
      return;
    }
    const verification = verifyTemplate(
      embedded.bytes,
      exportCatalog,
      patched.writtenTargets,
      patched.capturedValues,
       Math.max(1, Math.ceil(evidencePhotos.length / PHOTO_SLOT_COUNT)),
    );
    if (!verification.valid) {
      res.status(400).json({ error: "Exportación bloqueada: " + verification.details.join("; "), verification });
      return;
    }
    let output = embedded.bytes;
    let mime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    let outputName = `${String(fileName ?? "reporte").replace(/\.xlsx$/i, "")}_completado.xlsx`;
    if (format === "pdf") {
      output = await convertXlsxToPdf(output);
      mime = "application/pdf";
      outputName = outputName.replace(/\.xlsx$/, ".pdf");
    }
    res.json({ fileName: outputName, contentBase64: output.toString("base64"), mime, verification });
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : "No se pudo generar el reporte.",
    });
  }
});

router.post("/templates/import", async (req, res) => {
  if (!authenticated(req, res)) return;
  const parsed = ImportTemplateBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  let bytes: Buffer;
  let objectPath: string | undefined;
  try {
    bytes = Buffer.from(parsed.data.contentBase64, "base64");
    if (!bytes.length || bytes.toString("base64") !== parsed.data.contentBase64.replace(/\s/g, "")) {
      throw new Error("contentBase64 inválido");
    }
    const catalog = parseTemplate(bytes);
    const row = await db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`template-owner:${req.user.id}`}))`,
      );
      const [previous] = await tx.select({ version: excelTemplatesTable.version })
        .from(excelTemplatesTable)
        .where(eq(excelTemplatesTable.ownerId, req.user.id))
        .orderBy(desc(excelTemplatesTable.version)).limit(1);
      if (previous && !parsed.data.replace) {
        throw new Error("La plantilla solo puede reemplazarse explícitamente (replace=true)");
      }
      const version = (previous?.version ?? 0) + 1;
      objectPath = `/objects/templates/${req.user.id}/${version}-${randomUUID()}.xlsx`;
      await objectStorage.saveObjectEntity(objectPath, bytes, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      const [inserted] = await tx.insert(excelTemplatesTable).values({
        ownerId: req.user.id,
        version,
        fileName: parsed.data.fileName,
        originalObjectPath: objectPath,
        sha256: sha256(bytes),
        catalog: catalog.catalog,
        unmapped: catalog.unmapped,
        audit: catalog.audit,
        ready: catalog.ready,
      }).returning();
      return inserted;
    });
    res.json(ImportTemplateResponse.parse(descriptor(row)));
  } catch (error) {
    if (objectPath) await objectStorage.deleteObjectEntity(objectPath).catch(() => undefined);
    res.status(400).json({ error: error instanceof Error ? error.message : "No se pudo analizar la plantilla Excel" });
  }
});

router.patch("/templates/mappings", async (req, res) => {
  if (!authenticated(req, res)) return;
  const parsed = PatchTemplateMappingsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const row = await current(req.user.id);
  if (!row) {
    res.status(404).json({ error: NOT_LOADED });
    return;
  }
  if (row.version !== parsed.data.version) {
    res.status(409).json({ error: "La versión de plantilla ya no es la actual" });
    return;
  }
  const catalog = [...(row.catalog as unknown as TemplateField[])];
  const unmapped = [...(row.unmapped as unknown as TemplateCatalog["unmapped"])];
  const audit = [...(row.audit as unknown as Array<Record<string, unknown>>)];
  for (const mapping of parsed.data.mappings) {
    const candidateIndex = unmapped.findIndex((item) => item.target === mapping.candidateTarget);
    if (candidateIndex < 0) {
      res.status(400).json({ error: `Candidato inexistente: ${mapping.candidateTarget}` });
      return;
    }
    const candidate = unmapped[candidateIndex];
    if (mapping.state === "ignored") {
      if (candidate.target.endsWith("!__sheet__") || candidate.target.endsWith("!__evidence__")) {
        res.status(400).json({ error: "Este blocker estructural/evidencia requiere un mapeo explícito; no puede ignorarse" });
        return;
      }
      if (!mapping.ignoreReason?.trim()) {
        res.status(400).json({ error: "Todo candidato ignorado requiere un motivo" });
        return;
      }
      unmapped.splice(candidateIndex, 1);
      audit.push({ type: "candidate-ignored", target: candidate.target, reason: mapping.ignoreReason });
      continue;
    }
    const explicitEvidenceTarget = candidate.target.endsWith("!__evidence__") &&
      mapping.field?.evidenceSlot === "photo" &&
      mapping.field.sheet === "REPORTE FOTOGRAFICO" &&
      /^REPORTE FOTOGRAFICO![A-Z]+\d+(?::[A-Z]+\d+)?$/i.test(mapping.field.target);
    if (!mapping.field || (mapping.field.target !== mapping.candidateTarget && !explicitEvidenceTarget)) {
      res.status(400).json({ error: "El campo mapeado debe conservar exactamente el target candidato, salvo un slot fotográfico explícito válido" });
      return;
    }
    catalog.push({ ...mapping.field, state: "mapped", ignoreReason: null });
    unmapped.splice(candidateIndex, 1);
    audit.push({ type: "candidate-mapped", target: mapping.candidateTarget, mappedTarget: mapping.field.target, fieldId: mapping.field.id });
  }
  const ready = unmapped.length === 0;
  audit.push({ type: "catalog-summary", totalCandidates: catalog.length + unmapped.length, mapped: catalog.length, unresolved: unmapped.length });
  const [updated] = await db.update(excelTemplatesTable).set({
    catalog, unmapped, audit, ready,
  }).where(and(eq(excelTemplatesTable.id, row.id), eq(excelTemplatesTable.ownerId, req.user.id))).returning();
  res.json(PatchTemplateMappingsResponse.parse(descriptor(updated)));
});

router.post("/templates/export", async (req, res) => {
  if (!authenticated(req, res)) return;
  const parsed = ExportTemplateBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [visit] = await db.select().from(visitsTable).where(and(
    eq(visitsTable.ownerId, req.user.id), eq(visitsTable.visitId, parsed.data.visitId),
  ));
  if (!visit) {
    res.status(404).json({ error: "Visita no encontrada" });
    return;
  }
  const snapshot = visit.snapshot as {
    template?: { version?: unknown; sha256?: unknown };
    templateFields?: unknown[];
    photos?: unknown[];
  };
  if (!snapshot.template || typeof snapshot.template.version !== "number" || typeof snapshot.template.sha256 !== "string") {
    res.status(409).json({ error: "La visita no tiene una versión de plantilla Excel original fijada" });
    return;
  }
  const [template] = await db.select().from(excelTemplatesTable).where(and(
    eq(excelTemplatesTable.ownerId, req.user.id),
    eq(excelTemplatesTable.version, snapshot.template.version),
  ));
  if (!template) {
    res.status(409).json({ error: `La versión de plantilla fijada ${snapshot.template.version} no existe para este propietario` });
    return;
  }
  if (template.sha256 !== snapshot.template.sha256) {
    res.status(409).json({ error: "La huella SHA-256 de la plantilla fijada no coincide con la visita" });
    return;
  }
  if (!template.ready) {
    res.status(400).json({ error: "La plantilla Excel original fijada todavía tiene candidatos sin mapear o ignorar explícitamente" });
    return;
  }
  // A revision must continue using the catalog pinned with the visit, rather
  // than silently adopting a later mapping edit on the current row.
  const exportCatalog = (snapshot.templateFields?.length
    ? snapshot.templateFields
    : template.catalog) as unknown as TemplateField[];
  try {
    const file = await objectStorage.getObjectEntityFile(template.originalObjectPath);
    const [source] = await file.download();
    // Image/page placement is deliberately never guessed. A workbook must
    // explicitly map evidence slots before a visit containing photos can be
    // exported; otherwise returning a "successful" report would silently
    // discard required evidence.
    const patched = patchTemplate(source, visit.snapshot, exportCatalog);
    const snapshotPhotos = ([...(snapshot.photos ?? [])] as Array<{ localId: string; findingId?: string | null }>)
      .sort((a, b) => `${a.findingId ?? ""}:${a.localId}`.localeCompare(`${b.findingId ?? ""}:${b.localId}`));
    const photoRows = await db.select().from(visitPhotosTable).where(and(
      eq(visitPhotosTable.ownerId, req.user.id),
      eq(visitPhotosTable.visitId, parsed.data.visitId),
      eq(visitPhotosTable.uploadStatus, "uploaded"),
    )).orderBy(asc(visitPhotosTable.createdAt), asc(visitPhotosTable.localId));
    const photosById = new Map(photoRows.map((row) => [row.localId, row]));
    const evidencePhotos = [];
    for (const photo of snapshotPhotos) {
      const row = photosById.get(photo.localId);
      if (!row?.objectPath) throw new Error(`La fotografía ${photo.localId} no está cargada para este propietario/visita`);
      const photoFile = await objectStorage.getObjectEntityFile(row.objectPath);
      const [photoBytes] = await photoFile.download();
      evidencePhotos.push({ id: photo.localId, bytes: photoBytes, contentType: row.contentType ?? "image/jpeg" });
    }
    const embedded = embedEvidence(patched.bytes, evidencePhotos, exportCatalog);
    if (!embedded.valid || embedded.consumedPhotoIds.length !== snapshotPhotos.length) {
      res.status(400).json({ error: "Exportación bloqueada: " + embedded.details.join("; ") });
      return;
    }
    const verification = verifyTemplate(
      embedded.bytes,
      exportCatalog,
      patched.writtenTargets,
      patched.capturedValues,
       Math.max(1, Math.ceil(evidencePhotos.length / PHOTO_SLOT_COUNT)),
    );
    if (!verification.valid) {
      res.status(400).json({ error: "Exportación bloqueada: " + verification.details.join("; "), verification });
      return;
    }
    let output = embedded.bytes;
    let mime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    let fileName = `${parsed.data.visitId}.xlsx`;
    if (parsed.data.format === "pdf") {
      output = await convertXlsxToPdf(embedded.bytes);
      mime = "application/pdf";
      fileName = `${parsed.data.visitId}.pdf`;
    }
    res.json(ExportTemplateResponse.parse({
      fileName, contentBase64: output.toString("base64"), mime, verification,
    }));
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "No se pudo exportar la plantilla original" });
  }
});

router.get("/templates/blank", async (req, res) => {
  if (!authenticated(req, res)) return;
  const row = await current(req.user.id);
  if (!row) {
    res.status(404).json({ error: NOT_LOADED });
    return;
  }
  if (!row.ready) {
    res.status(400).json({ error: "La plantilla Excel original todavía tiene celdas sin auditar" });
    return;
  }

  try {
    const file = await objectStorage.getObjectEntityFile(row.originalObjectPath);
    const [source] = await file.download();
    const blank = prepareBlankTemplate(source);
    res.json(ExportTemplateResponse.parse({
      fileName: "plantilla_mantenimiento_vacia.xlsx",
      contentBase64: blank.bytes.toString("base64"),
      mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      verification: blank.verification,
    }));
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : "No se pudo preparar la plantilla vacía",
    });
  }
});

export default router;