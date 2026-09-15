import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { deflateRawSync } from "node:zlib";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = mkdtempSync(join(tmpdir(), "xlsx-template-test-"));
const bundle = join(dir, "xlsxTemplate.mjs");
execFileSync("pnpm", ["exec", "esbuild", "src/lib/xlsxTemplate.ts", "--bundle", "--platform=node", "--format=esm", `--outfile=${bundle}`], {
  cwd: new URL("..", import.meta.url).pathname,
  stdio: "inherit",
});
const {
  EXPECTED_SHEETS,
  PHOTO_SLOT_COUNT,
  embedEvidence,
  parseTemplate,
  resolveLocalSeparators,
  patchTemplate,
  prepareBlankTemplate,
  verifyTemplate,
} = await import(bundle);

const officialWorkbook = fileURLToPath(new URL("../../../attached_assets/Mantenimiento_Preventivo_a_Sitios_Celulares_REV2_(1)_1789252951099.xlsx", import.meta.url));
const officialFixture = readFileSync(officialWorkbook);
const officialCatalog = parseTemplate(officialFixture);
assert.equal(officialCatalog.ready, true);
assert.deepEqual(
  officialCatalog.catalog.filter((field) => field.sheet === "PRESENTACION").map((field) => field.label),
  ["mnemónico", "mnemónicos del sitio", "nombre del sitio", "tipo de radiobase",
    "región", "central", "dirección", "fecha", "ingeniero", "número de tarea"],
);
assert.equal(officialCatalog.catalog.filter((field) => field.sheet === "PRESENTACION").length, 10);
assert.equal(new Set(officialCatalog.catalog.filter((field) => field.sheet === "PRESENTACION").map((field) => field.target)).size, 10);
assert.equal(officialCatalog.catalog.some((field) => field.defaultValue === "46273"), false);
assert.equal(officialCatalog.catalog.some((field) => field.label.includes("46273")), false);
assert.equal(officialCatalog.catalog.some((field) => field.sheet === "HOJA DE SEG"), false);
assert.equal(officialCatalog.catalog.some((field) => field.sheet === "REPORTE FOTOGRAFICO"), false);
assert.equal(officialCatalog.catalog.some((field) => field.sheet === "base"), false);
assert.deepEqual(
  [...new Set(officialCatalog.questions.map((question) => question.sheet))],
  ["(HW) ALARMAS DE FUERZA", "PLANTA HUAWEI", "INFRAESTRUCTURA",
    "ELECTROMECANICA", "TIERRAS", "TRANSMISION"],
);
assert.equal(new Set(officialCatalog.catalog.map((field) => field.id)).size, officialCatalog.catalog.length);
assert.equal(new Set(officialCatalog.questions.map((question) => question.label)).size, officialCatalog.questions.length);
assert.equal(officialCatalog.catalog.some((field) => /^(ESTADO|ESTATUS|OBSERVACIONES)$/i.test(field.label)), false);
assert.ok(officialCatalog.questions.every((question) => question.field.responseType === "status"));
assert.ok(officialCatalog.catalog.some((field) => field.role === "additional"));
assert.ok(officialCatalog.audit.some((event) => event.type === "presentation-summary" && event.expectedFields === 10));
assert.ok(officialCatalog.audit.some((event) => event.type === "sheet-excluded" && event.sheet === "HOJA DE SEG"));

// The Alarmas de Fuerza headers are reference text, not checklist questions.
const forceAlarmQuestions = officialCatalog.questions.filter(
  (question) => question.sheet === "(HW) ALARMAS DE FUERZA",
);
const forceAlarmFields = officialCatalog.catalog.filter(
  (field) => field.sheet === "(HW) ALARMAS DE FUERZA",
);
assert.equal(forceAlarmQuestions.length, 55);
assert.equal(forceAlarmFields.filter((field) => field.role === "standalone").length, 60);
assert.deepEqual(
  forceAlarmFields.filter((field) => field.role === "standalone").map((field) => field.target),
  Array.from({ length: 6 }, (_, rowIndex) =>
    [..."ABCDEFGHIJ"].map((column) => `(HW) ALARMAS DE FUERZA!${column}${76 + rowIndex}`),
  ).flat(),
);
assert.equal(forceAlarmQuestions.some((question) => question.row === 8 || question.row === 75), false);
assert.equal(
  officialCatalog.catalog.some(
    (field) => field.sheet === "(HW) ALARMAS DE FUERZA" &&
      (field.target.endsWith("!D8") || field.target.endsWith("!D75")),
  ),
  false,
);
assert.equal(
  forceAlarmQuestions.some((question) => /POSICI[ÓO]N|LEYENDA DE ALARMA|ALARMAS EXTERNAS ADICIONALES/i.test(question.label)),
  false,
);
assert.equal(
  forceAlarmFields.some((field) => field.label === "Elemento monitoreado" || field.label === "ESTATUS"),
  false,
);

