# Mantenimiento preventivo de sitios celulares

Aplicación local para llenar desde un teléfono o computadora el formato oficial de mantenimiento preventivo. Las visitas se guardan en el dispositivo y el reporte final conserva la estructura del archivo Excel original.

## Ejecutar localmente en Windows

Requisitos:

- Node.js 22 o superior.
- pnpm 10 u 11.

Desde PowerShell, en la carpeta del proyecto:

```powershell
pnpm install
pnpm dev:local
```

Abre `http://localhost:8081`. La API de generación del Excel se inicia en `http://localhost:3001`.

No se necesita cuenta de Replit, PostgreSQL ni almacenamiento en la nube. El comando local inicia únicamente:

- La interfaz web optimizada para celular.
- El motor local que analiza y genera el XLSX oficial.

## Probar desde un teléfono

La computadora y el teléfono deben estar en la misma red Wi-Fi. Para una prueba desde otro dispositivo, inicia Expo escuchando en la red local y configura la URL de la API con la dirección IP de la computadora. El firewall de Windows puede pedir autorización para permitir Node.js en la red privada.

## Verificación

```powershell
pnpm typecheck
pnpm test
```

El PDF requiere LibreOffice instalado. La generación del XLSX no lo necesita.

## Arquitectura

- `artifacts/mantenimiento-celular`: interfaz y almacenamiento local de visitas.
- `artifacts/api-server/src/localApp.ts`: API local sin autenticación ni base de datos.
- `artifacts/api-server/src/lib/xlsxTemplate.ts`: lectura y escritura conservadora del formato oficial.

La integración anterior con Replit se mantiene disponible de forma separada para una futura modalidad multiusuario, pero no forma parte del flujo local predeterminado.
