import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { deflateRawSync, inflateRawSync } from "node:zlib";

const execFileAsync = promisify(execFile);

export const EXPECTED_SHEETS = [
  ["PRESENTACION", 8, 24],
  ["(HW) ALARMAS DE FUERZA", 10, 81],
  ["PLANTA HUAWEI", 20, 70],
  ["INFRAESTRUCTURA", 13, 278],
  ["ELECTROMECANICA", 13, 141],
  ["TIERRAS", 12, 81],
  ["TRANSMISION", 11, 32],
  ["HOJA DE SEG", 8, 42],
  ["REPORTE FOTOGRAFICO", 13, 211],
  ["base", 1, 1],
] as const;
export const PHOTO_SLOT_COUNT = 16;
export const CATALOG_SCHEMA_VERSION = 3;
const PHOTO_SLOT_START_ROW = 3;
const OFFICIAL_PHOTO_SLOT_REFS = [
  "REPORTE FOTOGRAFICO!A10:F27", "REPORTE FOTOGRAFICO!H10:M27",
  "REPORTE FOTOGRAFICO!A34:F50", "REPORTE FOTOGRAFICO!H34:M50",
  "REPORTE FOTOGRAFICO!A62:F78", "REPORTE FOTOGRAFICO!H62:M78",
  "REPORTE FOTOGRAFICO!A86:F102", "REPORTE FOTOGRAFICO!H86:M102",
  "REPORTE FOTOGRAFICO!A114:F130", "REPORTE FOTOGRAFICO!H114:M130",
  "REPORTE FOTOGRAFICO!A138:F154", "REPORTE FOTOGRAFICO!H138:M154",
  "REPORTE FOTOGRAFICO!A166:F182", "REPORTE FOTOGRAFICO!H166:M182",
  "REPORTE FOTOGRAFICO!A190:F206", "REPORTE FOTOGRAFICO!H190:M206",
] as const;

export type ResponseType =
  | "text" | "number" | "date" | "selection" | "measurement" | "observation" | "status";
export type TemplateField = {
  id: string; sheet: string; subsection: string; key: string; label: string;
  responseType: ResponseType; options: string[]; required: boolean;
  applicability: string; evidenceSlot: "photo" | "observation" | "none";
  target: string; sourceEvidence: string; confidence: number;
  state: "mapped" | "ignored" | "unresolved"; ignoreReason: string | null;
  role?: "presentation" | "question" | "additional" | "standalone";
  questionId?: string;
  questionLabel?: string;
  row?: number;
  section?: string;
  logical?: boolean;
  observationTarget?: string | null;
  defaultValue?: string;
};
export type TemplateQuestion = {
  id: string;
  sheet: string;
  section: string;
  subsection: string;
  row: number;
  label: string;
  statusTarget: string;
  observationTarget: string | null;
  field: TemplateField;
  additionalFields: TemplateField[];
};
export type TemplateCandidate = {
  target: string; sheet: string; reason: string; confidence: number;
  state: "unresolved" | "ignored"; ignoreReason: string | null;
};
export type TemplateCatalog = {
  catalog: TemplateField[]; unmapped: TemplateCandidate[];
  audit: Array<Record<string, unknown>>; ready: boolean;
  questions?: TemplateQuestion[];
  schemaVersion?: number;
};

/** Local onboarding treats the known empty separator cell as non-operational. */
export function resolveLocalSeparators(parsed: TemplateCatalog): TemplateCatalog {
  const ignored = parsed.unmapped.filter((candidate) =>
    candidate.target.toUpperCase() === "INFRAESTRUCTURA!D20" ||
    (!candidate.reason.toLowerCase().includes("evidencia") &&
      candidate.target.toUpperCase().includes("!D20")),
  );
  if (ignored.length === 0) return parsed;
  const ignoredTargets = new Set(ignored.map((candidate) => candidate.target));
  return {
    ...parsed,
    unmapped: parsed.unmapped.filter((candidate) => !ignoredTargets.has(candidate.target)),
    audit: [
      ...parsed.audit,
      ...ignored.map((candidate) => ({
        type: "candidate-auto-ignored",
        target: candidate.target,
        reason: "Fila separadora vacía detectada automáticamente",
      })),
    ],
    ready: parsed.unmapped.every((candidate) => ignoredTargets.has(candidate.target)),
  };
}
export type TemplateVerification = {
  valid: boolean; sheets: string[]; writtenTargets: string[]; details: string[];
};
export type EvidencePhoto = {
  id: string;
  bytes: Buffer;
  contentType: string;
  target?: string;
};

function unescapeXml(value: string): string {
  return value.replace(/&(#x?[0-9a-f]+|amp|lt|gt|quot|apos);/gi, (_, entity: string) => {
    if (entity.toLowerCase() === "amp") return "&";
    if (entity.toLowerCase() === "lt") return "<";
    if (entity.toLowerCase() === "gt") return ">";
    if (entity.toLowerCase() === "quot") return '"';
    if (entity.toLowerCase() === "apos") return "'";
    const hex = entity[0].toLowerCase() === "x";
    return String.fromCodePoint(parseInt(entity.slice(hex ? 1 : 0), hex ? 16 : 10));
  });
}
function escapeXml(value: string): string {
  return value.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c]!);
}
function attr(xml: string, name: string): string | undefined {
  const m = new RegExp(`\\b${name}="([^"]*)"`, "i").exec(xml);
  return m ? unescapeXml(m[1]) : undefined;
}
function colNumber(ref: string): number {
  const letters = /^([A-Z]+)/i.exec(ref)?.[1].toUpperCase() ?? "";
  return [...letters].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0);
}
function cellRef(row: number, col: number): string {
  let letters = "";
  for (let n = col; n; n = Math.floor((n - 1) / 26)) letters = String.fromCharCode(65 + ((n - 1) % 26)) + letters;
  return `${letters}${row}`;
}
function textNodes(xml: string, tag: string): string[] {
  return [...xml.matchAll(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, "gi"))]
    .map((m) => unescapeXml(m[1].replace(/<[^>]+>/g, "")));
}

type ZipEntry = {
  name: string;
  central: Buffer;
  local: Buffer;
  compressed: Buffer;
  data: Buffer;
  method: number;
};
function zipEntries(input: Buffer): { entries: ZipEntry[]; comment: Buffer } {
  const eocd = input.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error("El archivo no es un ZIP OOXML válido");
  const count = input.readUInt16LE(eocd + 10);
  const centralSize = input.readUInt32LE(eocd + 12);
  const centralOffset = input.readUInt32LE(eocd + 16);
  const entries: ZipEntry[] = [];
  let cursor = centralOffset;
  for (let i = 0; i < count; i++) {
    if (input.readUInt32LE(cursor) !== 0x02014b50) throw new Error("Directorio ZIP OOXML inválido");
    const centralLen = 46 + input.readUInt16LE(cursor + 28) + input.readUInt16LE(cursor + 30) + input.readUInt16LE(cursor + 32);
    const central = Buffer.from(input.subarray(cursor, cursor + centralLen));
    const nameLen = input.readUInt16LE(cursor + 28);
    const name = input.subarray(cursor + 46, cursor + 46 + nameLen).toString();
    const localOffset = input.readUInt32LE(cursor + 42);
    if (input.readUInt32LE(localOffset) !== 0x04034b50) throw new Error("Cabecera local ZIP OOXML inválida");
    const localLen = 30 + input.readUInt16LE(localOffset + 26) + input.readUInt16LE(localOffset + 28);
    const compressedLen = input.readUInt32LE(cursor + 20);
    const local = Buffer.from(input.subarray(localOffset, localOffset + localLen + compressedLen));
    const compressed = input.subarray(localOffset + localLen, localOffset + localLen + compressedLen);
    const method = input.readUInt16LE(cursor + 10);
    let data: Buffer;
    if (method === 0) data = Buffer.from(compressed);
    else if (method === 8) data = inflateRawSync(compressed);
    else throw new Error(`Compresión ZIP no soportada en ${name}`);
    entries.push({ name, central, local, compressed: Buffer.from(compressed), data, method });
    cursor += centralLen;
  }
  return { entries, comment: Buffer.from(input.subarray(eocd + 22, eocd + 22 + input.readUInt16LE(eocd + 20))) };
}
function zipXml(entries: ReturnType<typeof zipEntries>["entries"], comment: Buffer): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    // Data-descriptor ZIPs (general-purpose bit 3) are common in streamed
    // workbook writers. Rebuild every local header from the central directory
    // and clear bit 3 so no stale descriptor bytes or sizes survive.
    const local = rebuildLocalHeader(entry);
    entry.local = local;
    locals.push(local);
    const central = Buffer.from(entry.central);
    central.writeUInt16LE(central.readUInt16LE(8) & ~0x0008, 8);
    central.writeUInt32LE(offset, 42);
    centrals.push(central);
    offset += local.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22 + comment.length);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8); eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(offset, 16); eocd.writeUInt16LE(comment.length, 20);
  comment.copy(eocd, 22);
  return Buffer.concat([...locals, cd, eocd]);
}

function newStoredEntry(name: string, data: Buffer): ZipEntry {
  const nameBytes = Buffer.from(name);
  const checksum = crc32(data);
  const local = Buffer.alloc(30 + nameBytes.length);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0, 6);
  local.writeUInt16LE(0, 8);
  local.writeUInt32LE(checksum, 14);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(nameBytes.length, 26);
  nameBytes.copy(local, 30);
  const central = Buffer.alloc(46 + nameBytes.length);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0, 8); central.writeUInt16LE(0, 10);
  central.writeUInt32LE(checksum, 16);
  central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(nameBytes.length, 28);
  nameBytes.copy(central, 46);
  return { name, central, local: Buffer.concat([local, data]), compressed: data, data, method: 0 };
}

function normalizePackagePath(base: string, target: string): string {
  const parts = `${base}/${target}`.split("/");
  const result: string[] = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") result.pop();
    else result.push(part);
  }
  return result.join("/");
}

function nextRelationshipId(xml: string): string {
  let max = 0;
  for (const match of xml.matchAll(/\bId="rId(\d+)"/g)) max = Math.max(max, Number(match[1]));
  return `rId${max + 1}`;
}

function nextDrawingShapeId(xml: string): number {
  let max = 0;
  for (const match of xml.matchAll(/\bcNvPr\b[^>]*\bid="(\d+)"/g)) max = Math.max(max, Number(match[1]));
  return max + 1;
}

function evidenceAnchor(ref: string, relationshipId: string, shapeId: number, name: string): string {
  const [start, end = start] = ref.split(":").map((part) => part.trim());
  const startCol = colNumber(start) - 1;
  const startRow = Number(start.replace(/\D/g, "")) - 1;
  const endCol = colNumber(end);
  const endRow = Number(end.replace(/\D/g, ""));
  return `<xdr:twoCellAnchor editAs="oneCell"><xdr:from><xdr:col>${startCol}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${startRow}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>${endCol}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${endRow}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="${shapeId}" name="${escapeXml(name)}"/><xdr:cNvPicPr/></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="${relationshipId}"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:twoCellAnchor>`;
}

function shiftCellReference(value: string, rowOffset: number): string {
  return value.replace(/(\$?[A-Z]{1,3}\$?)(\d+)/g, (_match, column: string, row: string) =>
    `${column}${Number(row) + rowOffset}`);
}

function shiftReferenceAttributes(xml: string, rowOffset: number): string {
  return xml
    .replace(/\b(r|ref|sqref|formula)="([^"]*)"/gi, (_match, name: string, value: string) =>
      `${name}="${name.toLowerCase() === "r" && /^\d+$/.test(value) ? Number(value) + rowOffset : value.split(/\s+/).map((part) => shiftCellReference(part, rowOffset)).join(" ")}"`)
    .replace(/<f(\b[^>]*)>([\s\S]*?)<\/f>/gi, (_match, attrs: string, formula: string) =>
      `<f${attrs}>${shiftCellReference(formula, rowOffset)}</f>`);
}

function updateEntryData(entry: ZipEntry, data: Buffer): void {
  entry.data = data;
  entry.compressed = deflateRawSync(data);
  entry.method = 8;
  const headerLen = 30 + entry.local.readUInt16LE(26) + entry.local.readUInt16LE(28);
  entry.local = Buffer.concat([entry.local.subarray(0, headerLen), entry.compressed]);
  entry.central.writeUInt16LE(8, 10);
  entry.central.writeUInt32LE(crc32(data), 16);
  entry.central.writeUInt32LE(entry.compressed.length, 20);
  entry.central.writeUInt32LE(data.length, 24);
}

