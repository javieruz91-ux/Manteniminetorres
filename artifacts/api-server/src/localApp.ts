import fs from "node:fs";
import path from "node:path";
import cors from "cors";
import express, { type Express } from "express";
import {
  CATALOG_SCHEMA_VERSION,
  getPhotoSlotCount,
  convertXlsxToPdf,
  embedEvidence,
  parseTemplate,
  patchTemplate,
  providerSnapshot,
  findingsForProvider,
  followUpPdfWorkbook,
  resolveLocalSeparators,
  sha256,
  verifyTemplate,
  type TemplateCatalog,
} from "./lib/xlsxTemplate.ts";

const NOT_LOADED = "Falta cargar la plantilla Excel original";

function findOfficialWorkbook(): { fileName: string; filePath: string } | null {
  let directory = process.cwd();
  while (true) {
    const assetsDirectory = path.join(directory, "attached_assets");
    if (fs.existsSync(assetsDirectory)) {
      const candidates = fs.readdirSync(assetsDirectory);
      const fileName = candidates.includes("plantilla_region8_limpia.xlsx")
        ? "plantilla_region8_limpia.xlsx"
        : candidates.find((candidate) => candidate.toLowerCase().endsWith(".xlsx"));
      if (fileName) return { fileName, filePath: path.join(assetsDirectory, fileName) };
    }
    const parent = path.dirname(directory);
    if (parent === directory) return null;
    directory = parent;
  }
}

function localDescriptor(fileName: string, bytes: Buffer, parsed: TemplateCatalog) {
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

export function createLocalApp(): Express {
  const app = express();
  app.use(cors({ origin: true }));
  app.use(express.json({ limit: "50mb" }));

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", mode: "local" });
  });

  app.get("/api/templates/trial-local", (_req, res) => {
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
        source: { fileName: workbook.fileName, contentBase64: bytes.toString("base64") },
      });
    } catch (error) {
      res.status(422).json({
        error: error instanceof Error ? error.message : "No se pudo leer el XLSX oficial.",
      });
    }
  });

  app.post("/api/templates/parse-local", (req, res) => {
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

  app.post("/api/templates/export-local", async (req, res) => {
    const { fileName, contentBase64, format, snapshot, fields, photos, provider } = req.body ?? {};
    try {
      const source = Buffer.from(String(contentBase64 ?? ""), "base64");
      if (!source.length) throw new Error("Falta el XLSX original.");
      const parsed = resolveLocalSeparators(parseTemplate(source));
      const exportCatalog = Array.isArray(fields) ? fields : parsed.catalog;
      const selectedSnapshot = provider ? providerSnapshot(snapshot, String(provider)) : snapshot;
      const selectedPhotoIds = new Set(provider ? findingsForProvider(snapshot, String(provider)).flatMap(finding =>
        Array.isArray(finding.photos) ? finding.photos.map((photo: { id?: string }) => photo.id) : [],
      ) : []);
      const patched = patchTemplate(source, selectedSnapshot, exportCatalog);
      const evidencePhotos = Array.isArray(photos)
        ? photos.filter((photo: { id: string; target?: string }) => !provider || Boolean(photo.target) || selectedPhotoIds.has(photo.id))
          .map((photo: { id: string; contentBase64: string; contentType?: string; target?: string }) => ({
            id: photo.id,
            bytes: Buffer.from(photo.contentBase64, "base64"),
            contentType: photo.contentType ?? "image/jpeg",
            target: photo.target,
          }))
        : [];
      const embedded = embedEvidence(patched.bytes, evidencePhotos, exportCatalog);
      if (!embedded.valid || embedded.consumedPhotoIds.length !== evidencePhotos.length) {
        res.status(400).json({ error: `Exportación bloqueada: ${embedded.details.join("; ")}` });
        return;
      }
      const verification = verifyTemplate(
        embedded.bytes,
        exportCatalog,
        patched.writtenTargets,
        patched.capturedValues,
        Math.max(1, Math.ceil(evidencePhotos.filter((photo: { target?: string }) => !photo.target).length / getPhotoSlotCount(source))),
      );
      if (!verification.valid) {
        res.status(400).json({
          error: `Exportación bloqueada: ${verification.details.join("; ")}`,
          verification,
        });
        return;
      }

      let output = embedded.bytes;
      let mime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
      const safeProvider = provider ? `_${String(provider).normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9_-]+/g, "_")}` : "";
      let outputName = `${String(fileName ?? "reporte").replace(/\.xlsx$/i, "")}${safeProvider}_completado.xlsx`;
      if (format === "pdf") {
        output = await convertXlsxToPdf(provider ? followUpPdfWorkbook(output) : output);
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

  return app;
}
