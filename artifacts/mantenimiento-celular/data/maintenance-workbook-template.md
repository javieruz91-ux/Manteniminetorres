# Exportación legible de la plantilla de mantenimiento

La plantilla binaria original no estaba disponible en el workspace. Esta
exportación conserva el catálogo y el contrato del libro que ya estaban
confirmados en el historial del proyecto, para que la comparación pueda
repetirse sin depender de supuestos.

## Hojas del catálogo (orden)

| # | Nombre de hoja | Título mostrado | Puntos, en orden |
|---:|---|---|---|
| 1 | `ALARMAS DE FUERZA` | Alarmas de fuerza | Falla de AC; Rectificador averiado; Bajo voltaje DC |
| 2 | `PLANTA HUAWEI` | Planta Huawei | Estado de módulos; Baterías y cableado; Controlador SMU |
| 3 | `INFRAESTRUCTURA` | Infraestructura | Cerramiento y candados; Estado de torre/mástil; Impermeabilización |
| 4 | `ELECTROMECANICA` | Electromecánica | Tableros de transferencia; Climatización/Aires; Grupo electrógeno |
| 5 | `TIERRAS` | Tierras | Barras de tierra; Conexiones equipotenciales |
| 6 | `TRANSMISION` | Transmisión | Alineación de antenas; Cables ODU/IDU |
| 7 | `RADIOFRECUENCIA` | Radiofrecuencia | Estado de antenas; Conectores y jumpers; Etiquetado de sectores |
| 8 | `ENERGIA SOLAR` | Energía solar | Paneles solares; Controlador solar; Cableado solar |
| 9 | `SISTEMA DE SEGURIDAD` | Sistema de seguridad | CCTV y grabador; Control de acceso; Extintores y señalización |
| 10 | `OBRA CIVIL` | Obra civil | Losa y drenajes; Canalizaciones; Limpieza del sitio |

## Hojas adicionales del libro exportado

- `PRESENTACION`: título, Sitio ID, Nombre del Sitio, Orden de Trabajo,
  Técnico, Fecha, Ciclo de Vida y Sincronización.
- Cada hoja del catálogo usa los encabezados:
  `Punto`, `Estado`, `Hallazgo`, `Prioridad`, `Responsable`, `Fecha Compromiso`.
- `HOJA DE SEG` usa:
  `Hoja`, `Punto`, `A quien corresponde`, `Descripción`, `Fecha de inicio`,
  `Fecha realizado OK`.
- `REPORTE FOTOGRAFICO` usa:
  `Espacio`, `Hoja`, `Punto`, `Observaciones`, `Estado`, `Tipo de evidencia`,
  `Estado de Subida`, `Ruta de Archivo`.

## Espacios fotográficos

El reporte reserva exactamente 16 espacios operativos, numerados del 1 al 16.
Cada espacio conserva la hoja, el punto, la observación, el estado del
hallazgo y los datos de la evidencia. Las fotografías que excedan el espacio
16 se mantienen como evidencias adicionales, sin desplazar ni renumerar los
primeros 16 espacios.