function cloneEvidenceBlocks(entries: ZipEntry[], sheet: { path: string }, pages: number): void {
  if (pages <= 1) return;
  const worksheet = entries.find((entry) => entry.name === sheet.path);
  if (!worksheet) throw new Error("Falta XML de REPORTE FOTOGRAFICO");
  let xml = xmlData(worksheet);
  const rows = new Map<number, string>();
  for (const match of xml.matchAll(/<row\b[^>]*\br="(\d+)"[^>]*(?:\/>|>[\s\S]*?<\/row\s*>)/gi)) {
    const row = Number(match[1]);
    if (row >= 1 && row <= 211) rows.set(row, match[0]);
  }
  if (rows.size === 0) throw new Error("REPORTE FOTOGRAFICO no contiene filas clonables en el bloque base A1:M211");
  const sheetDataClose = xml.indexOf("</sheetData>");
  if (sheetDataClose < 0) throw new Error("REPORTE FOTOGRAFICO carece de sheetData");
  let clones = "";
  for (let page = 1; page < pages; page++) {
    const offset = page * 211;
    clones += [...rows.entries()].map(([, rowXml]) => shiftReferenceAttributes(rowXml, offset)).join("");
  }
  xml = `${xml.slice(0, sheetDataClose)}${clones}${xml.slice(sheetDataClose)}`;
  xml = xml.replace(/(<dimension\b[^>]*\bref=")[^"]+(")/i, `$1A1:M${211 * pages}$2`);
  const mergeContainer = /<mergeCells\b[^>]*>([\s\S]*?)<\/mergeCells>/i.exec(xml);
  if (mergeContainer) {
    const source = mergeContainer[1];
    let extra = "";
    for (let page = 1; page < pages; page++) extra += source.replace(/<mergeCell\b[^>]*\/>/gi, (merge) => shiftReferenceAttributes(merge, page * 211));
    xml = xml.replace(mergeContainer[0], mergeContainer[0].replace("</mergeCells>", `${extra}</mergeCells>`));
  }
  const dataValidationMatches = [...xml.matchAll(/<dataValidation\b[^>]*\/>|<dataValidation\b[^>]*>[\s\S]*?<\/dataValidation\s*>/gi)]
    .map((match) => match[0]).filter((item) => /\bsqref="/i.test(item));
  if (dataValidationMatches.length) {
    const extra = dataValidationMatches.map((item) =>
      [...Array(pages - 1)].map((_, page) => shiftReferenceAttributes(item, (page + 1) * 211)).join(""),
    ).join("");
    const container = /<\/dataValidations>/i.exec(xml);
    if (container) xml = `${xml.slice(0, container.index)}${extra}${xml.slice(container.index)}`;
  }
  const conditionalMatches = [...xml.matchAll(/<conditionalFormatting\b[^>]*>[\s\S]*?<\/conditionalFormatting\s*>/gi)].map((match) => match[0]);
  if (conditionalMatches.length) {
    const extra = conditionalMatches.map((item) => [...Array(pages - 1)].map((_, page) => shiftReferenceAttributes(item, (page + 1) * 211)).join("")).join("");
    const before = xml.indexOf("</worksheet>");
    xml = `${xml.slice(0, before)}${extra}${xml.slice(before)}`;
  }
  const hyperlinkMatches = [...xml.matchAll(/<hyperlink\b[^>]*\/>/gi)].map((match) => match[0]).filter((item) => /\bref="/i.test(item));
  if (hyperlinkMatches.length) {
    const extra = hyperlinkMatches.map((item) => [...Array(pages - 1)].map((_, page) => shiftReferenceAttributes(item, (page + 1) * 211)).join("")).join("");
    const container = /<\/hyperlinks>/i.exec(xml);
    if (container) xml = `${xml.slice(0, container.index)}${extra}${xml.slice(container.index)}`;
  }
  const breakMatches = [...xml.matchAll(/<brk\b[^>]*\bid="(\d+)"[^>]*\/>/gi)].map((match) => match[0]);
  if (breakMatches.length) {
    const extra = breakMatches.map((item) => [...Array(pages - 1)].map((_, page) =>
      item.replace(/\bid="(\d+)"/i, (_m, id) => `id="${Number(id) + page * 211}"`).replace(/\b(max|man)="(\d+)"/gi, (_m, name, row) => `${name}="${Number(row) + page * 211}"`),
    ).join("")).join("");
    const container = /<\/rowBreaks>/i.exec(xml);
    if (container) xml = `${xml.slice(0, container.index)}${extra}${xml.slice(container.index)}`;
  }
  updateEntryData(worksheet, Buffer.from(xml));

  const worksheetRelsPath = `${sheet.path.slice(0, sheet.path.lastIndexOf("/"))}/_rels/${sheet.path.slice(sheet.path.lastIndexOf("/") + 1)}.rels`;
  const worksheetRels = entries.find((entry) => entry.name === worksheetRelsPath);
  const drawingRel = worksheetRels && [...xmlData(worksheetRels).matchAll(/<Relationship\b([^>]*)\/?>/g)]
    .map((match) => ({ type: attr(match[1], "Type"), target: attr(match[1], "Target") }))
    .find((relationship) => relationship.type?.endsWith("/drawing"));
  if (drawingRel?.target) {
    const drawingPath = normalizePackagePath(sheet.path.slice(0, sheet.path.lastIndexOf("/")), drawingRel.target);
    const drawing = entries.find((entry) => entry.name === drawingPath);
    if (drawing) {
      let drawingXml = xmlData(drawing);
      const anchors = [...drawingXml.matchAll(/<xdr:(?:twoCellAnchor|oneCellAnchor)\b[\s\S]*?<\/xdr:(?:twoCellAnchor|oneCellAnchor)\s*>/gi)]
        .map((match) => match[0])
        .filter((anchor) => {
          const rows = [...anchor.matchAll(/<xdr:row>(\d+)<\/xdr:row>/gi)].map((match) => Number(match[1]));
          return rows.length > 0 && rows.every((row) => row < 211);
        });
      let anchorClones = "";
      for (let page = 1; page < pages; page++) {
        const offset = page * 211;
        anchorClones += anchors.map((anchor) => anchor
          .replace(/(<xdr:row>)(\d+)(<\/xdr:row>)/gi, (_m, open, row, close) =>
            `${open}${Number(row) + offset}${close}`)
          .replace(/(<xdr:cNvPr\b[^>]*\bid=")(\d+)(")/gi, (_m, open, id, close) =>
            `${open}${Number(id) + page * 10000}${close}`)).join("");
      }
      drawingXml = drawingXml.replace(/<\/xdr:wsDr\s*>\s*$/i, `${anchorClones}</xdr:wsDr>`);
      updateEntryData(drawing, Buffer.from(drawingXml));
    }
  }

  const workbook = entries.find((entry) => entry.name === "xl/workbook.xml");
  if (workbook) {
    let workbookXml = xmlData(workbook);
    workbookXml = workbookXml.replace(/(<definedName\b[^>]*name="_xlnm\.Print_Area"[^>]*>)([\s\S]*?)(<\/definedName>)/gi,
      (match, open: string, body: string, close: string) =>
        body.includes("REPORTE FOTOGRAFICO") || body.includes("REPORTE%20FOTOGRAFICO")
          ? `${open}${body.replace(/(\$M\$?)\d+/g, `$1${211 * pages}`)}${close}` : match);
    updateEntryData(workbook, Buffer.from(workbookXml));
  }
}

export function embedEvidence(
  bytes: Buffer,
  photos: EvidencePhoto[],
  catalog: TemplateField[],
): { bytes: Buffer; consumedPhotoIds: string[]; details: string[]; valid: boolean } {
  const targetedPhotos = photos.filter((photo) => Boolean(photo.target));
  if (targetedPhotos.length > 0) {
    const reportResult = embedEvidence(bytes, photos.filter((photo) => !photo.target), catalog);
    if (!reportResult.valid) return reportResult;
    const targetedResult = embedTargetedEvidence(reportResult.bytes, targetedPhotos);
    return {
      bytes: targetedResult.bytes,
      consumedPhotoIds: [...reportResult.consumedPhotoIds, ...targetedResult.consumedPhotoIds],
      details: [...reportResult.details, ...targetedResult.details],
      valid: targetedResult.valid,
    };
  }
  const parsed = zipEntries(bytes);
  const sheets = workbookSheets(parsed.entries);
  const mappedPhotoFields = catalog
    .filter((field) => field.state === "mapped" && field.sheet === "REPORTE FOTOGRAFICO" && field.evidenceSlot === "photo")
    .sort((a, b) => a.target.localeCompare(b.target));
  const photoFields: TemplateField[] = mappedPhotoFields.length > 0
    ? mappedPhotoFields
    : OFFICIAL_PHOTO_SLOT_REFS.map((target, index) => ({
      id: `REPORTE FOTOGRAFICO:photo:${index + 1}`,
      sheet: "REPORTE FOTOGRAFICO",
      subsection: `espacio ${index + 1}`,
      key: target,
      label: `Fotografía ${index + 1}`,
      responseType: "observation",
      options: [],
      required: false,
      applicability: "evidence.photo",
      evidenceSlot: "photo",
      target,
      sourceEvidence: "Destino fotográfico oficial de la plantilla",
      confidence: 1,
      state: "mapped",
      ignoreReason: null,
    }));
  if (photos.length === 0) return { bytes, consumedPhotoIds: [], details: [], valid: true };
  if (photoFields.length === 0) {
    return { bytes, consumedPhotoIds: [], details: ["No hay slots REPORTE FOTOGRAFICO mapeados para fotografías"], valid: false };
  }
  const sheet = sheets.find((item) => item.name === "REPORTE FOTOGRAFICO");
  if (!sheet) return { bytes, consumedPhotoIds: [], details: ["Falta REPORTE FOTOGRAFICO"], valid: false };
  const worksheet = parsed.entries.find((entry) => entry.name === sheet.path);
  if (!worksheet) return { bytes, consumedPhotoIds: [], details: ["Falta XML de REPORTE FOTOGRAFICO"], valid: false };
  const baseDimension = attr(/<dimension\b([^>]*)\/?>/i.exec(xmlData(worksheet))?.[1] ?? "", "ref");
  if (baseDimension !== "A1:M211") {
    return { bytes, consumedPhotoIds: [], details: ["REPORTE FOTOGRAFICO no tiene la dimensión base A1:M211"], valid: false };
  }
  const pages = Math.max(1, Math.ceil(photos.length / photoFields.length));
  cloneEvidenceBlocks(parsed.entries, sheet, pages);
  const worksheetRelsPath = `${sheet.path.slice(0, sheet.path.lastIndexOf("/"))}/_rels/${sheet.path.slice(sheet.path.lastIndexOf("/") + 1)}.rels`;
  let worksheetRels = parsed.entries.find((entry) => entry.name === worksheetRelsPath);
  let worksheetRelsXml = worksheetRels ? xmlData(worksheetRels) : `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`;
  let worksheetXml = xmlData(worksheet);
  const drawingMatch = /<drawing\b[^>]*\br:id="([^"]+)"[^>]*\/?>/i.exec(worksheetXml);
  let drawingPath: string;
  let drawingRelsPath: string;
  let drawingRelId: string;
  let drawing: ZipEntry;
  let drawingRels: ZipEntry | undefined;
  let drawingRelsXml: string;
  let createdDrawing = false;
  if (drawingMatch) {
    drawingRelId = drawingMatch[1];
    const relationship = [...worksheetRelsXml.matchAll(/<Relationship\b([^>]*)\/?>/g)]
      .map((match) => ({ id: attr(match[1], "Id"), target: attr(match[1], "Target") }))
      .find((item) => item.id === drawingRelId);
    if (!relationship?.target) return { bytes, consumedPhotoIds: [], details: ["La relación de drawing existente no es resoluble"], valid: false };
    drawingPath = normalizePackagePath(sheet.path.slice(0, sheet.path.lastIndexOf("/")), relationship.target);
    drawing = parsed.entries.find((entry) => entry.name === drawingPath)!;
    if (!drawing) return { bytes, consumedPhotoIds: [], details: ["Falta el drawing existente"], valid: false };
    drawingRelsPath = `${drawingPath.slice(0, drawingPath.lastIndexOf("/"))}/_rels/${drawingPath.slice(drawingPath.lastIndexOf("/") + 1)}.rels`;
    drawingRels = parsed.entries.find((entry) => entry.name === drawingRelsPath);
    drawingRelsXml = drawingRels ? xmlData(drawingRels) : `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`;
  } else {
    createdDrawing = true;
    const drawingNumber = parsed.entries.filter((entry) => /^xl\/drawings\/drawing\d+\.xml$/.test(entry.name)).length + 1;
    drawingPath = `xl/drawings/drawing${drawingNumber}.xml`;
    drawing = newStoredEntry(drawingPath, Buffer.from(`<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"></xdr:wsDr>`));
    parsed.entries.push(drawing);
    drawingRelId = nextRelationshipId(worksheetRelsXml);
    worksheetRelsXml = worksheetRelsXml.replace("</Relationships>", `<Relationship Id="${drawingRelId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/${drawingPath.split("/").pop()}"/></Relationships>`);
    drawingRelsPath = `xl/drawings/_rels/${drawingPath.split("/").pop()}.rels`;
    drawingRelsXml = `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`;
  }
  const shapeStart = nextDrawingShapeId(xmlData(drawing));
  const consumedPhotoIds: string[] = [];
  let drawingXml = xmlData(drawing);
  for (let index = 0; index < photos.length; index++) {
    const photo = photos[index];
    const extension = photo.contentType.includes("png") ? "png" : photo.contentType.includes("jpeg") || photo.contentType.includes("jpg") ? "jpg" : "";
    if (!extension) return { bytes, consumedPhotoIds, details: [`Tipo de imagen no soportado para ${photo.id}`], valid: false };
    const mediaPath = `xl/media/template-${sha256(photo.bytes).slice(0, 16)}-${index}.${extension}`;
    if (!parsed.entries.some((entry) => entry.name === mediaPath)) parsed.entries.push(newStoredEntry(mediaPath, photo.bytes));
    const relationshipId = nextRelationshipId(drawingRelsXml);
    drawingRelsXml = drawingRelsXml.replace("</Relationships>", `<Relationship Id="${relationshipId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/${mediaPath.split("/").pop()}"/></Relationships>`);
    const slotRef = photoFields[index % photoFields.length].target.split("!")[1];
    const pageOffset = Math.floor(index / photoFields.length) * 211;
    drawingXml = drawingXml.replace(/<\/(?:xdr:wsDr|wsDr)>\s*$/i,
      `${evidenceAnchor(shiftCellReference(slotRef, pageOffset), relationshipId, shapeStart + index, `Evidence ${photo.id}`)}</xdr:wsDr>`);
    consumedPhotoIds.push(photo.id);
  }
  drawing.data = Buffer.from(drawingXml);
  drawing.compressed = deflateRawSync(drawing.data);
  drawing.method = 8;
  const drawingHeaderLen = 30 + drawing.local.readUInt16LE(26) + drawing.local.readUInt16LE(28);
  drawing.local = Buffer.concat([drawing.local.subarray(0, drawingHeaderLen), drawing.compressed]);
  drawing.central.writeUInt16LE(8, 10);
  drawing.central.writeUInt32LE(crc32(drawing.data), 16);
  drawing.central.writeUInt32LE(drawing.compressed.length, 20);
  drawing.central.writeUInt32LE(drawing.data.length, 24);
  if (!drawingRels) {
    drawingRels = newStoredEntry(drawingRelsPath, Buffer.from(drawingRelsXml));
    parsed.entries.push(drawingRels);
  } else {
    drawingRels.data = Buffer.from(drawingRelsXml);
    drawingRels.compressed = deflateRawSync(drawingRels.data);
    drawingRels.method = 8;
    const headerLen = 30 + drawingRels.local.readUInt16LE(26) + drawingRels.local.readUInt16LE(28);
    drawingRels.local = Buffer.concat([drawingRels.local.subarray(0, headerLen), drawingRels.compressed]);
    drawingRels.central.writeUInt16LE(8, 10);
    drawingRels.central.writeUInt32LE(crc32(drawingRels.data), 16);
    drawingRels.central.writeUInt32LE(drawingRels.compressed.length, 20);
    drawingRels.central.writeUInt32LE(drawingRels.data.length, 24);
  }
  if (!worksheetRels) {
    worksheetRels = newStoredEntry(worksheetRelsPath, Buffer.from(worksheetRelsXml));
    parsed.entries.push(worksheetRels);
  } else {
    worksheetRels.data = Buffer.from(worksheetRelsXml);
    worksheetRels.compressed = deflateRawSync(worksheetRels.data);
    worksheetRels.method = 8;
    const headerLen = 30 + worksheetRels.local.readUInt16LE(26) + worksheetRels.local.readUInt16LE(28);
    worksheetRels.local = Buffer.concat([worksheetRels.local.subarray(0, headerLen), worksheetRels.compressed]);
    worksheetRels.central.writeUInt16LE(8, 10);
    worksheetRels.central.writeUInt32LE(crc32(worksheetRels.data), 16);
    worksheetRels.central.writeUInt32LE(worksheetRels.compressed.length, 20);
    worksheetRels.central.writeUInt32LE(worksheetRels.data.length, 24);
  }
  if (!drawingMatch) worksheetXml = worksheetXml.replace("</worksheet>", `<drawing r:id="${drawingRelId}"/></worksheet>`);
  worksheet.data = Buffer.from(worksheetXml);
  worksheet.compressed = deflateRawSync(worksheet.data);
  worksheet.method = 8;
  const worksheetHeaderLen = 30 + worksheet.local.readUInt16LE(26) + worksheet.local.readUInt16LE(28);
  worksheet.local = Buffer.concat([worksheet.local.subarray(0, worksheetHeaderLen), worksheet.compressed]);
  worksheet.central.writeUInt16LE(8, 10);
  worksheet.central.writeUInt32LE(crc32(worksheet.data), 16);
  worksheet.central.writeUInt32LE(worksheet.compressed.length, 20);
  worksheet.central.writeUInt32LE(worksheet.data.length, 24);
  const contentTypes = parsed.entries.find((entry) => entry.name === "[Content_Types].xml");
  if (contentTypes) {
    let contentXml = xmlData(contentTypes);
    if (!/<Default\b[^>]*Extension="png"/i.test(contentXml)) contentXml = contentXml.replace("</Types>", `<Default Extension="png" ContentType="image/png"/></Types>`);
    if (!/<Default\b[^>]*Extension="jpg"/i.test(contentXml)) contentXml = contentXml.replace("</Types>", `<Default Extension="jpg" ContentType="image/jpeg"/></Types>`);
    const drawingPart = `/xl/drawings/${drawingPath.split("/").pop()}`;
    if (createdDrawing && !new RegExp(`<Override\\b[^>]*PartName="${drawingPart.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`, "i").test(contentXml)) {
      contentXml = contentXml.replace("</Types>", `<Override PartName="${drawingPart}" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/></Types>`);
    }
    contentTypes.data = Buffer.from(contentXml); contentTypes.compressed = deflateRawSync(contentTypes.data); contentTypes.method = 8;
    const headerLen = 30 + contentTypes.local.readUInt16LE(26) + contentTypes.local.readUInt16LE(28);
    contentTypes.local = Buffer.concat([contentTypes.local.subarray(0, headerLen), contentTypes.compressed]);
    contentTypes.central.writeUInt16LE(8, 10); contentTypes.central.writeUInt32LE(crc32(contentTypes.data), 16);
    contentTypes.central.writeUInt32LE(contentTypes.compressed.length, 20); contentTypes.central.writeUInt32LE(contentTypes.data.length, 24);
  } else {
    parsed.entries.push(newStoredEntry("[Content_Types].xml", Buffer.from(
      `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="png" ContentType="image/png"/><Default Extension="jpg" ContentType="image/jpeg"/><Override PartName="/${drawingPath}" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/></Types>`,
    )));
  }
  const result = zipXml(parsed.entries, parsed.comment);
  const allPresent = consumedPhotoIds.length === photos.length && consumedPhotoIds.every((id) => {
    const media = parsed.entries.some((entry) => entry.name.includes(sha256(photos.find((photo) => photo.id === id)!.bytes).slice(0, 16)));
    return media && drawingXml.includes(`Evidence ${id}`);
  });
  const expectedDimension = `A1:M${211 * pages}`;
  const dimensionValid = attr(
    /<dimension\b([^>]*)\/?>/i.exec(xmlData(parsed.entries.find((entry) => entry.name === sheet.path)!))?.[1] ?? "",
    "ref",
  ) === expectedDimension;
  return { bytes: result, consumedPhotoIds, details: allPresent && dimensionValid
    ? [`${consumedPhotoIds.length} fotografías embebidas en ${pages} bloque(s) A1:M211`]
    : ["No se pudieron verificar todas las fotografías embebidas o la dimensión esperada"], valid: allPresent && dimensionValid };
}

function updateBinaryEntry(entry: ZipEntry, data: Buffer): void {
  updateEntryData(entry, data);
}

function embedTargetedEvidence(
  bytes: Buffer,
  photos: EvidencePhoto[],
): { bytes: Buffer; consumedPhotoIds: string[]; details: string[]; valid: boolean } {
  const parsed = zipEntries(bytes);
  const sheets = workbookSheets(parsed.entries);
  const consumedPhotoIds: string[] = [];
  for (let index = 0; index < photos.length; index++) {
    const photo = photos[index];
    const target = photo.target;
    if (!target) continue;
    const [sheetName, rawRef] = target.split("!");
    const sheet = sheets.find((item) => item.name === sheetName);
    const worksheet = sheet && parsed.entries.find((entry) => entry.name === sheet.path);
    if (!sheet || !worksheet) return { bytes, consumedPhotoIds, details: [`Falta la hoja de fotografía ${sheetName}`], valid: false };
    const extension = photo.contentType.includes("png")
      ? "png"
      : photo.contentType.includes("jpeg") || photo.contentType.includes("jpg") ? "jpg" : "";
    if (!extension) return { bytes, consumedPhotoIds, details: [`Tipo de imagen no soportado para ${photo.id}`], valid: false };
    const mediaPath = `xl/media/target-${sha256(photo.bytes).slice(0, 16)}-${index}.${extension}`;
    if (!parsed.entries.some((entry) => entry.name === mediaPath)) {
      parsed.entries.push(newStoredEntry(mediaPath, photo.bytes));
    }
    let worksheetXml = xmlData(worksheet);
    const relsPath = `${sheet.path.slice(0, sheet.path.lastIndexOf("/"))}/_rels/${sheet.path.slice(sheet.path.lastIndexOf("/") + 1)}.rels`;
    let worksheetRels = parsed.entries.find((entry) => entry.name === relsPath);
    let worksheetRelsXml = worksheetRels
      ? xmlData(worksheetRels)
      : `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`;
    const drawingMatch = /<drawing\b[^>]*\br:id="([^"]+)"[^>]*\/?>/i.exec(worksheetXml);
    let drawing: ZipEntry;
    let drawingPath: string;
    let drawingRels: ZipEntry | undefined;
    let drawingRelsXml: string;
    let drawingRelId: string;
    if (drawingMatch) {
      drawingRelId = drawingMatch[1];
      const relationship = [...worksheetRelsXml.matchAll(/<Relationship\b([^>]*)\/?>/g)]
        .map((match) => ({ id: attr(match[1], "Id"), target: attr(match[1], "Target") }))
        .find((item) => item.id === drawingRelId);
      if (!relationship?.target) return { bytes, consumedPhotoIds, details: [`No se resolvió el drawing de ${sheetName}`], valid: false };
      drawingPath = normalizePackagePath(sheet.path.slice(0, sheet.path.lastIndexOf("/")), relationship.target);
      drawing = parsed.entries.find((entry) => entry.name === drawingPath)!;
      if (!drawing) return { bytes, consumedPhotoIds, details: [`Falta el drawing de ${sheetName}`], valid: false };
      const drawingRelsPath = `${drawingPath.slice(0, drawingPath.lastIndexOf("/"))}/_rels/${drawingPath.slice(drawingPath.lastIndexOf("/") + 1)}.rels`;
      drawingRels = parsed.entries.find((entry) => entry.name === drawingRelsPath);
      drawingRelsXml = drawingRels
        ? xmlData(drawingRels)
        : `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`;
    } else {
      const drawingNumber = parsed.entries.filter((entry) => /^xl\/drawings\/drawing\d+\.xml$/.test(entry.name)).length + 1;
      drawingPath = `xl/drawings/drawing${drawingNumber}.xml`;
      drawing = newStoredEntry(drawingPath, Buffer.from(
        `<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"></xdr:wsDr>`,
      ));
      parsed.entries.push(drawing);
      drawingRelId = nextRelationshipId(worksheetRelsXml);
      worksheetRelsXml = worksheetRelsXml.replace(
        "</Relationships>",
        `<Relationship Id="${drawingRelId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/${drawingPath.split("/").pop()}"/></Relationships>`,
      );
      worksheetXml = worksheetXml.replace("</worksheet>", `<drawing r:id="${drawingRelId}"/></worksheet>`);
      const drawingRelsPath = `xl/drawings/_rels/${drawingPath.split("/").pop()}.rels`;
      drawingRelsXml = `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`;
      drawingRels = newStoredEntry(drawingRelsPath, Buffer.from(drawingRelsXml));
      parsed.entries.push(drawingRels);
    }
    const relationshipId = nextRelationshipId(drawingRelsXml);
    drawingRelsXml = drawingRelsXml.replace(
      "</Relationships>",
      `<Relationship Id="${relationshipId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/${mediaPath.split("/").pop()}"/></Relationships>`,
    );
    const drawingXml = xmlData(drawing).replace(
      /<\/(?:xdr:wsDr|wsDr)>\s*$/i,
      `${evidenceAnchor(rawRef, relationshipId, nextDrawingShapeId(xmlData(drawing)) + index, `Evidence ${photo.id}`)}</xdr:wsDr>`,
    );
    updateBinaryEntry(drawing, Buffer.from(drawingXml));
    if (drawingRels) updateBinaryEntry(drawingRels, Buffer.from(drawingRelsXml));
    if (!worksheetRels) {
      worksheetRels = newStoredEntry(relsPath, Buffer.from(worksheetRelsXml));
      parsed.entries.push(worksheetRels);
    } else {
      updateBinaryEntry(worksheetRels, Buffer.from(worksheetRelsXml));
    }
    updateBinaryEntry(worksheet, Buffer.from(worksheetXml));
    const contentTypes = parsed.entries.find((entry) => entry.name === "[Content_Types].xml");
    if (contentTypes) {
      let contentXml = xmlData(contentTypes);
      if (!/<Default\b[^>]*Extension="png"/i.test(contentXml)) contentXml = contentXml.replace("</Types>", `<Default Extension="png" ContentType="image/png"/></Types>`);
      if (!/<Default\b[^>]*Extension="jpg"/i.test(contentXml)) contentXml = contentXml.replace("</Types>", `<Default Extension="jpg" ContentType="image/jpeg"/></Types>`);
      const drawingPart = `/xl/drawings/${drawingPath.split("/").pop()}`;
      if (!new RegExp(`<Override\\b[^>]*PartName="${drawingPart.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`, "i").test(contentXml)) {
        contentXml = contentXml.replace("</Types>", `<Override PartName="${drawingPart}" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/></Types>`);
      }
      updateBinaryEntry(contentTypes, Buffer.from(contentXml));
    }
    consumedPhotoIds.push(photo.id);
  }
  const output = zipXml(parsed.entries, parsed.comment);
  return {
    bytes: output,
    consumedPhotoIds,
    details: [`${consumedPhotoIds.length} fotografía(s) colocada(s) en sus celdas objetivo`],
    valid: consumedPhotoIds.length === photos.length,
  };
}

