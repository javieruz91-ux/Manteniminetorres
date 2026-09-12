import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { deflateRawSync } from "node:zlib";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "xlsx-template-test-"));
const bundle = join(dir, "xlsxTemplate.mjs");
execFileSync("pnpm", ["exec", "esbuild", "src/lib/xlsxTemplate.ts", "--bundle", "--platform=node", "--format=esm", `--outfile=${bundle}`], {
  cwd: new URL("..", import.meta.url).pathname,
  stdio: "inherit",
});
const { EXPECTED_SHEETS, embedEvidence, parseTemplate, patchTemplate, verifyTemplate } = await import(bundle);

// This is the recovered structural export of the official workbook contract.
// Keep it explicit so a future change cannot silently alter sheet names/order
// while the original binary is still unavailable in the workspace.
assert.deepEqual(EXPECTED_SHEETS, [
  ["PRESENTACION", 8, 24],
  ["(HW) ALARMAS DE FUERZA", 10, 81],
  ["PLANTA HUAWEI", 20, 70],
  ["INFRAESTRUCTURA", 13, 278],
  ["ELECTROMECANICA", 13, 141],
  ["TIERRAS", 12, 80],
  ["TRANSMISION", 11, 32],
  ["HOJA DE SEG", 8, 42],
  ["REPORTE FOTOGRAFICO", 13, 211],
  ["base", 1, 1],
]);

function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function u16(value) { const b = Buffer.alloc(2); b.writeUInt16LE(value); return b; }
function u32(value) { const b = Buffer.alloc(4); b.writeUInt32LE(value); return b; }

// Deliberately emits bit 3 + a data descriptor for every entry. This catches
// the common bug where local and central ZIP headers disagree after patching.
function zip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, data] of entries) {
    const nameBytes = Buffer.from(name);
    const compressed = deflateRawSync(Buffer.from(data));
    const crc = crc32(Buffer.from(data));
    const local = Buffer.concat([
      u32(0x04034b50), u16(20), u16(8), u16(8), u16(0), u16(0),
      u32(0), u32(0), u32(0), u16(nameBytes.length), u16(0), nameBytes,
      compressed, u32(0x08074b50), u32(crc), u32(compressed.length), u32(data.length),
    ]);
    const central = Buffer.concat([
      u32(0x02014b50), u16(20), u16(20), u16(8), u16(8), u16(0), u16(0),
      u32(crc), u32(compressed.length), u32(data.length), u16(nameBytes.length),
      u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), nameBytes,
    ]);
    locals.push(local); centrals.push(central); offset += local.length;
  }
  const central = Buffer.concat(centrals);
  return Buffer.concat([...locals, central, u32(0x06054b50), u16(0), u16(0),
    u16(entries.length), u16(entries.length), u32(central.length), u32(offset), u16(0)]);
}

function inline(ref, text) {
  return `<c r="${ref}" t="inlineStr"><is><t>${text}</t></is></c>`;
}
function sheetXml(cols, rows, report = false) {
  const label = report ? "Descripción" : "Estado";
  const dimension = cols === "A" && rows === 1 ? "A1" : `A1:${cols}${rows}`;
  const tailRows = report && rows === 211 ? Array.from({ length: 209 }, (_, index) => `<row r="${index + 3}"/>`).join("") : "";
  const merge = report ? `<mergeCells count="1"><mergeCell ref="A1:M2"/></mergeCells>` : "";
  return `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="${dimension}"/><sheetData><row r="1">${inline("A1", label)}<c r="B1" s="1"/><c r="C1" s="1"/><c r="D1" s="1"><f>1+1</f><v>2</v></c></row><row r="2">${inline("A2", "Cantidad")}<c r="B2" s="1"/></row>${tailRows}</sheetData>${merge}</worksheet>`;
}

const sheetEntries = EXPECTED_SHEETS.map(([name, cols, rows], i) =>
  [`xl/worksheets/sheet${i + 1}.xml`, sheetXml(String.fromCharCode(64 + cols), rows, name === "REPORTE FOTOGRAFICO")]);
const workbook = `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${EXPECTED_SHEETS.map(([name], i) => `<sheet name="${name}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`;
const rels = `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${EXPECTED_SHEETS.map((_, i) => `<Relationship Id="rId${i + 1}" Type="worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}</Relationships>`;
const styles = `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/><xf numFmtId="0" fontId="0" fillId="0" borderId="0"><protection locked="0"/></xf></cellXfs></styleSheet>`;
const source = zip([
  ["xl/workbook.xml", workbook],
  ["xl/_rels/workbook.xml.rels", rels],
  ["xl/styles.xml", styles],
  ...sheetEntries,
]);

const catalog = parseTemplate(source);
assert.equal(catalog.catalog.length > 0, true);
assert.equal(catalog.ready, false, "photo evidence and formula/blocker candidates must prevent readiness");
for (const [name] of EXPECTED_SHEETS.slice(0, -1)) {
  assert.equal(catalog.catalog.some((field) => field.sheet === name) || catalog.unmapped.some((field) => field.sheet === name), true, name);
}
assert.equal(catalog.unmapped.some((candidate) => candidate.sheet === "REPORTE FOTOGRAFICO"), true);
assert.equal(catalog.audit.at(-1).totalCandidates, catalog.catalog.length + catalog.unmapped.length);

