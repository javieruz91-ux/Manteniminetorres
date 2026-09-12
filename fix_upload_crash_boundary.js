const fs = require('fs');
let code = fs.readFileSync('artifacts/mantenimiento-celular/context/VisitContext.tsx', 'utf8');

const regex = /const uploadRes = await fetch\(urlRes\.uploadURL, \{[\s\S]*?body: blob,\s*\}\);\s*if \(uploadRes\.ok\) \{/g;
const replacement = `
                  // Awaitable crash boundary: save path immediately BEFORE PUT
                  const stateBeforeUpload = await updateAndPersist(prev => prev.map(pv => {
                    if (pv.id === latestV!.id && pv.operationId === latestV!.operationId) {
                      const updatedFindings = pv.findings.map(pf => {
                        if (pf.id === f.id) {
                          return { ...pf, photos: pf.photos.map(pp => pp.id === p.id ? { ...pp, uploadStatus: 'uploading' as UploadStatus, objectPath: urlRes.objectPath } : pp) };
                        }
                        return pf;
                      });
                      return { ...pv, findings: updatedFindings };
                    }
                    return pv;
                  }));
                  
                  latestV = stateBeforeUpload.find(v => v.id === latestV!.id);
                  if (!latestV || latestV.operationId !== persistedState.find(v => v.id === visit.id)?.operationId) {
                     // Abort if operation changed during url fetch
                     throw new Error('Operation ID changed during requestUploadUrl');
                  }

                  const uploadRes = await fetch(urlRes.uploadURL, {
                    method: 'PUT',
                    headers: { 'Content-Type': contentType },
                    body: blob,
                  });

                  if (uploadRes.ok) {`;

code = code.replace(regex, replacement);
fs.writeFileSync('artifacts/mantenimiento-celular/context/VisitContext.tsx', code);