function rebuildLocalHeader(entry: ZipEntry): Buffer {
  const nameLen = entry.local.readUInt16LE(26);
  const extraLen = entry.local.readUInt16LE(28);
  const header = Buffer.from(entry.local.subarray(0, 30 + nameLen + extraLen));
  header.writeUInt16LE(header.readUInt16LE(6) & ~0x0008, 6);
  header.writeUInt16LE(entry.central.readUInt16LE(10), 8);
  header.writeUInt32LE(entry.central.readUInt32LE(16), 14);
  header.writeUInt32LE(entry.central.readUInt32LE(20), 18);
  header.writeUInt32LE(entry.central.readUInt32LE(24), 22);
  return Buffer.concat([header, entry.compressed]);
}
function xmlData(entry: ZipEntry): string {
  return entry.data.toString("utf8");
}

function validateWorkbookStructure(entries: ZipEntry[], evidencePages = 1): string[] {
  const sheets = workbookSheets(entries);
  if (sheets.length !== EXPECTED_SHEETS.length) throw new Error("La plantilla debe tener exactamente diez hojas");
  const expected = new Map<string, { cols: number; rows: number }>(
    EXPECTED_SHEETS.map(([name, cols, rows]) => [name, { cols, rows }]),
  );
  sheets.forEach((sheet, index) => {
    const expectedSheet = EXPECTED_SHEETS[index];
    const dims = expected.get(sheet.name);
    if (!dims || expectedSheet[0] !== sheet.name) throw new Error(`Hoja ${index + 1} inválida: se esperaba ${expectedSheet?.[0] ?? "ninguna"}`);
    const entry = entries.find((e) => e.name === sheet.path);
    if (!entry) throw new Error(`Falta el XML de la hoja ${sheet.name}`);
    const dimension = attr(/<dimension\b([^>]*)\/?>/i.exec(xmlData(entry))?.[1] ?? "", "ref");
    const expectedRef = cellRef(sheet.name === "REPORTE FOTOGRAFICO" ? dims.rows * evidencePages : dims.rows, dims.cols);
    if (sheet.name === "base" ? dimension !== "A1" : dimension !== `A1:${expectedRef}`) {
      throw new Error(`Dimensión inválida en ${sheet.name}: ${dimension ?? "desconocida"}`);
    }
  });
  return sheets.map((sheet) => sheet.name);
}

