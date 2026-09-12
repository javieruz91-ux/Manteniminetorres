# Contrato legible de la plantilla de mantenimiento

## Estado de la fuente

El archivo binario oficial (`.xlsx`) no está presente en el workspace y no se
encontró una exportación de sus celdas. Por eso este documento **no confirma
los nombres ni el orden de los puntos**. La lista de puntos que existía en
versiones anteriores era una referencia provisional y no puede usarse para
crear visitas ni para reconstruir un reporte.

El flujo de producción solo acepta una plantilla cargada por el propietario:
el servidor la analiza, guarda su catálogo, fija su versión en cada visita y
parcha una copia de ese mismo archivo al exportar. La fuente de código de este
contrato estructural es `artifacts/api-server/src/lib/xlsxTemplate.ts`,
`EXPECTED_SHEETS`; la prueba de importación conserva el mismo orden.

## Diez hojas estructurales recuperadas

La siguiente es la única comparación que puede hacerse con la evidencia
disponible: nombres, orden y dimensiones estructurales que el parser exige.
Las dimensiones están expresadas como número máximo de columnas × filas.

| # | Nombre exacto de hoja | Dimensiones |
|---:|---|---:|
| 1 | `PRESENTACION` | 8 × 24 |
| 2 | `(HW) ALARMAS DE FUERZA` | 10 × 81 |
| 3 | `PLANTA HUAWEI` | 20 × 70 |
| 4 | `INFRAESTRUCTURA` | 13 × 278 |
| 5 | `ELECTROMECANICA` | 13 × 141 |
| 6 | `TIERRAS` | 12 × 80 |
| 7 | `TRANSMISION` | 11 × 32 |
| 8 | `HOJA DE SEG` | 8 × 42 |
| 9 | `REPORTE FOTOGRAFICO` | 13 × 211 |
| 10 | `base` | 1 × 1 |

Una plantilla con otro número de hojas, otro nombre, otro orden o una
dimensión diferente se rechaza antes de guardar el catálogo.

## Diferencias frente a la exportación provisional anterior

La exportación anterior describía diez hojas operativas:
`ALARMAS DE FUERZA`, `PLANTA HUAWEI`, `INFRAESTRUCTURA`, `ELECTROMECANICA`,
`TIERRAS`, `TRANSMISION`, `RADIOFRECUENCIA`, `ENERGIA SOLAR`,
`SISTEMA DE SEGURIDAD` y `OBRA CIVIL`. La evidencia estructural disponible
obliga a tratar estas diferencias como reales, pero todavía pendientes de
confirmación contra las celdas del archivo:

- `ALARMAS DE FUERZA` no coincide con el nombre exacto recuperado:
  `(HW) ALARMAS DE FUERZA`.
- `RADIOFRECUENCIA`, `ENERGIA SOLAR`, `SISTEMA DE SEGURIDAD` y `OBRA CIVIL`
  no aparecen entre las diez hojas estructurales recuperadas.
- `PRESENTACION`, `HOJA DE SEG`, `REPORTE FOTOGRAFICO` y `base` no estaban en
  la lista provisional.
- Por lo anterior, no se aplican los puntos ni encabezados de la lista
  provisional al catálogo de producción.

## Qué queda pendiente del Excel oficial

Cuando se incorpore el binario, hay que auditar y registrar, por hoja:

1. cada texto de punto editable y su orden;
2. encabezados, validaciones y rangos de captura;
3. campos ignorados o pendientes de mapeo; y
4. los slots fotográficos y su relación con `REPORTE FOTOGRAFICO`.

La importación existente realiza esa auditoría y mantiene bloqueadas las
visitas/exportaciones mientras queden celdas editables sin resolver. No se
deben volver a agregar `checklist.ts`, `reportCore.ts` ni un libro generado
para suplir la ausencia del archivo original.

## Reporte fotográfico

El contrato estructural reserva el bloque `A1:M211` en `REPORTE FOTOGRAFICO`.
Las páginas adicionales se clonan solo cuando el archivo oficial importado
contiene slots fotográficos mapeados; las fotografías fuera del primer bloque
no desplazan las filas de la plantilla original.