const transmissionFields = officialCatalog.catalog.filter(
  (field) => field.sheet === "TRANSMISION",
);
const transmissionQuestions = officialCatalog.questions.filter(
  (question) => question.sheet === "TRANSMISION",
);
assert.equal(transmissionQuestions.length, 13);
assert.deepEqual(
  transmissionFields.filter((field) => field.role === "standalone").map((field) => field.target),
  [
    "TRANSMISION!G8", "TRANSMISION!F9", "TRANSMISION!G9",
    "TRANSMISION!H9", "TRANSMISION!I9", "TRANSMISION!J9",
    "TRANSMISION!G10", "TRANSMISION!F11", "TRANSMISION!G11",
    "TRANSMISION!H11", "TRANSMISION!I11", "TRANSMISION!J11",
    "TRANSMISION!C14",
  ],
);
assert.equal(
  transmissionFields.some((field) => field.target === "TRANSMISION!D8" && field.role === "question"),
  true,
);
assert.equal(
  transmissionFields.some((field) => field.target === "TRANSMISION!D14" && field.role === "question"),
  true,
);
assert.equal(
  transmissionFields.some((field) => field.target === "TRANSMISION!F8" && field.role === "additional"),
  false,
);

const electromechanicalQuestions = officialCatalog.questions.filter(
  (question) => question.sheet === "ELECTROMECANICA",
);
const electromechanicalFields = officialCatalog.catalog.filter(
  (field) => field.sheet === "ELECTROMECANICA",
);
const electromechanicalTargets = [
  "G9", "I9", "G10", "J10", "G11", "G12", "G13", "J13", "G14",
  "G15", "I15", "G16", "I16", "G17",
  "G18", "J18", "G19", "J19", "G20", "G21", "J21", "G22", "J22",
  "G37", "G38", "G39", "G40", "G44", "J45",
  "F51", "I51", "G52", "G53", "G54", "G56", "G57", "G58", "G59",
  "G63", "G64", "G65", "G66", "G67",
  "C70", "C71", "G70", "G71", "G75", "G76",
  "G81", "F82", "F83", "G87", "G129",
].map((target) => `ELECTROMECANICA!${target}`);
assert.equal(electromechanicalQuestions.length, 101);
assert.equal(
  electromechanicalFields.filter((field) => field.role === "standalone").length,
  electromechanicalTargets.length,
);
assert.deepEqual(
  electromechanicalFields.filter((field) => field.role === "standalone").map((field) => field.target),
  electromechanicalTargets,
);
assert.equal(electromechanicalFields.some((field) => field.target === "ELECTROMECANICA!K44"), false);
assert.equal(electromechanicalFields.some((field) => field.target === "ELECTROMECANICA!K51"), false);
assert.equal(electromechanicalFields.some((field) => field.target === "ELECTROMECANICA!H82"), false);
assert.equal(electromechanicalFields.some((field) => field.target === "ELECTROMECANICA!H83"), false);
assert.equal(electromechanicalFields.some((field) => field.target === "ELECTROMECANICA!L10"), false);
assert.equal(electromechanicalFields.some((field) => field.target === "ELECTROMECANICA!L13"), false);
assert.equal(electromechanicalFields.some((field) => field.label === "ESTADO" || field.label === "OBSERVACIONES"), false);
assert.ok(electromechanicalQuestions.every((question) => question.field.responseType === "status"));