function workbookSheets(entries: ZipEntry[]): Array<{ name: string; path: string }> {
  const workbook = entries.find((e) => e.name === "xl/workbook.xml");
  const rels = entries.find((e) => e.name === "xl/_rels/workbook.xml.rels");
  if (!workbook || !rels) throw new Error("OOXML sin workbook.xml o relaciones");
  const targets = new Map<string, string>();
  for (const m of xmlData(rels).matchAll(/<Relationship\b([^>]*)\/?>/g)) {
    const id = attr(m[1], "Id"); const target = attr(m[1], "Target");
    if (id && target) targets.set(id, target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.?\//, "")}`);
  }
  return [...xmlData(workbook).matchAll(/<sheet\b([^>]*)\/?>/g)].map((m) => ({
    name: attr(m[1], "name") ?? "", path: targets.get(attr(m[1], "r:id") ?? "") ?? "",
  }));
}

export function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

type CatalogCell = { ref: string; value: string; formula: boolean; row: number; col: number };

function catalogNormalize(value: string): string {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "")
    .replace(/\s+/g, " ").trim().toUpperCase();
}

function catalogIsHeader(value: string): boolean {
  return /^(ESTADO|ESTATUS|STATUS|OBSERVACIONES?|FOTOGRAF[IÍ]A|N[ÚU]MERO|ESCENARIO|POSICI[ÓO]N|ID ALARM|LEYENDA DE ALARMA)$/i.test(value.trim());
}

function catalogIsInstruction(value: string): boolean {
  const normalized = catalogNormalize(value);
  return !normalized ||
    /^(VERIFICAR CORRECTO FUNCIONAMIENTO|INDICAR EN ESTATUS|PARAMETROS DE ESTADO|PAR[AÁ]METROS DE ESTADO|REVISION |REVISI[ÓO]N |MANTENIMIENTO PREVENTIVO|DIRECCI[ÓO]N DE OPERACI[ÓO]N|SITIOS CELULARES)/.test(normalized);
}

function catalogMergedSecondary(
  ref: string,
  merged: Array<{ start: string; end: string }>,
): boolean {
  const match = /^([A-Z]+)(\d+)$/i.exec(ref);
  if (!match) return false;
  const col = colNumber(match[1]); const row = Number(match[2]);
  return merged.some((range) => {
    const startCol = colNumber(range.start.replace(/\d/g, ""));
    const endCol = colNumber(range.end.replace(/\d/g, ""));
    const startRow = Number(range.start.replace(/\D/g, ""));
    const endRow = Number(range.end.replace(/\D/g, ""));
    return row >= startRow && row <= endRow && col >= startCol && col <= endCol &&
      range.start.toUpperCase() !== ref.toUpperCase();
  });
}

function catalogAdditionalLabel(value: string): boolean {
  const normalized = catalogNormalize(value);
  if (!normalized || catalogIsHeader(value) || catalogIsInstruction(value)) return false;
  return /:$/.test(value.trim()) ||
    /^(MARCA|MODELO|TIPO|CANTIDAD|CAPACIDAD|NIVEL|ALIMENTACI[ÓO]N|FASE|ID .*ENLACE|PTA A|PTA B|NIVEL RX|ANOTAR|KVA|VAC|VDC|LITROS|VOLTAJE|AMPER|TEMPERATURA|HUMEDAD)/.test(normalized);
}

function catalogDate(serial: number): string {
  return new Date(Math.round((serial - 25569) * 86400 * 1000)).toISOString().slice(0, 10);
}

/**
 * Structural catalog importer. It intentionally does not inspect unlocked
 * styles as a proxy for questions: the official workbook uses styles for
 * layout, merged headings and empty output areas. A question is a real
 * maintenance row, with one status destination and optional child values.
 */
