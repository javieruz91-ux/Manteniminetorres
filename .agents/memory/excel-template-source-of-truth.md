---
name: Excel template source of truth
description: Durable rules for importing, pinning, capturing, and exporting the official maintenance workbook.
---

Production visits must use the normalized catalog extracted from an owner-uploaded XLSX. Never restore a hardcoded checklist or generate a replacement workbook when the source file is absent.

**Why:** A small example catalog and reconstructed workbook silently omitted real fields and destroyed the official layout.

**How to apply:** Block new production visits and exports until the import audit has no unresolved editable cells. Pin every draft to an immutable owner-scoped template version and validate responses against the server-stored catalog, not client field definitions.

Exports must patch a clone of the original OOXML package, preserve unrelated parts, embed every mapped photograph, and verify sheet order, base dimensions, written targets, drawing relationships, and overflow pages before returning XLSX or converting that filled XLSX to PDF.

**Why:** Rebuilding with a spreadsheet library can drop styles, drawings, validations, print settings, and other OOXML parts; trusting client mappings also allows required fields to be bypassed.

**How to apply:** Treat compatibility with the official binary as unverified until that exact file is imported and opened in target spreadsheet engines. Synthetic fixtures validate mechanics, not real-template fidelity.

The official output sheets are excluded from the questionnaire catalog but are still operational export targets: findings use HOJA DE SEG columns B:G from row 7, and photographs use the 16 fixed REPORTE FOTOGRAFICO blocks.

**Why:** Those sheets are report layouts rather than editable questions; parsing them as questionnaire fields creates false inputs, while omitting them from export loses the required evidence report.

**How to apply:** Keep their coordinates explicit in the exporter and verify the original workbook after writing, including the added drawing relationships and unchanged styles, merges, formulas, and validations.

Questionnaires must be derived structurally by maintenance row: one question owns its status and observation destinations, while auxiliary values remain child fields. Do not infer questions from unlocked styles or neighboring labels.

**Why:** The official workbook uses styles, merged layout cells, formulas, and repeated headers for presentation; cell-level heuristics turned titles, output sheets, and duplicate auxiliary cells into questions.

**How to apply:** Keep general presentation fields explicit, exclude output/internal sheets before parsing, reject formulas and merged secondary cells as question sources, and preserve each child field's exact OOXML target under its owning row.

The active catalog has an explicit schema version. A cached catalog with an older schema must never create a new visit; on web it is replaced from the canonical trial source, and existing visits are migrated by stable response identity.

**Why:** AsyncStorage can outlive parser fixes, so checking only the workbook hash or template revision allows a legacy duplicate catalog to remain active indefinitely.

**How to apply:** Compare schema version and source hash before accepting cached or remote catalogs, preserve legacy response keys during migration, and render new visits only from the active canonical catalog.