// Planta Huawei exposes only the nine real status rows. Relay mappings,
// BATERY SUMARY, and alarm-reference tables are informational workbook text.
const huaweiQuestions = officialCatalog.questions.filter(
  (question) => question.sheet === "PLANTA HUAWEI",
);
assert.deepEqual(
  huaweiQuestions.map((question) => question.row),
  [8, 9, 10, 11, 12, 13, 14, 15, 18],
);
assert.equal(
  officialCatalog.catalog.some(
    (field) => field.sheet === "PLANTA HUAWEI" &&
      !["D8", "D9", "D10", "D11", "D12", "D13", "D14", "D15", "D18"]
        .some((ref) => field.target.endsWith(`!${ref}`)),
  ),
  false,
);
assert.equal(
  huaweiQuestions.some((question) => /BATERY SUMARY|ALARM SETTINGS|RECTIFIER SUMARY/i.test(question.label)),
  false,
);

// INFRAESTRUCTURA keeps its original status rows and maps every editable
// tower/radiation destination explicitly. The example text is informational.
const infrastructureFields = officialCatalog.catalog.filter(
  (field) => field.sheet === "INFRAESTRUCTURA",
);
const infrastructureQuestions = officialCatalog.questions.filter(
  (question) => question.sheet === "INFRAESTRUCTURA",
);
assert.ok(infrastructureQuestions.some((question) => question.row === 39));
assert.ok(infrastructureQuestions.some((question) => question.row === 43));
assert.equal(infrastructureQuestions.some((question) => question.row >= 44), false);
assert.equal(infrastructureFields.some((field) => /EJEMPLO DE TRAMOS/i.test(field.label)), false);
assert.equal(infrastructureFields.some((field) => /EJEMPLO DE TRAMOS/i.test(field.sourceEvidence)), false);
assert.equal(infrastructureFields.find((field) => field.target === "INFRAESTRUCTURA!D45")?.responseType, "selection");
assert.equal(
  infrastructureFields.filter((field) => /^INFRAESTRUCTURA![FGHI](4[89]|5[0-9])$/.test(field.target)).length,
  48,
);
assert.ok(infrastructureFields.some((field) => field.target === "INFRAESTRUCTURA!B60" && field.evidenceSlot === "photo"));
const infrastructureRadiation = [
  { starts: [65, 75, 85], ret: true },
  { starts: [99, 109, 119], ret: true },
  { starts: [131, 141, 151], ret: true },
  { starts: [163, 173, 183], ret: true },
  { starts: [195, 204, 213], ret: false },
  { starts: [224, 233, 242], ret: false },
  { starts: [253, 262, 271], ret: false },
];
for (const block of infrastructureRadiation) {
  for (const start of block.starts) {
    for (let offset = 0; offset < 4; offset++) {
      assert.ok(infrastructureFields.some((field) => field.target === `INFRAESTRUCTURA!H${start + offset}`));
      assert.ok(infrastructureFields.some((field) => field.target === `INFRAESTRUCTURA!J${start + offset}`));
    }
    for (let offset = 4; offset < 8; offset++) {
      assert.ok(infrastructureFields.some((field) => field.target === `INFRAESTRUCTURA!D${start + offset}`));
    }
    if (block.ret) {
      assert.ok(infrastructureFields.some((field) => field.target === `INFRAESTRUCTURA!E${start + 8}:F${start + 8}`));
      assert.ok(infrastructureFields.some((field) => field.target === `INFRAESTRUCTURA!H${start + 8}`));
      assert.ok(infrastructureFields.some((field) => field.target === `INFRAESTRUCTURA!J${start + 8}`));
    }
  }
}

// Structural contract confirmed against the owner-provided workbook fixture.
// Keep it explicit so a future change cannot silently alter sheet names/order.
assert.deepEqual(EXPECTED_SHEETS, [
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
]);
assert.equal(PHOTO_SLOT_COUNT, 16);

// Check the beginning, middle, and end of every questionnaire sheet.
for (const [sheet] of EXPECTED_SHEETS.filter(([name]) =>
  ["(HW) ALARMAS DE FUERZA", "PLANTA HUAWEI", "INFRAESTRUCTURA",
    "ELECTROMECANICA", "TIERRAS", "TRANSMISION"].includes(name))) {
  const fields = officialCatalog.catalog.filter((field) => field.sheet === sheet);
  assert.ok(fields.length > 0, `sheet ${sheet} must have imported fields`);
  for (const field of [fields[0], fields[Math.floor(fields.length / 2)], fields.at(-1)]) {
    assert.ok(field.id && field.target, `${sheet} field must retain identity`);
  }
  assert.equal(new Set(fields.map((field) => field.id)).size, fields.length);
}

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

