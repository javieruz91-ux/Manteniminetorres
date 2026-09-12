const fs = require('fs');
let code = fs.readFileSync('artifacts/mantenimiento-celular/utils/report.ts', 'utf8');

const regex = /visit\.sections\.forEach\(\(section, index\) => \{[\s\S]*?XLSX\.utils\.book_append_sheet\(wb, ws, sheetName\);\s*\}\);/;

const replacement = `const CANONICAL_SHEETS = [
    'ALARMAS DE FUERZA', 'PLANTA HUAWEI', 'INFRAESTRUCTURA', 
    'ELECTROMECANICA', 'TIERRAS', 'TRANSMISION'
  ];

  for (const sheetName of CANONICAL_SHEETS) {
    const section = visit.sections.find(s => s.title.toUpperCase() === sheetName || s.name.toUpperCase() === sheetName);
    const data = [
      ['Punto', 'Estado', 'Hallazgo', 'Prioridad', 'Responsable', 'Fecha Compromiso']
    ];
    
    if (section) {
      section.points.forEach(point => {
        const finding = visit.findings.find(f => f.pointId === point.id);
        data.push([
          point.title,
          point.status,
          finding ? finding.description : '',
          finding ? finding.priority : '',
          finding ? finding.responsible : '',
          finding ? finding.commitmentDate : ''
        ]);
      });
    }
    
    const ws = XLSX.utils.aoa_to_sheet(data);
    ws['!cols'] = [{ wch: 25 }, { wch: 10 }, { wch: 40 }, { wch: 15 }, { wch: 20 }, { wch: 15 }];
    ws['!freeze'] = { ySplit: 1, xSplit: 0, topRow: 1, activePane: 'bottomLeft', state: 'frozen' } as any;
    ws['!autofilter'] = { ref: \`A1:F\${data.length}\` };
    
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
  }`;

code = code.replace(regex, replacement);

const writeRegex = /const b64 = XLSX\.write\(wb, \{ type: 'base64', bookType: 'xlsx' \}\);/;
const writeReplacement = `const EXPECTED_SHEETS = ['PRESENTACION', ...CANONICAL_SHEETS, 'HOJA DE SEG', 'REPORTE FOTOGRAFICO'];
  if (wb.SheetNames.length !== 9 || !wb.SheetNames.every((name, i) => name === EXPECTED_SHEETS[i])) {
    throw new Error("Error de aserción: La estructura del archivo Excel no coincide con el estándar requerido (exactamente 9 hojas).");
  }

  const b64 = XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });`;

code = code.replace(writeRegex, writeReplacement);
fs.writeFileSync('artifacts/mantenimiento-celular/utils/report.ts', code);
