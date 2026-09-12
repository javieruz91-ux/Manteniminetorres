import { ChecklistPoint, Section } from '../types';

export interface ChecklistSheetDefinition {
  id: string;
  name: string;
  title: string;
  points: readonly string[];
}

/**
 * Catálogo operativo del libro de mantenimiento.
 *
 * `name` es el identificador de integración y coincide con el nombre de la
 * hoja de Excel. `title` es el texto que se muestra en la aplicación.
 */
export const CHECKLIST_SHEETS: readonly ChecklistSheetDefinition[] = [
  {
    id: 's1',
    name: 'ALARMAS DE FUERZA',
    title: 'Alarmas de fuerza',
    points: ['Falla de AC', 'Rectificador averiado', 'Bajo voltaje DC'],
  },
  {
    id: 's2',
    name: 'PLANTA HUAWEI',
    title: 'Planta Huawei',
    points: ['Estado de módulos', 'Baterías y cableado', 'Controlador SMU'],
  },
  {
    id: 's3',
    name: 'INFRAESTRUCTURA',
    title: 'Infraestructura',
    points: ['Cerramiento y candados', 'Estado de torre/mástil', 'Impermeabilización'],
  },
  {
    id: 's4',
    name: 'ELECTROMECANICA',
    title: 'Electromecánica',
    points: ['Tableros de transferencia', 'Climatización/Aires', 'Grupo electrógeno'],
  },
  {
    id: 's5',
    name: 'TIERRAS',
    title: 'Tierras',
    points: ['Barras de tierra', 'Conexiones equipotenciales'],
  },
  {
    id: 's6',
    name: 'TRANSMISION',
    title: 'Transmisión',
    points: ['Alineación de antenas', 'Cables ODU/IDU'],
  },
  {
    id: 's7',
    name: 'RADIOFRECUENCIA',
    title: 'Radiofrecuencia',
    points: ['Estado de antenas', 'Conectores y jumpers', 'Etiquetado de sectores'],
  },
  {
    id: 's8',
    name: 'ENERGIA SOLAR',
    title: 'Energía solar',
    points: ['Paneles solares', 'Controlador solar', 'Cableado solar'],
  },
  {
    id: 's9',
    name: 'SISTEMA DE SEGURIDAD',
    title: 'Sistema de seguridad',
    points: ['CCTV y grabador', 'Control de acceso', 'Extintores y señalización'],
  },
  {
    id: 's10',
    name: 'OBRA CIVIL',
    title: 'Obra civil',
    points: ['Losa y drenajes', 'Canalizaciones', 'Limpieza del sitio'],
  },
] as const;

export const CHECKLIST_SHEET_NAMES = CHECKLIST_SHEETS.map((sheet) => sheet.name);

export function createInitialSections(): Section[] {
  return CHECKLIST_SHEETS.map((sheet) => ({
    id: sheet.id,
    name: sheet.name,
    title: sheet.title,
    status: 'PENDING',
    points: sheet.points.map((title, pointIndex): ChecklistPoint => ({
      id: `${sheet.id}_p${pointIndex + 1}`,
      title,
      status: 'PENDING',
    })),
  }));
}