const blank = prepareBlankTemplate(source);
assert.equal(blank.verification.valid, true);
assert.equal(blank.verification.sheets.length, 10);
assert.equal(blank.photoSlots.length, PHOTO_SLOT_COUNT);
const blankZip = join(dir, "blank.xlsx");
writeFileSync(blankZip, blank.bytes);
const blankPhotoSheet = execFileSync("unzip", ["-p", blankZip, "xl/worksheets/sheet9.xml"], { encoding: "utf8" });
for (let slot = 1; slot <= PHOTO_SLOT_COUNT; slot++) {
  assert.equal(blankPhotoSheet.includes(`r="A${slot + 2}"`), true);
  assert.equal(blankPhotoSheet.includes(`ESPACIO ${slot}`), true);
}
assert.equal(blankPhotoSheet.includes("photo-1"), false);

const catalog = parseTemplate(source);
assert.equal(catalog.catalog.length > 0, true);
assert.equal(catalog.ready, false, "a workbook without maintenance rows is not ready");
assert.equal(catalog.questions.length, 0);
assert.equal(catalog.unmapped.length, 0);

const fields = officialCatalog.catalog.filter((field) => field.sheet === "PRESENTACION");
const snapshot = { responses: Object.fromEntries(fields.slice(0, 2).map((field, index) => [field.id, index ? 42 : "texto"])) };
const patched = patchTemplate(officialFixture, snapshot, fields.map((field) => ({ ...field, state: "mapped" })));
const verification = verifyTemplate(patched.bytes, fields, patched.writtenTargets, patched.capturedValues);
assert.equal(verification.valid, true);
assert.deepEqual(patched.writtenTargets.sort(), fields.slice(0, 2).map((field) => field.target).sort());
const patchedZip = join(dir, "patched.xlsx");
writeFileSync(patchedZip, patched.bytes);
assert.equal(/<f\b/i.test(execFileSync("unzip", ["-p", patchedZip, "xl/worksheets/sheet1.xml"], { encoding: "utf8" })), true);

// Responses are exact-id based; a coincidental label must not win. Ranges
// preserve their identity while writing the top-left cell.
const rangeField = { ...fields[0], id: "range-field", target: "PRESENTACION!B1:C1", state: "mapped" };
const rangePatch = patchTemplate(source, { Estado: "wrong", responses: { "range-field": "exact" } }, [rangeField]);
assert.equal(verifyTemplate(rangePatch.bytes, [rangeField], rangePatch.writtenTargets, rangePatch.capturedValues).valid, true);
assert.equal(verifyTemplate(rangePatch.bytes, [rangeField], [], { [rangeField.target]: "exact" }).valid, false);

// Every INFRAESTRUCTURA destination must survive a complete local export.
// Values are deliberately unique so a shifted row/column cannot pass.
const mappedInfrastructureFields = infrastructureFields.map((field, index) => ({
  ...field,
  state: "mapped",
}));
const infrastructureResponses = Object.fromEntries(
  mappedInfrastructureFields.map((field, index) => [
    field.id,
    field.responseType === "number" || field.responseType === "measurement"
      ? String(1000 + index)
      : `infra-${index}`,
  ]),
);
const infrastructurePatch = patchTemplate(
  officialFixture,
  { responses: infrastructureResponses },
  mappedInfrastructureFields,
);
assert.equal(infrastructurePatch.writtenTargets.length, mappedInfrastructureFields.length);
assert.equal(
  verifyTemplate(
    infrastructurePatch.bytes,
    mappedInfrastructureFields,
    infrastructurePatch.writtenTargets,
    infrastructurePatch.capturedValues,
  ).valid,
  true,
);
for (const field of mappedInfrastructureFields) {
  assert.ok(infrastructurePatch.writtenTargets.includes(field.target), field.target);
  assert.equal(infrastructurePatch.capturedValues[field.target], infrastructureResponses[field.id].toString());
}
const infrastructureZip = join(dir, "infrastructure-complete.xlsx");
writeFileSync(infrastructureZip, infrastructurePatch.bytes);
const infrastructureXml = execFileSync(
  "unzip",
  ["-p", infrastructureZip, "xl/worksheets/sheet4.xml"],
  { encoding: "utf8" },
);
for (const field of mappedInfrastructureFields) {
  const ref = field.target.split("!")[1].split(":")[0];
  assert.ok(infrastructureXml.includes(`r="${ref}"`), `${field.target} missing from sheet4.xml`);
}

