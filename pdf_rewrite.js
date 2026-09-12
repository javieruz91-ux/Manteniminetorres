const fs = require('fs');
let code = fs.readFileSync('artifacts/mantenimiento-celular/utils/report.ts', 'utf8');

// replace .finding CSS
code = code.replace(
  /\.finding \{ margin-bottom: 30px; page-break-inside: avoid; border: 1px solid #E2E8F0; padding: 10px; border-radius: 8px; \}/,
  `.finding { margin-bottom: 30px; border: 1px solid #E2E8F0; padding: 10px; border-radius: 8px; }
  .photo-card { width: 100%; margin-bottom: 20px; page-break-inside: avoid; border: 1px solid #E2E8F0; padding: 10px; border-radius: 8px; }`
);
code = code.replace(
  /\.photo-card \{ width: 48%; margin-bottom: 10px; \}/,
  `` // remove original photo-card styling
);

code = code.replace(
  /<div class="finding">([\s\S]*?)<\/div>\s*<\/div>/,
  `// will replace logic entirely`
);

fs.writeFileSync('artifacts/mantenimiento-celular/utils/report.ts', code);
