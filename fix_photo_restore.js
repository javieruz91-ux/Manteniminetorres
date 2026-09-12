const fs = require('fs');
let code = fs.readFileSync('artifacts/mantenimiento-celular/context/VisitContext.tsx', 'utf8');

const regex = /              const info = await FileSystem\.getInfoAsync\(dest\);\n              if \(!info\.exists\) \{[\s\S]*?              \} else \{\n                remoteUris\[photo\.localId\] = dest;\n              \}/;

const replacement = `              const info = await FileSystem.getInfoAsync(dest);
              let needsDownload = !info.exists;
              
              if (!needsDownload) {
                // If it exists, let's just make sure it's valid if possible, but mostly we trust it. 
                // We'll trust existing local files to be valid if size > 0.
                if (info.size === 0) {
                  needsDownload = true;
                }
              }
              
              if (needsDownload) {
                try {
                  const res = await FileSystem.downloadAsync(url, dest, {
                    headers: { Authorization: \`Bearer \${token}\` }
                  });
                  if (res.status >= 200 && res.status < 300 && res.headers['content-type']?.includes('image')) {
                    remoteUris[photo.localId] = dest;
                  } else {
                    await FileSystem.deleteAsync(dest, { idempotent: true });
                    console.warn("Invalid photo response", res.status);
                  }
                } catch (e) {
                  console.warn("Failed to download photo native", e);
                }
              } else {
                remoteUris[photo.localId] = dest;
              }`;

code = code.replace(regex, replacement);
fs.writeFileSync('artifacts/mantenimiento-celular/context/VisitContext.tsx', code);