export function parseTemplate(bytes: Buffer): TemplateCatalog {
  const { entries } = zipEntries(bytes);
  const sheets = workbookSheets(entries);
  validateWorkbookStructure(entries);
  const sharedEntry = entries.find((entry) => entry.name === "xl/sharedStrings.xml");
  const sharedStrings = sharedEntry ? textNodes(xmlData(sharedEntry), "si") : [];
  const audit: Array<Record<string, unknown>> = [];
  const catalog: TemplateField[] = [];
  const questions: TemplateQuestion[] = [];
  const unmapped: TemplateCandidate[] = [];
  const questionnaireSheets = new Set([
    "(HW) ALARMAS DE FUERZA", "PLANTA HUAWEI", "INFRAESTRUCTURA",
    "ELECTROMECANICA", "TIERRAS", "TRANSMISION",
  ]);
  const excludedSheets = new Set(["HOJA DE SEG", "REPORTE FOTOGRAFICO", "base"]);
  // These are the only rows in PLANTA HUAWEI that have a real checklist
  // status destination. The remaining rows are the owner's relay/alarm
  // reference tables and must stay informational.
  const huaweiStatusRows = new Set([8, 9, 10, 11, 12, 13, 14, 15, 18]);
  audit.push({ type: "catalog-schema", version: CATALOG_SCHEMA_VERSION });

  const readCells = (entry: ZipEntry): Map<string, CatalogCell> => {
    const cells = new Map<string, CatalogCell>();
    for (const match of xmlData(entry).matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const head = match[1] ?? ""; const body = match[2] ?? "";
      const ref = attr(head, "r"); if (!ref) continue;
      const parts = /^([A-Z]+)(\d+)$/i.exec(ref); if (!parts) continue;
      const type = attr(head, "t") ?? "";
      const raw = textNodes(body, "v")[0] ?? textNodes(body, "t").join("");
      cells.set(ref, {
        ref, row: Number(parts[2]), col: colNumber(parts[1]),
        value: type === "s" ? (sharedStrings[Number(raw)] ?? "") : unescapeXml(raw),
        formula: /<f\b/i.test(body),
      });
    }
    return cells;
  };
  const mergedRanges = (entry: ZipEntry) => [...xmlData(entry).matchAll(/<mergeCell\b[^>]*ref="([^"]+)"/gi)]
    .map((match) => {
      const [start, end = start] = match[1].split(":");
      return { start, end };
    });
  const makeField = (
    input: Omit<TemplateField, "state" | "ignoreReason" | "confidence">,
  ): TemplateField => ({ ...input, state: "mapped", ignoreReason: null, confidence: 1 });

  const infrastructureRadiationBlocks = [
    { name: "LTE", sectionRow: 63, sectorRows: [65, 75, 85], sectors: ["SECTOR 001", "SECTOR 002", "SECTOR 003"], ret: true },
    { name: "UMTS 850", sectionRow: 97, sectorRows: [99, 109, 119], sectors: ["SECTOR X", "SECTOR Y", "SECTOR Z"], ret: true },
    { name: "UMTS 850 SAO", sectionRow: 129, sectorRows: [131, 141, 151], sectors: ["SECTOR X", "SECTOR Y", "SECTOR Z"], ret: true },
    { name: "UMTS 1900", sectionRow: 161, sectorRows: [163, 173, 183], sectors: ["SECTOR X", "SECTOR Y", "SECTOR Z"], ret: true },
    { name: "GSM 1900", sectionRow: 193, sectorRows: [195, 204, 213], sectors: ["SECTOR A", "SECTOR B", "SECTOR C"], ret: false },
    { name: "GSM 850", sectionRow: 222, sectorRows: [224, 233, 242], sectors: ["SECTOR A", "SECTOR B", "SECTOR C"], ret: false },
    { name: "5G", sectionRow: 251, sectorRows: [253, 262, 271], sectors: ["SECTOR A", "SECTOR B", "SECTOR C"], ret: false },
  ] as const;
  const radiationValueLabels = [
    "Inclinación eléctrica.",
    "Aislamiento en conectores y Kits-Tierra.",
    "Altura de radiación del sector en MTS.",
    "Estado general de la antena",
  ];
  const addInfrastructureField = (
    target: string,
    label: string,
    responseType: ResponseType,
    section: string,
    options: string[] = [],
    evidenceSlot: TemplateField["evidenceSlot"] = "none",
  ) => {
    const row = Number(target.match(/\d+/)?.[0] ?? 0);
    catalog.push(makeField({
      id: `INFRAESTRUCTURA:field:${target.replace(/[^A-Z0-9]+/gi, "-")}`,
      sheet: "INFRAESTRUCTURA",
      section,
      subsection: section,
      key: label,
      label,
      responseType,
      options,
      required: false,
      applicability: "infrastructure",
      evidenceSlot,
      target: `INFRAESTRUCTURA!${target}`,
      sourceEvidence: `${target}: ${label}`,
      role: "standalone",
      row,
      logical: true,
    }));
  };
  const addStandaloneField = (
    sheetName: string,
    target: string,
    label: string,
    responseType: ResponseType,
    fieldSection: string,
    options: string[] = [],
  ) => {
    const row = Number(target.match(/\d+/)?.[0] ?? 0);
    catalog.push(makeField({
      id: `${sheetName}:field:${target.replace(/[^A-Z0-9]+/gi, "-")}`,
      sheet: sheetName,
      section: fieldSection,
      subsection: fieldSection,
      key: label,
      label,
      responseType,
      options,
      required: false,
      applicability: "standalone",
      evidenceSlot: "none",
      target: `${sheetName}!${target}`,
      sourceEvidence: `${target}: ${label}`,
      role: "standalone",
      row,
      logical: true,
    }));
  };
  const addCellPlanMarkers = (row: number, block: string, sector: string, label: string) => {
    addInfrastructureField(`H${row}`, `${block} · ${sector} · ${label} · SI (marcar X)`, "selection", block, ["X"]);
    addInfrastructureField(`J${row}`, `${block} · ${sector} · ${label} · NO (marcar X)`, "selection", block, ["X"]);
  };

  const presentationDefinitions: Array<[string, string, ResponseType, string, string[]]> = [
    ["mnemónico", "A12", "text", "Mnemonico", []],
    ["mnemónicos del sitio", "A13", "text", "Mnemonico(s) de sitio", []],
    ["nombre del sitio", "A14", "text", "NOMBRE DE SITIO", []],
    ["tipo de radiobase", "A15", "selection", "TIPO DE RADIOBASE INDOOR/OUTDOOR", ["INDOOR", "OUTDOOR"]],
    ["región", "C18", "text", "Región:", []],
    ["central", "C19", "text", "Central:", []],
    ["dirección", "C20", "text", "Dirección:", []],
    ["fecha", "C21", "date", "Fecha:", []],
    ["ingeniero", "C22", "text", "Ingeniero que lo realizo:", []],
    ["número de tarea", "C23", "text", "No de Tarea (WO):", []],
  ];
  const presentation = sheets.find((sheet) => sheet.name === "PRESENTACION");
  const presentationCells = presentation
    ? readCells(entries.find((entry) => entry.name === presentation.path)!)
    : new Map<string, CatalogCell>();
  for (const [label, target, responseType, sourceEvidence, options] of presentationDefinitions) {
    const raw = presentationCells.get(target)?.value ?? "";
    const isLabelCell = catalogNormalize(raw) === catalogNormalize(sourceEvidence);
    const defaultValue = isLabelCell ? undefined
      : responseType === "date" && raw !== "" && Number.isFinite(Number(raw))
        ? catalogDate(Number(raw)) : raw || undefined;
    const id = `PRESENTACION:general:${catalogNormalize(label).replace(/[^A-Z0-9]+/g, "-")}`;
    catalog.push(makeField({
      id, sheet: "PRESENTACION", section: "Datos generales", subsection: "",
      key: label, label, responseType, options, required: true,
      applicability: "general", evidenceSlot: "none", target: `PRESENTACION!${target}`,
      sourceEvidence, role: "presentation", questionId: id,
      questionLabel: label, row: Number(target.replace(/\D/g, "")), logical: true, defaultValue,
    }));
  }
  audit.push({ type: "presentation-summary", expectedFields: 10, fields: presentationDefinitions.map(([label, target]) => ({ label, target })) });

  for (const sheet of sheets) {
    if (!questionnaireSheets.has(sheet.name)) {
      audit.push({ type: "sheet-excluded", sheet: sheet.name, reason: excludedSheets.has(sheet.name) ? "Salida/base interna" : "No es una hoja de mantenimiento" });
      continue;
    }
    const entry = entries.find((candidate) => candidate.name === sheet.path);
    if (!entry) throw new Error(`Falta XML de la hoja ${sheet.name}`);
    const cells = readCells(entry);
    const merged = mergedRanges(entry);
    const rows = new Map<number, Map<string, CatalogCell>>();
    for (const cell of cells.values()) {
      const row = rows.get(cell.row) ?? new Map<string, CatalogCell>();
      row.set(cell.ref.replace(/\d/g, ""), cell);
      rows.set(cell.row, row);
    }
    let section = sheet.name;
    if (sheet.name === "TRANSMISION") {
      const transmissionSection = "Enlaces de microondas";
      const transmissionLinks = [
        { index: 1, targets: ["G8", "F9", "G9", "H9", "I9", "J9"] },
        { index: 2, targets: ["G10", "F11", "G11", "H11", "I11", "J11"] },
      ] as const;
      for (const link of transmissionLinks) {
        const labels = [
          "Identificador",
          "Punta A",
          "Nivel RX de punta A",
          "Punta B",
          "Nivel RX de punta B",
          "Nivel RX adicional",
        ];
        link.targets.forEach((target, index) => {
          addStandaloneField(
            sheet.name,
            target,
            `Enlace de microondas ${link.index} · ${labels[index]}`,
            "text",
            transmissionSection,
          );
        });
      }
      addStandaloneField(
        sheet.name,
        "C14",
        "Modelo de CELL SITE ROUTER / AGREGADOR",
        "text",
        "CELL SITE ROUTER / AGREGADOR",
      );
      audit.push({
        type: "transmission-explicit-map",
        links: transmissionLinks.map((link) => ({ index: link.index, targets: [...link.targets] })),
        routerModelTarget: "C14",
      });
    }
    if (sheet.name === "(HW) ALARMAS DE FUERZA") {
      const ericssonLabels = [
        "Elemento monitoreado",
        "Texto estándar para alta y configuración",
        "Severidad",
        "Observaciones",
        "SUP",
        "Número de OVP",
        "Posición",
        "Código de colores",
        "Nombre de alarma / posición en SAU",
        "Estatus",
      ];
      const ericssonColumns = [..."ABCDEFGHIJ"];
      for (let row = 76; row <= 81; row++) {
        ericssonColumns.forEach((column, index) => {
          addStandaloneField(
            sheet.name,
            `${column}${row}`,
            `Alarma Ericsson ${row - 75} · ${ericssonLabels[index]}`,
            index === 9 ? "selection" : "text",
            "Alarmas Ericsson",
            index === 9 ? ["OK", "NOK", "SC", "NA"] : [],
          );
        });
      }
      audit.push({
        type: "ericsson-explicit-map",
        rows: [76, 77, 78, 79, 80, 81],
        columns: ericssonColumns,
      });
    }
    if (sheet.name === "ELECTROMECANICA") {
      const addElectromechanicalField = (
        target: string,
        label: string,
        responseType: ResponseType = "text",
        options: string[] = [],
      ) => addStandaloneField(
        sheet.name,
        target,
        label,
        responseType,
        "Mediciones auxiliares",
        options,
      );
      const electroFields: Array<[string, string, ResponseType?, string[]?]> = [
        ["G9", "Capacidad de acometida eléctrica", "measurement"],
        ["I9", "Tipo de acometida eléctrica", "selection", ["Termomagnético", "Cuchillas"]],
        ["G10", "Voltaje fase 1-neutro", "measurement"],
        ["J10", "Voltaje fase 2-neutro", "measurement"],
        ["G11", "Voltaje fase 3-neutro", "measurement"],
        ["G12", "Voltaje tierra-neutro", "measurement"],
        ["G13", "Voltaje fase 1-2", "measurement"],
        ["J13", "Voltaje fase 2-3", "measurement"],
        ["G14", "Voltaje fase 3-1", "measurement"],
        ["G15", "Calibre del cable de acometida CFE", "text"],
        ["I15", "Aislamiento del cable de acometida CFE", "text"],
        ["G16", "Calibre del cable de acometida al centro de carga", "text"],
        ["I16", "Aislamiento del cable de acometida al centro de carga", "text"],
        ["G17", "Capacidad del interruptor del centro de carga", "measurement"],
        ["G18", "Color conductor acometida indoor · Fase A", "text"],
        ["J18", "Color conductor acometida indoor · Fase B", "text"],
        ["G19", "Color conductor acometida indoor · Fase C", "text"],
        ["J19", "Color conductor acometida indoor · Neutro", "text"],
        ["G20", "Color conductor acometida indoor · Fase C adicional", "text"],
        ["G21", "Color conductor acometida outdoor · Fase A", "text"],
        ["J21", "Color conductor acometida outdoor · Fase B", "text"],
        ["G22", "Color conductor acometida outdoor · Neutro", "text"],
        ["J22", "Color conductor acometida outdoor · Tierra física", "text"],
        ["G37", "Cantidad de interruptores de alumbrado perimetral", "number"],
        ["G38", "Cantidad de lámparas de sala o contenedor", "number"],
        ["G39", "Tipo de luces dentro del contenedor", "text"],
        ["G40", "Tipo de luces del alumbrado externo", "text"],
        ["G44", "Capacidad del transformador", "measurement"],
        ["J45", "Tipo de transformador", "selection", ["Poste", "Jardín", "Otro"]],
        ["F51", "Marca de la planta de emergencia", "text"],
        ["I51", "Capacidad de la planta de emergencia", "measurement"],
        ["G52", "Voltaje con carga fase 1-2 de la planta de emergencia", "measurement"],
        ["G53", "Voltaje con carga fase 2-3 de la planta de emergencia", "measurement"],
        ["G54", "Voltaje con carga fase 3-1 de la planta de emergencia", "measurement"],
        ["G56", "Nivel de combustible de la planta de emergencia", "measurement"],
        ["G57", "Nivel de anticongelante de la planta de emergencia", "measurement"],
        ["G58", "Nivel de agua de las baterías de la planta de emergencia", "measurement"],
        ["G59", "Nivel de aceite de la planta de emergencia", "measurement"],
        ["G63", "Tiempo de transferencia de la planta de emergencia", "measurement"],
        ["G64", "Tiempo de retransferencia de la planta de emergencia", "measurement"],
        ["G65", "Tiempo de paro de la planta de emergencia", "measurement"],
        ["G66", "Contador de horas y fecha de la planta de emergencia", "text"],
        ["G67", "Capacidad del tanque de combustible", "measurement"],
        ["C70", "Marca del equipo de aire acondicionado", "text"],
        ["C71", "Modelo del equipo de aire acondicionado", "text"],
        ["G70", "Capacidad del equipo de aire acondicionado", "measurement"],
        ["G71", "Alimentación del equipo de aire acondicionado", "text"],
        ["G75", "Temperatura del contenedor", "measurement"],
        ["G76", "Humedad relativa del contenedor", "measurement"],
        ["G81", "Capacidad del interruptor de RBS Huawei", "measurement"],
        ["F82", "Voltaje de alimentación AC del gabinete Huawei", "measurement"],
        ["F83", "Voltaje de alimentación DC del Nodo B", "measurement"],
        ["G87", "Capacidad del interruptor de gabinete Carrier o TX", "measurement"],
        ["G129", "Voltaje de flotación de planta de gabinete CE o TX", "measurement"],
      ];
      for (const [target, label, responseType = "text", options = []] of electroFields) {
        addElectromechanicalField(target, label, responseType, options);
      }
      audit.push({
        type: "electromechanical-explicit-map",
        auxiliaryFields: electroFields.map(([target, label]) => ({ target, label })),
        stateQuestionRows: cells.size,
      });
    }
    if (sheet.name === "INFRAESTRUCTURA") {
      const section = "Conteo de antenas de torre";
      addInfrastructureField("D45", "Cantidad de tramos con los que está construida la torre", "selection", section,
        [...Array(12)].map((_, index) => String(index + 1)));
      for (let row = 48; row <= 59; row++) {
        const tramo = cells.get(`D${row}`)?.value.trim() || `Tramo ${60 - row}`;
        addInfrastructureField(`F${row}`, `${tramo} · Ubicación de plataforma`, "selection", section, ["X"]);
        addInfrastructureField(`G${row}`, `${tramo} · Cantidad de antenas RF`, "number", section);
        addInfrastructureField(`H${row}`, `${tramo} · Cantidad de antenas microondas`, "number", section);
        addInfrastructureField(`I${row}`, `${tramo} · Cantidad de equipos RRU`, "number", section);
      }
      addInfrastructureField("B60", "Fotografía completa de torre del sitio", "observation", section, [], "photo");

      const radiationLabels = [
        "Sector",
        "Marca/Modelo de antenas",
        "Orientación magnética o azimut",
        "Inclinación mecánica",
      ];
      for (const block of infrastructureRadiationBlocks) {
        for (let sectorIndex = 0; sectorIndex < block.sectorRows.length; sectorIndex++) {
          const start = block.sectorRows[sectorIndex];
          const sector = block.sectors[sectorIndex];
          const blockSection = `Sistema de radiación ${block.name}`;
          for (let offset = 0; offset < 4; offset++) {
            addCellPlanMarkers(start + offset, block.name, sector, radiationLabels[offset]);
          }
          for (let offset = 0; offset < radiationValueLabels.length; offset++) {
            const row = start + 4 + offset;
            const type: ResponseType = offset === 2 ? "measurement" : "text";
            addInfrastructureField(`D${row}`, `${block.name} · ${sector} · ${radiationValueLabels[offset]}`, type, blockSection);
          }
          if (block.ret) {
            const retRow = start + 8;
            addInfrastructureField(`E${retRow}:F${retRow}`, `${block.name} · ${sector} · Modelo de RET`, "text", blockSection);
            addInfrastructureField(`H${retRow}`, `${block.name} · ${sector} · Cantidad de RET`, "number", blockSection);
            addInfrastructureField(`J${retRow}`, `${block.name} · ${sector} · Device No. de RET`, "text", blockSection);
          }
        }
      }
      audit.push({
        type: "infrastructure-explicit-map",
        towerSections: 1,
        towerRows: 12,
        radiationBlocks: infrastructureRadiationBlocks.map((block) => ({
          name: block.name,
          sectors: block.sectorRows.length,
          ret: block.ret,
        })),
        excludedText: "EJEMPLO DE TRAMOS",
      });
    }
    const usedLabels = new Map<string, number>();
    const additionalTarget = (row: number, col: number): string | null => {
      for (let offset = 1; offset <= 3; offset++) {
        const ref = cellRef(row, col + offset);
        const candidate = cells.get(ref);
        if (candidate?.formula || candidate?.value.trim()) continue;
        if (!catalogMergedSecondary(ref, merged)) return ref;
      }
      return null;
    };
    const addQuestion = (
      row: number,
      rawLabel: string,
      sourceEvidence: string,
      additionalLabels: Array<{ label: string; col: number; source: string }>,
      forceQuestion = false,
    ) => {
      const cleanLabel = rawLabel.replace(/\s+/g, " ").trim();
      if (!cleanLabel || (!forceQuestion && catalogIsInstruction(cleanLabel)) || catalogIsHeader(cleanLabel)) return;
      const normalized = catalogNormalize(cleanLabel);
      const count = (usedLabels.get(normalized) ?? 0) + 1;
      usedLabels.set(normalized, count);
      const label = count === 1 ? cleanLabel : `${cleanLabel} (renglón ${row})`;
      const questionId = `${sheet.name}:question:${row}`;
      const statusTarget = `${sheet.name}!D${row}`;
      const observationTarget = `${sheet.name}!F${row}`;
      const field = makeField({
        id: questionId, sheet: sheet.name, section, subsection: "",
        key: label, label, responseType: "status", options: ["OK", "NOK", "SC", "NA"],
        required: true, applicability: "question", evidenceSlot: "none",
        target: statusTarget, sourceEvidence, role: "question",
        questionId, questionLabel: label, row, logical: true, observationTarget,
      });
      const additionalFields: TemplateField[] = [];
      const additionalTargets = new Set<string>();
      for (const additional of additionalLabels) {
        const target = additionalTarget(row, additional.col);
        if (!target || additionalTargets.has(target)) continue;
        additionalTargets.add(target);
        const additionalId = `${questionId}:additional:${target}`;
        additionalFields.push(makeField({
          id: additionalId, sheet: sheet.name, section, subsection: "",
          key: additional.label, label: additional.label, responseType:
            /CANTIDAD|N[ÚU]M|CAPACIDAD|NIVEL|VOLTAJE|AMPER|TEMP|%|KVA|VAC|VDC|LITROS/.test(catalogNormalize(additional.label))
              ? "measurement" : "text",
          options: [], required: false, applicability: "additional", evidenceSlot: "none",
          target: `${sheet.name}!${target}`, sourceEvidence: additional.source,
          role: "additional", questionId, questionLabel: label, row, logical: false,
        }));
      }
      questions.push({
        id: questionId, sheet: sheet.name, section, subsection: "", row, label,
        statusTarget: field.target, observationTarget, field, additionalFields,
      });
      catalog.push(field, ...additionalFields);
    };

    for (const [rowNumber, rowCells] of [...rows.entries()].sort(([a], [b]) => a - b)) {
      if (sheet.name === "INFRAESTRUCTURA" && rowNumber >= 44) continue;
      const a = rowCells.get("A")?.value.trim() ?? "";
      const b = rowCells.get("B")?.value.trim() ?? "";
      const c = rowCells.get("C")?.value.trim() ?? "";
      const f = rowCells.get("F")?.value.trim() ?? "";
      const g = rowCells.get("G")?.value.trim() ?? "";
      const d = rowCells.get("D")?.value.trim() ?? "";
      const hasSectionHeader = Boolean(b && (catalogNormalize(d) === "ESTADO" || catalogNormalize(f) === "OBSERVACIONES")) ||
        Boolean(a && /^\d+(?:\.\d+)+$/.test(a) && b);
      if (hasSectionHeader) {
        section = b || a || section;
        continue;
      }
      if (sheet.name === "(HW) ALARMAS DE FUERZA") {
        if (a && b && /^\d+$/.test(a)) section = b;
        // Row 8 is the table header ("POSICION / LEYENDA DE ALARMA").
        // Rows 69+ are the Ericsson reference table; it has a column named
        // "ESTATUS" but no checklist rows. In particular, row 75 must never
        // become a question just because it contains "Posición".
        const isHuaweiAlarmRow = rowNumber >= 10 && rowNumber <= 66;
        if (isHuaweiAlarmRow && c && f && g && !catalogIsInstruction(g)) {
          // The section heading is already rendered by the section selector.
          // Keeping it out of the label prevents "ALARMAS EXTERNAS
          // ADICIONALES" from being shown as a question.
          addQuestion(rowNumber, `${c} · ${g}`, `${section}; posición ${c}; alarma ${f}; ${g}`, []);
        }
        continue;
      }
      if (sheet.name === "TRANSMISION" && rowNumber >= 8 && rowNumber <= 27) {
        // Link cells and the router model are mapped explicitly above. The
        // remaining rows in this range are the original status questions.
        // Do not infer adjacent labels as duplicate additional fields.
      }
      if (sheet.name === "(HW) ALARMAS DE FUERZA" && rowNumber >= 69) {
        // The Ericsson table is mapped as standalone cells above; its header
        // and instructions are not checklist questions.
        continue;
      }
      if (sheet.name === "PLANTA HUAWEI" && !huaweiStatusRows.has(rowNumber)) {
        continue;
      }
      // This exact workbook row is a real checklist item despite beginning
      // with "Revisión", which is otherwise an instruction prefix. Keep the
      // exception scoped to its official destination so generic headings are
      // not promoted to questions.
      if (
        sheet.name === "ELECTROMECANICA" &&
        rowNumber === 32 &&
        b === "Revisión y apriete de las conexiones del cableado."
      ) {
        addQuestion(
          rowNumber,
          b,
          `ELECTROMECANICA!D32: ${b}`,
          [],
          true,
        );
        continue;
      }
      let label = "";
      if (a && b) label = b;
      else if (a && c && /^\d/.test(a) && !catalogIsInstruction(a)) label = `${a} · ${c}`;
      if (!label || catalogIsHeader(label) || catalogIsInstruction(label) || d) continue;
      if (catalogMergedSecondary(`B${rowNumber}`, merged)) continue;
      const additionalLabels = sheet.name === "TRANSMISION" || sheet.name === "ELECTROMECANICA"
        ? []
        : [...rowCells.values()]
        .filter((cell) => cell.col > 2 && cell.value.trim() && !cell.formula &&
          !catalogIsHeader(cell.value) && !catalogIsInstruction(cell.value) &&
          catalogAdditionalLabel(cell.value))
        .map((cell) => ({ label: cell.value.trim().replace(/:$/, ""), col: cell.col, source: `${cell.ref}: ${cell.value.trim()}` }));
      addQuestion(rowNumber, label, `Renglón ${rowNumber}: ${label}`, additionalLabels);
    }
  }

  const ids = new Set<string>();
  const primaryTargets = new Set<string>();
  for (const field of catalog) {
    if (ids.has(field.id)) throw new Error(`ID de catálogo duplicado: ${field.id}`);
    ids.add(field.id);
    if (!field.target || field.target.endsWith("!")) throw new Error(`Campo sin celda destino: ${field.id}`);
    if (field.role !== "additional") {
      if (primaryTargets.has(field.target)) throw new Error(`Destino de catálogo duplicado: ${field.target}`);
      primaryTargets.add(field.target);
    }
  }
  audit.push({
    type: "catalog-summary",
    presentationFields: presentationDefinitions.length,
    totalQuestions: questions.length,
    additionalFields: catalog.filter((field) => field.role === "additional").length,
    mapped: catalog.length,
    unresolved: 0,
    excludedSheets: [...excludedSheets],
  });
  return {
    catalog,
    questions,
    unmapped,
    audit,
    ready: questions.length > 0,
    schemaVersion: CATALOG_SCHEMA_VERSION,
  };
}

