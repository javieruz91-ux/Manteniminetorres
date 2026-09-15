---
name: OOXML parser compatibility
description: Non-obvious XML parsing constraints found in the official maintenance workbook.
---

The official XLSX mixes self-closing and paired `c` and `xf` nodes. A parser must use one bounded match that consumes either `/>` or the matching closing tag; separate alternatives can start at a normal opening tag and consume unrelated later nodes.

**Why:** A permissive alternative caused cell values and style protection to be associated with the wrong references, which produced false catalog fields and hid the real audit candidates.

**How to apply:** Keep this invariant in the parser and regression-test the owner-provided binary, not only synthetic OOXML fixtures. Guard row/column context walks against non-positive coordinates.

Targeted evidence slots such as a tower photograph must be embedded through the destination sheet's drawing relationship and anchor; report-photo pages are a separate evidence surface.

**Why:** Treating every image as a report-page photo would leave the workbook's exact infrastructure destination visually empty even when the export reported success.

**How to apply:** Keep target-bearing photos separate from paginated report photos, resolve the destination sheet drawing, and regression-test the anchor's row and column.