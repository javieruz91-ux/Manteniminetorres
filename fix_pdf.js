const fs = require('fs');
let code = fs.readFileSync('artifacts/mantenimiento-celular/utils/report.ts', 'utf8');

const regex = /for \(const finding of visit\.findings\) \{[\s\S]*? \}\s*\}\s*html \+= `\s*<\/body>/;

const replacement = `for (const finding of visit.findings) {
      const section = visit.sections.find(s => s.id === finding.sectionId);
      const point = section?.points.find(p => p.id === finding.pointId);
      
      const headerHtml = \`
          <div class="finding-header" style="font-weight: bold; font-size: 16px; background-color: #F1F5F9; padding: 8px; margin-bottom: 10px;">
            Sección: \${escapeHtml(section?.title || '')} | Punto: \${escapeHtml(point?.title || '')}
          </div>
          <div class="observations" style="font-size: 14px; margin-bottom: 10px;">
            <strong>Descripción:</strong> \${escapeHtml(finding.description)}<br/>
            <strong>Responsable:</strong> \${escapeHtml(finding.responsible)} | <strong>Fecha Corrección:</strong> \${escapeHtml(finding.commitmentDate)} | <strong>Estado:</strong> \${escapeHtml(finding.state)}
          </div>
      \`;

      html += \`<div class="finding">\`;
      html += headerHtml;
      
      if (finding.photos.length === 0) {
        html += \`<p>No hay fotos registradas.</p>\`;
      } else {
        html += \`<div class="photos-grid" style="display: block;">\`;
        for (const photo of finding.photos) {
          let base64Uri = await getImageBase64(photo.uri);
          
          if (base64Uri) {
            html += \`
                <div class="photo-card" style="page-break-inside: avoid; border: 1px solid #E2E8F0; padding: 10px; margin-bottom: 20px;">
                  \${headerHtml}
                  <img src="\${base64Uri}" class="photo-img" style="max-height: 400px;" />
                  <div class="photo-label">Evidencia: \${escapeHtml(photo.type)}</div>
                </div>
            \`;
          } else {
            html += \`
                <div class="photo-card" style="page-break-inside: avoid; border: 1px solid #E2E8F0; padding: 10px; margin-bottom: 20px;">
                  \${headerHtml}
                  <div class="missing-photo" style="height: 400px; border: 1px dashed red; display: flex; align-items: center; justify-content: center; color: red;">IMAGEN NO DISPONIBLE</div>
                  <div class="photo-label">Evidencia: \${escapeHtml(photo.type)} (Falta Archivo Local)</div>
                </div>
            \`;
          }
        }
        html += \`</div>\`;
      }
      html += \`</div>\`;
    }
  }

  html += \`
      </body>`;

code = code.replace(regex, replacement);
fs.writeFileSync('artifacts/mantenimiento-celular/utils/report.ts', code);