function parseTemplateLegacy(bytes: Buffer): TemplateCatalog {
  const { entries } = zipEntries(bytes);
  const sheets = workbookSheets(entries);
  validateWorkbookStructure(entries);
  const audit: Array<Record<string, unknown>> = [];
  const expected = new Map<string, { cols: number; rows: number }>(
    EXPECTED_SHEETS.map(([name, cols, rows]) => [name, { cols, rows }]),
  );
  const shared = entries.find((e) => e.name === "xl/sharedStrings.xml");
  const sharedStrings = shared ? textNodes(xmlData(shared), "si").map((s) => s) : [];
  const workbookValues = new Map<string, Map<string, string>>();
  for (const sheet of sheets) {
    const entry = entries.find((item) => item.name === sheet.path);
    if (!entry) continue;
    const values = new Map<string, string>();
    for (const cell of xmlData(entry).matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const head = cell[1] ?? ""; const body = cell[2] ?? "";
      const ref = attr(head, "r"); if (!ref) continue;
      const type = attr(head, "t") ?? ""; const raw = textNodes(body, "v")[0] ?? textNodes(body, "t").join("");
      values.set(ref, type === "s" ? (sharedStrings[Number(raw)] ?? "") : unescapeXml(raw));
    }
    workbookValues.set(sheet.name, values);
  }
  const validationOptions = (formula: string): string[] => {
    const range = formula.match(/^\s*=?\s*(?:'([^']+)'|([^!]+))!\$?([A-Z]+)\$?(\d+):\$?([A-Z]+)\$?(\d+)/i);
    if (!range) return (formula.match(/"([^"]+)"/)?.[1] ?? formula).split(",").map((item) => item.trim()).filter(Boolean);
    const source = workbookValues.get(range[1] ?? range[2]);
    if (!source) return [];
    const values: string[] = [];
    const startCol = colNumber(range[3]); const endCol = colNumber(range[5]);
    for (let row = Number(range[4]); row <= Number(range[6]); row++) {
      for (let col = startCol; col <= endCol; col++) {
        const value = source.get(cellRef(row, col)); if (value) values.push(value);
      }
    }
    return values;
  };
  const styles = entries.find((e) => e.name === "xl/styles.xml");
  const unlocked = new Set<number>();
  if (styles) {
    const styleXml = xmlData(styles);
    const cellXfs = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/i.exec(styleXml)?.[1] ?? "";
    const xfs = cellXfs.match(/<xf\b[^>]*?(?:\/>|>[\s\S]*?<\/xf>)/g) ?? [];
    xfs.forEach((xf, i) => { if (/<protection\b[^>]*locked="0"/i.test(xf)) unlocked.add(i); });
  }
  const catalog: TemplateField[] = [];
  const unmapped: TemplateCandidate[] = [];
  sheets.forEach((sheet, index) => {
    const dims = expected.get(sheet.name);
    if (!dims) throw new Error(`Hoja ${index + 1} inválida: ${sheet.name}`);
    const entry = entries.find((e) => e.name === sheet.path);
    if (!entry) throw new Error(`Falta el XML de la hoja ${sheet.name}`);
    const xml = xmlData(entry);
    if (sheet.name === "base") return;
    const merged = [...xml.matchAll(/<mergeCell\b[^>]*ref="([^"]+)"/gi)].map((m) => m[1]);
    const validations = [...xml.matchAll(/<dataValidation\b([^>]*)>([\s\S]*?)<\/dataValidation>/gi)]
      .map((m) => ({ ranges: (attr(m[1], "sqref") ?? "").split(/\s+/), formula: textNodes(m[2], "formula1")[0] ?? "" }));
    const cellMap = new Map<string, { xml: string; value: string; style: number; type: string }>();
    for (const m of xml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const head = m[1] ?? ""; const body = m[2] ?? "";
      const ref = attr(head, "r"); if (!ref) continue;
      const type = attr(head, "t") ?? ""; const style = Number(attr(head, "s") ?? -1);
      const raw = textNodes(body, "v")[0] ?? textNodes(body, "t").join("");
      const value = type === "s" ? (sharedStrings[Number(raw)] ?? "") : unescapeXml(raw);
      cellMap.set(ref, { xml: m[0], value, style, type });
    }
    const isMerged = (ref: string) => merged.some((range) => {
      const [a, b = a] = range.split(":"); const ar = Number(a.replace(/\D/g, "")); const br = Number(b.replace(/\D/g, ""));
      const rowNumber = Number(ref.replace(/\D/g, ""));
      return rowNumber >= ar && rowNumber <= br && colNumber(a) <= colNumber(ref) && colNumber(b) >= colNumber(ref);
    });
    for (const [ref, cell] of cellMap) {
      const validation = validations.find((v) => v.ranges.some((range) => {
        const [start, end = start] = range.split(":");
        const startRow = Number(start.replace(/\D/g, "")); const endRow = Number(end.replace(/\D/g, ""));
        return Number(ref.replace(/\D/g, "")) >= startRow && Number(ref.replace(/\D/g, "")) <= endRow
          && colNumber(start) <= colNumber(ref) && colNumber(end) >= colNumber(ref);
      }));
      const row = Number(ref.replace(/\D/g, "")); const col = colNumber(ref);
      const adjacent = [cellMap.get(cellRef(row, col - 1))?.value, cellMap.get(cellRef(row, col + 1))?.value,
        cellMap.get(cellRef(row - 1, col))?.value, cellMap.get(cellRef(row + 1, col))?.value].filter(Boolean) as string[];
      const horizontalContext = [...Array(8)].map((_, offset) => [
        col - offset - 1 > 0 ? cellMap.get(cellRef(row, col - offset - 1))?.value : undefined,
        cellMap.get(cellRef(row, col + offset + 1))?.value,
      ]).flat().find((value): value is string => Boolean(value && value.trim().length > 2)) ?? "";
      const verticalContext = [...Array(8)].map((_, offset) =>
        row - offset - 1 > 0 ? cellMap.get(cellRef(row - offset - 1, col))?.value : undefined,
      ).find((value): value is string => Boolean(value && value.trim().length > 2)) ?? "";
      const directLabel = adjacent.find((v) => v.trim().length > 2) ?? "";
      const contextualLabel = !directLabel && (validation ? (horizontalContext || verticalContext) : horizontalContext && verticalContext)
        ? validation ? (horizontalContext || verticalContext) : `${horizontalContext} / ${verticalContext}` : "";
      const label = directLabel || contextualLabel;
      const hasFormula = /<f\b/i.test(cell.xml);
      const candidate = !hasFormula && (unlocked.has(cell.style) || Boolean(validation) ||
        (cell.value.length === 0 && cell.style >= 0 && Boolean(label)));
      const evidenceContext = `${label} ${horizontalContext} ${verticalContext}`.toUpperCase();
      const rowHasContent = [...cellMap].some(([candidateRef, candidateCell]) =>
        candidateRef !== ref && Number(candidateRef.replace(/\D/g, "")) === row && Boolean(candidateCell.value.trim()));
      if (!cell.value.trim() && !validation && !directLabel && !contextualLabel && !rowHasContent) continue;
      if (!cell.value.trim() && /FOTOGRAF|OBSERVACION/.test(evidenceContext) && !isMerged(ref)) continue;
      if (!candidate || isMerged(ref)) continue;
      const listedOptions = validation ? validationOptions(validation.formula) : [];
      const combined = `${label} ${horizontalContext} ${verticalContext} ${cell.value}`.toUpperCase();
      const responseType: ResponseType = /OK\/?NOK|SC\b|N\/A|ESTADO|STATUS/.test(combined) ? "status"
        : /FECHA|DATE/.test(combined) ? "date" : /MEDI|VOLTAJE|AMPER|TEMP|PRESI|DISTANC|%/.test(combined) ? "measurement"
        : /OBSERV|COMENT|DESCRIP/.test(combined) ? "observation" : /NÚM|NUM|CANT|VALOR/.test(combined) ? "number"
        : listedOptions.length ? "selection" : "text";
      const options = responseType === "status" ? ["OK", "NOK", "SC", "NA"] : listedOptions;
      const evidenceSlot: TemplateField["evidenceSlot"] = /FOTO|FOTOGRAF|IMAGEN|EVIDENCIA/.test(combined)
        ? "photo" : responseType === "observation" ? "observation" : "none";
      const id = `${sheet.name}:${ref}`;
      const confidence = label ? 0.82 : 0.28;
      if (!label || evidenceSlot === "photo") {
        unmapped.push({ target: `${sheet.name}!${ref}`, sheet: sheet.name, reason: !label ? "Celda editable sin etiqueta adyacente" : "Slot de evidencia requiere mapeo explícito", confidence, state: "unresolved", ignoreReason: null });
        audit.push({ type: "unmapped-candidate", target: `${sheet.name}!${ref}`, evidence: "editable style or validation" });
      } else {
        catalog.push({ id, sheet: sheet.name, subsection: "", key: label, label, responseType, options, required: false,
          applicability: validation ? "validated" : "general", evidenceSlot, target: `${sheet.name}!${ref}`,
          sourceEvidence: `Etiqueta adyacente: ${label}${validation ? `; validación: ${validation.formula}` : ""}`, confidence,
          state: "mapped", ignoreReason: null });
      }
    }
    if (sheet.name !== "REPORTE FOTOGRAFICO") {
      for (const [ref, cell] of cellMap) {
        if (!/FOTOGRAF|IMAGEN|EVIDENCIA/i.test(cell.value.trim())) continue;
        const row = Number(ref.replace(/\D/g, "")); const col = colNumber(ref);
        const targetRef = cellMap.has(cellRef(row, col - 1)) ? cellRef(row, col - 1) : ref;
        const id = `${sheet.name}:photo:${ref}`;
        if (catalog.some((field) => field.id === id)) continue;
        catalog.push({
          id, sheet: sheet.name, subsection: "", key: cell.value.trim(), label: cell.value.trim(),
          responseType: "text", options: [], required: false, applicability: "evidence.photo",
          evidenceSlot: "photo", target: `${sheet.name}!${targetRef}`,
          sourceEvidence: `Etiqueta explícita de fotografía en ${sheet.name}!${ref}`,
          confidence: 0.99, state: "mapped", ignoreReason: null,
        });
      }
    }
    if (sheet.name === "REPORTE FOTOGRAFICO") {
      const mergedTarget = (ref: string): string => {
        const [column] = ref.match(/[A-Z]+/i) ?? [ref];
        const row = Number(ref.replace(/\D/g, ""));
        const following = merged
          .map((range) => ({ range, start: range.split(":")[0] }))
          .filter(({ start }) => start.match(/[A-Z]+/i)?.[0].toUpperCase() === column.toUpperCase() &&
            Number(start.replace(/\D/g, "")) > row)
          .sort((a, b) => Number(a.start.replace(/\D/g, "")) - Number(b.start.replace(/\D/g, "")))[0];
        return following?.range ??
          merged.find((range) => range.split(":")[0].toUpperCase() === ref.toUpperCase()) ?? ref;
      };
      for (const [ref, cell] of cellMap) {
        const normalized = cell.value.trim().toUpperCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
        const isPhotoLabel = /^FOTOGRAFIA\s+\d+/.test(normalized);
        const isObservationLabel = normalized === "OBSERVACIONES:";
        if (!isPhotoLabel && !isObservationLabel) continue;
        const targetRef = mergedTarget(ref);
        const id = `${sheet.name}:${ref}`;
        if (catalog.some((field) => field.id === id)) continue;
        const evidenceSlot: TemplateField["evidenceSlot"] = isPhotoLabel ? "photo" : "observation";
        const responseType: ResponseType = isPhotoLabel ? "text" : "observation";
        catalog.push({
          id, sheet: sheet.name, subsection: `página ${Math.floor((Number(ref.replace(/\D/g, "")) - 1) / 52) + 1}`,
          key: cell.value.trim(), label: cell.value.trim(), responseType, options: [], required: false,
          applicability: isPhotoLabel ? "evidence.photo" : "evidence.observation",
          evidenceSlot, target: `${sheet.name}!${targetRef}`,
          sourceEvidence: `Etiqueta explícita de plantilla en ${sheet.name}!${ref}; rango ${targetRef}`,
          confidence: 0.99, state: "mapped", ignoreReason: null,
        });
      }
    }
    if (sheet.name === "REPORTE FOTOGRAFICO" && !catalog.some((field) => field.sheet === sheet.name && field.evidenceSlot === "photo") &&
      !unmapped.some((candidate) => candidate.sheet === sheet.name && /evidencia|slot/i.test(candidate.reason))) {
      const target = `${sheet.name}!__evidence__`;
      unmapped.push({ target, sheet: sheet.name, reason: "No se detectaron slots de evidencia fotográfica; requiere mapeo explícito", confidence: 0, state: "unresolved", ignoreReason: null });
      audit.push({ type: "evidence-slot-blocker", sheet: sheet.name, target });
    }
    if (sheet.name !== "base" && !catalog.some((field) => field.sheet === sheet.name) &&
      !unmapped.some((candidate) => candidate.sheet === sheet.name)) {
      const target = `${sheet.name}!__sheet__`;
      unmapped.push({ target, sheet: sheet.name, reason: "No se detectaron campos editables; requiere revisión manual", confidence: 0, state: "unresolved", ignoreReason: null });
      audit.push({ type: "sheet-blocker", sheet: sheet.name, target });
    }
  });
  const technicalSheets = EXPECTED_SHEETS.filter(([name]) => name !== "base").map(([name]) => name);
  const fieldsBySheet = new Set(catalog.map((field) => field.sheet));
  const completeCatalog = catalog.length > 0 && technicalSheets.every((sheet) => fieldsBySheet.has(sheet));
  audit.push({ type: "catalog-summary", totalCandidates: catalog.length + unmapped.length, mapped: catalog.length, unresolved: unmapped.length });
  return { catalog, unmapped, audit, ready: unmapped.length === 0 && completeCatalog };
}