// Every Ericsson table cell and every Transmission link/router destination
// must survive one complete export with unique values.
const explicitFields = [...forceAlarmFields, ...transmissionFields].map((field, index) => ({
  ...field,
  state: "mapped",
}));
const explicitResponses = Object.fromEntries(
  explicitFields.map((field, index) => [
    field.id,
    field.responseType === "selection" ? "OK" : `explicit-${index}`,
  ]),
);
const explicitPatch = patchTemplate(
  officialFixture,
  { responses: explicitResponses },
  explicitFields,
);
assert.equal(explicitPatch.writtenTargets.length, explicitFields.length);
assert.equal(
  verifyTemplate(
    explicitPatch.bytes,
    explicitFields,
    explicitPatch.writtenTargets,
    explicitPatch.capturedValues,
  ).valid,
  true,
);
for (const field of explicitFields) {
  assert.equal(explicitPatch.capturedValues[field.target], explicitResponses[field.id].toString(), field.target);
}
const explicitZip = join(dir, "transmission-ericsson-complete.xlsx");
writeFileSync(explicitZip, explicitPatch.bytes);
for (const field of explicitFields) {
  const sheetNumber = field.sheet === "TRANSMISION" ? 7 : 2;
  const ref = field.target.split("!")[1].split(":")[0];
  const sheetXml = execFileSync(
    "unzip",
    ["-p", explicitZip, `xl/worksheets/sheet${sheetNumber}.xml`],
    { encoding: "utf8" },
  );
  assert.ok(sheetXml.includes(`r="${ref}"`), `${field.target} missing from exported XML`);
}

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

// A tower photo is a targeted evidence slot, not a report-page photo. It
// must create a real drawing anchor on INFRAESTRUCTURA!B60.
const towerPhoto = embedEvidence(
  infrastructurePatch.bytes,
  [{
    id: "tower-photo",
    bytes: Buffer.from("89504e470d0a1a0a", "hex"),
    contentType: "image/png",
    target: "INFRAESTRUCTURA!B60",
  }],
  mappedInfrastructureFields,
);
assert.equal(towerPhoto.valid, true);
assert.deepEqual(towerPhoto.consumedPhotoIds, ["tower-photo"]);
const towerZip = join(dir, "tower-photo.xlsx");
writeFileSync(towerZip, towerPhoto.bytes);
const towerSheetXml = execFileSync("unzip", ["-p", towerZip, "xl/worksheets/sheet4.xml"], { encoding: "utf8" });
const towerDrawingId = towerSheetXml.match(/<drawing\b[^>]*r:id="([^"]+)"/)?.[1];
assert.ok(towerDrawingId, "INFRAESTRUCTURA must reference a drawing after tower-photo export");
const towerSheetRels = execFileSync("unzip", ["-p", towerZip, "xl/worksheets/_rels/sheet4.xml.rels"], { encoding: "utf8" });
const towerDrawingTarget = towerSheetRels.match(new RegExp(`<Relationship[^>]*Id="${towerDrawingId}"[^>]*Target="([^"]+)"`))?.[1];
assert.ok(towerDrawingTarget, "the tower drawing relationship must resolve");
const towerDrawingName = `xl/drawings/${towerDrawingTarget.split("/").at(-1)}`;
const towerDrawingXml = execFileSync("unzip", ["-p", towerZip, towerDrawingName], { encoding: "utf8" });
assert.equal(towerDrawingXml.includes("Evidence tower-photo"), true);
assert.equal(/<xdr:from><xdr:col>1<\/xdr:col>[\s\S]*?<xdr:row>59<\/xdr:row>/.test(towerDrawingXml), true);

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

