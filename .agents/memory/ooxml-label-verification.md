---
name: OOXML label verification
description: Where to verify exact destinations and preserved template text in exported XLSX packages.
---

When testing a patched workbook, verify cell references and written values in the relevant `xl/worksheets/sheet*.xml`, but verify preserved original labels and units in `xl/sharedStrings.xml` when the source workbook stores them as shared strings.

**Why:** Searching for visible label text inside a worksheet XML can report a false failure even when the cell and its shared-string index remain unchanged.

**How to apply:** Use a unique response per mapped target, assert every target reference in the worksheet XML, then assert representative labels/units remain in the shared-string table and validate the ZIP package with `unzip -t`.