function replaceCellValue(xml: string, ref: string, value: unknown): string {
  const escaped = escapeXml(String(value ?? ""));
  const pattern = new RegExp(`(<c\\b(?![^>]*\\/\\s*>)[^>]*\\br="${ref}"[^>]*>)([\\s\\S]*?)(</c>)`, "i");
  const replaced = xml.replace(pattern, (_, open: string, body: string, close: string) => {
    const cleaned = body.replace(/<v>[\s\S]*?<\/v>/i, "").replace(/<is>[\s\S]*?<\/is>/i, "");
    const isString = typeof value !== "number" && typeof value !== "bigint";
    const normalizedOpen = isString
      ? (/\bt="/i.test(open) ? open.replace(/\bt="[^"]*"/i, 't="inlineStr"') : open.replace(/>$/, ' t="inlineStr">'))
      : open.replace(/\s+t="[^"]*"/i, "");
    const valueXml = isString ? `<is><t>${escaped}</t></is>` : `<v>${escaped}</v>`;
    return `${normalizedOpen}${cleaned}${valueXml}${close}`;
  });
  if (replaced !== xml) return replaced;
  const selfClosing = new RegExp(`<c\\b([^>]*\\br="${ref}"[^>]*)\\s*/>`, "i");
  return xml.replace(selfClosing, (_, attributes: string) => {
    const isString = typeof value !== "number" && typeof value !== "bigint";
    const normalizedAttributes = isString
      ? (/\bt="/i.test(attributes) ? attributes.replace(/\bt="[^"]*"/i, 't="inlineStr"') : `${attributes} t="inlineStr"`)
      : attributes.replace(/\s+t="[^"]*"/i, "");
    const valueXml = isString ? `<is><t>${escaped}</t></is>` : `<v>${escaped}</v>`;
    return `<c${normalizedAttributes}>${valueXml}</c>`;
  });
}