// End-to-end local-first export: no login/session is involved. The snapshot
// contains one real questionnaire point in NOK state, a stable finding ID,
// description and one photo. The result is then reopened from disk.
const question = officialCatalog.questions[0];
const findingSnapshot = {
  responses: { [question.field.id]: "NOK" },
  sections: [{
    id: "section-under-test",
    name: question.sheet,
    title: question.section,
    points: [{ id: question.id, title: question.label, status: "NOK" }],
  }],
  findings: [{
    id: `finding:${question.id}`,
    pointId: question.id,
    sectionId: "section-under-test",
    description: "Aislador deteriorado",
    responsible: "Mantenimiento",
    priority: "ALTA",
    startDate: "2026-09-15",
    commitmentDate: "2026-09-20",
    completedDate: null,
    state: "ABIERTO",
    photos: [{ id: "photo-integral", type: "ANTES" }],
  }],
};
const generalField = officialCatalog.catalog.find((field) => field.sheet === "PRESENTACION");
const integralCatalog = [generalField, question.field].filter(Boolean).map((field) => ({
  ...field,
  state: "mapped",
}));
const integralPatched = patchTemplate(officialFixture, findingSnapshot, integralCatalog);
assert.ok(integralPatched.writtenTargets.includes("HOJA DE SEG!B7"));
assert.ok(integralPatched.writtenTargets.includes("HOJA DE SEG!E7"));
assert.ok(integralPatched.writtenTargets.includes("REPORTE FOTOGRAFICO!A30"));
const validPng = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489" +
  "0000000d49444154789c6360f8cf00000004000101c9f3e5" +
  "0000000049454e44ae426082",
  "hex",
);
const integralEmbedded = embedEvidence(
  integralPatched.bytes,
  [{ id: "photo-integral", bytes: validPng, contentType: "image/png" }],
  integralCatalog,
);
assert.equal(integralEmbedded.valid, true);
assert.deepEqual(integralEmbedded.consumedPhotoIds, ["photo-integral"]);
const integralVerification = verifyTemplate(
  integralEmbedded.bytes,
  integralCatalog,
  integralPatched.writtenTargets,
  integralPatched.capturedValues,
);
assert.equal(integralVerification.valid, true);
const integralZip = join(dir, "integral-nok.xlsx");
writeFileSync(integralZip, integralEmbedded.bytes);
const originalZip = join(dir, "original-official.xlsx");
writeFileSync(originalZip, officialFixture);
const sheetNames = execFileSync("unzip", ["-p", integralZip, "xl/workbook.xml"], { encoding: "utf8" });
for (const [name] of EXPECTED_SHEETS) assert.ok(sheetNames.includes(`name="${name}"`));
const segXml = execFileSync("unzip", ["-p", integralZip, "xl/worksheets/sheet8.xml"], { encoding: "utf8" });
const reportXml = execFileSync("unzip", ["-p", integralZip, "xl/worksheets/sheet9.xml"], { encoding: "utf8" });
assert.ok(segXml.includes("Aislador deteriorado"));
assert.ok(reportXml.includes("Aislador deteriorado"));
assert.ok(execFileSync("unzip", ["-l", integralZip], { encoding: "utf8" }).includes("xl/media/template-"));
assert.equal(
  execFileSync("unzip", ["-p", originalZip, "xl/styles.xml"], { encoding: "utf8" }),
  execFileSync("unzip", ["-p", integralZip, "xl/styles.xml"], { encoding: "utf8" }),
);
assert.ok(reportXml.includes('ref="A10:F27"'));
assert.ok(reportXml.includes("<mergeCell"));
assert.ok(execFileSync("unzip", ["-p", integralZip, "xl/worksheets/sheet1.xml"], { encoding: "utf8" }).includes("dataValidation"));
try {
  execFileSync("soffice", ["--headless", "--convert-to", "pdf", "--outdir", dir, integralZip], { stdio: "ignore" });
  assert.ok(true, "LibreOffice reopened the generated XLSX");
} catch (error) {
  if (error?.status !== 127) throw error;
}

rmSync(dir, { recursive: true, force: true });
console.log("xlsxTemplate parser/patch tests passed");