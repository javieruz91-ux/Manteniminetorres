---
name: OOXML parser compatibility
description: Non-obvious XML parsing constraints found in the official maintenance workbook.
---

The official XLSX mixes self-closing and paired `c` and `xf` nodes. A parser must use one bounded match that consumes either `/>` or the matching closing tag; separate alternatives can start at a normal opening tag and consume unrelated later nodes.

**Why:** A permissive alternative caused cell values and style protection to be associated with the wrong references, which produced false catalog fields and hid the real audit candidates.

**How to apply:** Keep this invariant in the parser and regression-test the owner-provided binary, not only synthetic OOXML fixtures. Guard row/column context walks against non-positive coordinates.