function addBlankPhotoSlot(xml: string, row: number, label: string): string {
  const ref = `A${row}`;
  const withExistingCell = replaceCellValue(xml, ref, label);
  if (withExistingCell !== xml) return withExistingCell;

  const cell = `<c r="${ref}" t="inlineStr"><is><t>${escapeXml(label)}</t></is></c>`;
  const rowPattern = new RegExp(`<row\\b([^>]*\\br="${row}"[^>]*)(?:/>|>([\\s\\S]*?)</row\\s*>)`, "i");
  const existingRow = rowPattern.exec(xml);
  if (existingRow) {
    const rowXml = existingRow[0].endsWith("/>")
      ? existingRow[0].replace(/\/>$/, `>${cell}</row>`)
      : existingRow[0].replace(/<\/row\s*>$/i, `${cell}</row>`);
    return xml.replace(existingRow[0], rowXml);
  }

  const sheetDataClose = xml.indexOf("</sheetData>");
  if (sheetDataClose < 0) throw new Error("REPORTE FOTOGRAFICO carece de sheetData");
  return `${xml.slice(0, sheetDataClose)}<row r="${row}">${cell}</row>${xml.slice(sheetDataClose)}`;
}

/**
 * Creates the shareable workbook template without applying a visit snapshot.
 * The source workbook remains the source of truth; only the 16 empty photo
 * spaces are numbered in the exported copy.
 */
export function prepareBlankTemplate(bytes: Buffer): {
  bytes: Buffer;
  verification: TemplateVerification;
  photoSlots: string[];
} {
  const parsed = zipEntries(bytes);
  const sheets = validateWorkbookStructure(parsed.entries);
  const photoSheet = workbookSheets(parsed.entries).find((sheet) => sheet.name === "REPORTE FOTOGRAFICO");
  if (!photoSheet) throw new Error("Falta REPORTE FOTOGRAFICO");
  const worksheet = parsed.entries.find((entry) => entry.name === photoSheet.path);
  if (!worksheet) throw new Error("Falta XML de REPORTE FOTOGRAFICO");

  let xml = xmlData(worksheet);
  const photoSlots = Array.from({ length: PHOTO_SLOT_COUNT }, (_, index) => {
    const row = PHOTO_SLOT_START_ROW + index;
    xml = addBlankPhotoSlot(xml, row, `ESPACIO ${index + 1}`);
    return `REPORTE FOTOGRAFICO!A${row}`;
  });
  updateEntryData(worksheet, Buffer.from(xml));
  const output = zipXml(parsed.entries, parsed.comment);
  const verification: TemplateVerification = {
    valid: photoSlots.every((target, index) => {
      const row = PHOTO_SLOT_START_ROW + index;
      return new RegExp(`<c\\b[^>]*\\br="A${row}"[^>]*>[\\s\\S]*?ESPACIO ${index + 1}[\\s\\S]*?</c>`, "i").test(xml);
    }),
    sheets,
    writtenTargets: photoSlots,
    details: [
      "Diez hojas y dimensiones verificadas",
      `${PHOTO_SLOT_COUNT} espacios fotográficos vacíos reservados y numerados`,
    ],
  };
  if (!verification.valid) throw new Error("No se pudieron reservar los espacios fotográficos de la plantilla");
  return { bytes: output, verification, photoSlots };
}
function topLeftRef(ref: string): string {
  return ref.split(":")[0].trim();
}
function findValue(snapshot: unknown, field: TemplateField): unknown {
  if (!snapshot || typeof snapshot !== "object") return undefined;
  const record = snapshot as Record<string, unknown>;
  const responses = record.responses;
  if (responses && typeof responses === "object" && Object.prototype.hasOwnProperty.call(responses, field.id)) {
    return (responses as Record<string, unknown>)[field.id];
  }
  // HOJA DE SEG is supported only through an explicit normalized mapping,
  // never by guessing from labels. Example applicability:
  // finding.description, finding.priority, or finding.description:F123.
  if (field.sheet === "HOJA DE SEG" && field.applicability.startsWith("finding.")) {
    const [, propertyAndId] = field.applicability.split("finding.");
    const [property, findingId] = propertyAndId.split(":");
    const findings = [
      ...(Array.isArray(record.findings) ? record.findings : []),
      ...(Array.isArray(record.sections) ? record.sections.flatMap((section) =>
        section && typeof section === "object" && Array.isArray((section as Record<string, unknown>).points)
          ? ((section as Record<string, unknown>).points as unknown[]).flatMap((point) =>
            point && typeof point === "object" && Array.isArray((point as Record<string, unknown>).findings)
              ? (point as Record<string, unknown>).findings as unknown[] : [])
          : []) : []),
    ];
    const finding = findings.find((item) =>
      item && typeof item === "object" && (!findingId || (item as Record<string, unknown>).id === findingId),
    ) as Record<string, unknown> | undefined;
    return finding?.[property];
  }
  return undefined;
}

function snapshotFindings(snapshot: unknown): Array<Record<string, unknown>> {
  if (!snapshot || typeof snapshot !== "object") return [];
  const record = snapshot as Record<string, unknown>;
  const direct = Array.isArray(record.findings) ? record.findings : [];
  const nested = Array.isArray(record.sections)
    ? record.sections.flatMap((section) =>
      section && typeof section === "object" && Array.isArray((section as Record<string, unknown>).points)
        ? ((section as Record<string, unknown>).points as unknown[]).flatMap((point) =>
          point && typeof point === "object" && Array.isArray((point as Record<string, unknown>).findings)
            ? (point as Record<string, unknown>).findings as unknown[] : [])
        : [])
    : [];
  return [...direct, ...nested].filter(
    (finding): finding is Record<string, unknown> => Boolean(finding && typeof finding === "object"),
  );
}

function findingContext(snapshot: unknown, finding: Record<string, unknown>): {
  sheet: string;
  point: string;
} {
  if (!snapshot || typeof snapshot !== "object") return { sheet: "", point: String(finding.pointId ?? "") };
  const sections = Array.isArray((snapshot as Record<string, unknown>).sections)
    ? (snapshot as Record<string, unknown>).sections as unknown[] : [];
  for (const section of sections) {
    if (!section || typeof section !== "object") continue;
    const sectionRecord = section as Record<string, unknown>;
    const points = Array.isArray(sectionRecord.points) ? sectionRecord.points : [];
    if (String(sectionRecord.id ?? "") !== String(finding.sectionId ?? "")) continue;
    const point = points.find((candidate) =>
      candidate && typeof candidate === "object" &&
      String((candidate as Record<string, unknown>).id ?? "") === String(finding.pointId ?? ""),
    );
    return {
      sheet: String(sectionRecord.name ?? sectionRecord.title ?? ""),
      point: point && typeof point === "object"
        ? String((point as Record<string, unknown>).title ?? finding.pointId ?? "")
        : String(finding.pointId ?? ""),
    };
  }
  return { sheet: "", point: String(finding.pointId ?? "") };
}

export function patchTemplate(bytes: Buffer, snapshot: unknown, catalog: TemplateField[]): {
  bytes: Buffer; writtenTargets: string[]; capturedValues: Record<string, string>;
} {
  const parsed = zipEntries(bytes);
  const writtenTargets: string[] = [];
  const capturedValues: Record<string, string> = {};
  const writeTarget = (target: string, value: unknown): void => {
    const [sheet, rawRef] = target.split("!");
    const ref = topLeftRef(rawRef);
    const sheetPath = workbookSheets(parsed.entries).find((s) => s.name === sheet)?.path;
    const entry = parsed.entries.find((e) => e.name === sheetPath);
    if (!entry) throw new Error(`No se encontró ${target}`);
    const before = xmlData(entry);
    const patched = replaceCellValue(before, ref, value);
    if (patched === before) throw new Error(`No se pudo escribir ${target}`);
    updateEntryData(entry, Buffer.from(patched));
    writtenTargets.push(target);
    capturedValues[target] = String(value ?? "");
  };
  for (const field of catalog.filter((f) => f.state === "mapped" && !f.target.endsWith("!__evidence__"))) {
    const value = findValue(snapshot, field);
    if (value === undefined || value === null || value === "") continue;
    const writeValue = (field.responseType === "number" || field.responseType === "measurement") &&
      typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))
      ? Number(value) : value;
    writeTarget(field.target, writeValue);
  }

  // These two output sheets are fixed parts of the owner workbook and are
  // intentionally excluded from the questionnaire catalog. They are filled
  // from the same stable finding identity used by the mobile draft.
  const findings = snapshotFindings(snapshot);
  findings.slice(0, 36).forEach((finding, index) => {
    const context = findingContext(snapshot, finding);
    const row = index + 7;
    writeTarget(`HOJA DE SEG!B${row}`, context.sheet);
    writeTarget(`HOJA DE SEG!C${row}`, context.point);
    writeTarget(`HOJA DE SEG!D${row}`, finding.responsible ?? "");
    writeTarget(`HOJA DE SEG!E${row}`, finding.description ?? "");
    writeTarget(`HOJA DE SEG!F${row}`, finding.startDate ?? "");
    writeTarget(`HOJA DE SEG!G${row}`, finding.completedDate ?? "");
  });

  const reportObservationRefs = [
    "A30", "H30", "A53", "H53", "A80", "H80", "A105", "H105",
    "A132", "H132", "A157", "H157", "A184", "H184", "A209", "H209",
  ];
  const reportPhotos = findings.flatMap((finding) => {
    const context = findingContext(snapshot, finding);
    return (Array.isArray(finding.photos) ? finding.photos : []).map(() =>
      `${context.sheet} · ${context.point}: ${String(finding.description ?? "")}`,
    );
  });
  reportPhotos.slice(0, reportObservationRefs.length).forEach((description, index) => {
    writeTarget(`REPORTE FOTOGRAFICO!${reportObservationRefs[index]}`, description);
  });
  return { bytes: zipXml(parsed.entries, parsed.comment), writtenTargets, capturedValues };
}

// Small table-free CRC32 implementation for ZIP headers.
function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function readTargetValue(bytes: Buffer, target: string): string | undefined {
  const parsed = zipEntries(bytes);
  const [sheet, rawRef] = target.split("!");
  const ref = topLeftRef(rawRef);
  const path = workbookSheets(parsed.entries).find((item) => item.name === sheet)?.path;
  const entry = parsed.entries.find((item) => item.name === path);
  if (!entry) return undefined;
  const match = new RegExp(`<c\\b([^>]*\\br="${ref}"[^>]*?)(?:\\/>|>([\\s\\S]*?)</c>)`, "i").exec(xmlData(entry));
  if (!match) return undefined;
  const head = match[1] ?? "";
  const body = match[2] ?? "";
  const type = attr(head, "t");
  const raw = textNodes(body, type === "inlineStr" ? "t" : "v")[0] ?? "";
  if (type === "s") {
    const shared = parsed.entries.find((item) => item.name === "xl/sharedStrings.xml");
    return shared ? textNodes(xmlData(shared), "si")[Number(raw)] : undefined;
  }
  return unescapeXml(raw);
}

export function verifyTemplate(
  bytes: Buffer,
  catalog: TemplateField[],
  writtenTargets: string[],
  capturedValues: Record<string, string> = {},
  evidencePages = 1,
): TemplateVerification {
  try {
    const entries = zipEntries(bytes).entries;
    const sheets = validateWorkbookStructure(entries, evidencePages);
    const details: string[] = ["Diez hojas y dimensiones verificadas"];
    const mismatches: string[] = [];
    for (const target of Object.keys(capturedValues)) {
      if (!writtenTargets.includes(target)) mismatches.push(`${target} (capturado pero no escrito)`);
    }
    for (const target of writtenTargets) {
      const actual = readTargetValue(bytes, target);
      if (actual === undefined || actual !== capturedValues[target]) mismatches.push(`${target} (esperado ${capturedValues[target] ?? "capturado"}, obtenido ${actual ?? "ausente"})`);
    }
    if (mismatches.length) details.push(`Targets capturados no coinciden: ${mismatches.join(", ")}`);
    // Optional catalog fields may legitimately have no response in a visit.
    // Verification is limited to values actually captured and written.
    void catalog;
    return { valid: mismatches.length === 0, sheets, writtenTargets, details };
  } catch (error) {
    return { valid: false, sheets: [], writtenTargets, details: [error instanceof Error ? error.message : String(error)] };
  }
}

export async function convertXlsxToPdf(xlsx: Buffer): Promise<Buffer> {
  const fs = await import("node:fs/promises");
  const os = await import("node:os");
  const path = await import("node:path");
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "template-"));
  const input = path.join(dir, "filled.xlsx");
  await fs.writeFile(input, xlsx);
  try {
    await execFileAsync("soffice", ["--headless", "--convert-to", "pdf", "--outdir", dir, input], { timeout: 120_000 });
    return await fs.readFile(path.join(dir, "filled.pdf"));
  } catch {
    throw new Error("La conversión PDF requiere LibreOffice/soffice instalado y disponible");
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}