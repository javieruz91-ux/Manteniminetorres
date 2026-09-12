const fs = require('fs');
let code = fs.readFileSync('artifacts/mantenimiento-celular/context/VisitContext.tsx', 'utf8');

const regex = /            \} else \{\s*const dest = \`\$\{FileSystem\.documentDirectory\}\$\{photo\.localId\}\`;\s*const info = await FileSystem\.getInfoAsync\(dest\);\s*let needsDownload = !info\.exists;\s*if \(!needsDownload\) \{\s*\/\/ If it exists, let's just make sure it's valid if possible, but mostly we trust it\. \s*\/\/ We'll trust existing local files to be valid if size > 0\.\s*if \('size' in info && info\.size === 0\) \{\s*needsDownload = true;\s*\}\s*\}\s*if \(needsDownload\) \{\s*try \{\s*const res = await FileSystem\.downloadAsync\(url, dest, \{\s*headers: \{ Authorization: \`Bearer \$\{token\}\` \}\s*\}\);\s*if \(res\.status >= 200 && res\.status < 300 && res\.headers\['content-type'\]\?\.includes\('image'\)\) \{\s*remoteUris\[photo\.localId\] = dest;\s*\} else \{\s*await FileSystem\.deleteAsync\(dest, \{ idempotent: true \}\);\s*console\.warn\("Invalid photo response", res\.status\);\s*\}\s*\} catch \(e\) \{\s*console\.warn\("Failed to download photo native", e\);\s*\}\s*\} else \{\s*remoteUris\[photo\.localId\] = dest;\s*\}/;

const replacement = `            } else {
              let finalDest = '';
              const destJpg = \`\${FileSystem.documentDirectory}\${photo.localId}.jpg\`;
              const destPng = \`\${FileSystem.documentDirectory}\${photo.localId}.png\`;
              const infoJpg = await FileSystem.getInfoAsync(destJpg);
              const infoPng = await FileSystem.getInfoAsync(destPng);
              
              if (infoJpg.exists && ('size' in infoJpg && infoJpg.size > 0)) {
                finalDest = destJpg;
              } else if (infoPng.exists && ('size' in infoPng && infoPng.size > 0)) {
                finalDest = destPng;
              }
              
              if (!finalDest) {
                // Delete legacy extensionless if it exists
                const legacyDest = \`\${FileSystem.documentDirectory}\${photo.localId}\`;
                const legacyInfo = await FileSystem.getInfoAsync(legacyDest);
                if (legacyInfo.exists) await FileSystem.deleteAsync(legacyDest, { idempotent: true });

                try {
                  const tempDest = \`\${FileSystem.documentDirectory}temp_\${photo.localId}\`;
                  const res = await FileSystem.downloadAsync(url, tempDest, {
                    headers: { Authorization: \`Bearer \${token}\` }
                  });
                  if (res.status >= 200 && res.status < 300 && res.headers['content-type']?.includes('image')) {
                    const isPng = res.headers['content-type'].includes('png');
                    const ext = isPng ? '.png' : '.jpg';
                    const targetDest = \`\${FileSystem.documentDirectory}\${photo.localId}\${ext}\`;
                    await FileSystem.moveAsync({ from: tempDest, to: targetDest });
                    remoteUris[photo.localId] = targetDest;
                  } else {
                    await FileSystem.deleteAsync(tempDest, { idempotent: true });
                    console.warn("Invalid photo response", res.status);
                  }
                } catch (e) {
                  console.warn("Failed to download photo native", e);
                }
              } else {
                remoteUris[photo.localId] = finalDest;
              }`;

code = code.replace(regex, replacement);

const mergeRegex = /if \(sv\.serverVersion > \(merged\[idx\]\.serverVersion \|\| 0\)\) \{\s*merged\[idx\] = mapSnapshotToLocal\(sv, remoteUris\);\s*\}/;
const mergeReplacement = `if (sv.serverVersion > (merged[idx].serverVersion || 0)) {
              merged[idx] = mapSnapshotToLocal(sv, remoteUris);
            } else {
              // Merge only URIs on equal version to handle session blobs or newly downloaded native extensions
              merged[idx] = {
                ...merged[idx],
                findings: merged[idx].findings.map(f => ({
                  ...f,
                  photos: f.photos.map(p => ({
                    ...p,
                    uri: remoteUris[p.id] || p.uri
                  }))
                }))
              };
            }`;

code = code.replace(mergeRegex, mergeReplacement);

fs.writeFileSync('artifacts/mantenimiento-celular/context/VisitContext.tsx', code);