const fields = catalog.catalog.filter((field) => field.sheet === "PRESENTACION");
assert.equal(fields.length >= 1, true);
const snapshot = { responses: Object.fromEntries(fields.slice(0, 2).map((field, index) => [field.id, index ? 42 : "texto"])) };
const patched = patchTemplate(source, snapshot, fields.map((field) => ({ ...field, state: "mapped" })));
const verification = verifyTemplate(patched.bytes, fields, patched.writtenTargets, patched.capturedValues);
assert.equal(verification.valid, true);
assert.deepEqual(patched.writtenTargets.sort(), fields.slice(0, 2).map((field) => field.target).sort());
const patchedZip = join(dir, "patched.xlsx");
writeFileSync(patchedZip, patched.bytes);
assert.equal(execFileSync("unzip", ["-p", patchedZip, "xl/worksheets/sheet1.xml"], { encoding: "utf8" }).includes("<f>1+1</f>"), true);

// Responses are exact-id based; a coincidental label must not win. Ranges
// preserve their identity while writing the top-left cell.
const rangeField = { ...fields[0], id: "range-field", target: "PRESENTACION!B1:C1", state: "mapped" };
const rangePatch = patchTemplate(source, { Estado: "wrong", responses: { "range-field": "exact" } }, [rangeField]);
assert.equal(verifyTemplate(rangePatch.bytes, [rangeField], rangePatch.writtenTargets, rangePatch.capturedValues).valid, true);
assert.equal(verifyTemplate(rangePatch.bytes, [rangeField], [], { [rangeField.target]: "exact" }).valid, false);

const photoField = {
  id: "photo-slot", sheet: "REPORTE FOTOGRAFICO", subsection: "Fotos", key: "photo-slot",
  label: "Foto", responseType: "observation", options: [], required: false, applicability: "",
  evidenceSlot: "photo", target: "REPORTE FOTOGRAFICO!B2:C6", sourceEvidence: "Foto",
  confidence: 1, state: "mapped",
};
const png = Buffer.from("89504e470d0a1a0a", "hex");
const embedded = embedEvidence(source, [{ id: "photo-1", bytes: png, contentType: "image/png" }], [photoField]);
assert.equal(embedded.valid, true);
assert.deepEqual(embedded.consumedPhotoIds, ["photo-1"]);
const embeddedZip = join(dir, "embedded.xlsx");
writeFileSync(embeddedZip, embedded.bytes);
assert.equal(execFileSync("unzip", ["-l", embeddedZip], { encoding: "utf8" }).includes("xl/media/template-"), true);
assert.equal(execFileSync("unzip", ["-p", embeddedZip, "\\[Content_Types\\].xml"], { encoding: "utf8" }).includes("PartName=\"/xl/drawings/drawing1.xml\""), true);
const drawingXml = execFileSync("unzip", ["-p", embeddedZip, "xl/drawings/drawing1.xml"], { encoding: "utf8" });
assert.equal(drawingXml.includes("twoCellAnchor"), true);
assert.equal(execFileSync("unzip", ["-p", embeddedZip, "xl/drawings/_rels/drawing1.xml.rels"], { encoding: "utf8" }).includes("image"), true);

const overflowSource = zip([
  ["xl/workbook.xml", workbook],
  ["xl/_rels/workbook.xml.rels", rels],
  ["xl/styles.xml", styles],
  ...EXPECTED_SHEETS.map(([name, cols, rows], i) =>
    [`xl/worksheets/sheet${i + 1}.xml`, sheetXml(String.fromCharCode(64 + cols), name === "REPORTE FOTOGRAFICO" ? 211 : rows, name === "REPORTE FOTOGRAFICO")]),
]);
const overflow = embedEvidence(overflowSource, [
  { id: "photo-1", bytes: png, contentType: "image/png" },
  { id: "photo-2", bytes: png, contentType: "image/png" },
], [photoField]);
assert.equal(overflow.valid, true);
const overflowZip = join(dir, "overflow.xlsx");
writeFileSync(overflowZip, overflow.bytes);
const overflowSheet = execFileSync("unzip", ["-p", overflowZip, "xl/worksheets/sheet9.xml"], { encoding: "utf8" });
assert.equal(overflowSheet.includes('ref="A1:M422"'), true);
assert.equal(overflowSheet.includes('<row r="212"'), true);
assert.equal(overflowSheet.includes('ref="A212:M213"'), true);
assert.equal((execFileSync("unzip", ["-l", overflowZip], { encoding: "utf8" }).match(/xl\/worksheets\/sheet\d+\.xml/g) || []).length, 10);
assert.equal(verifyTemplate(overflow.bytes, [], [], {}, 2).valid, true);
try {
  execFileSync("soffice", ["--headless", "--convert-to", "pdf", "--outdir", dir, overflowZip], { stdio: "ignore" });
  assert.equal(true, true, "LibreOffice opened the overflow workbook");
} catch (error) {
  if (error?.status !== 127) throw error;
}

rmSync(dir, { recursive: true, force: true });
console.log("xlsxTemplate parser/patch tests passed");