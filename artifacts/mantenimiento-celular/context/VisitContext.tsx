import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Visit, Section, ChecklistStatus, Finding, Photo } from '../types';

const INITIAL_SECTIONS: Section[] = [
  {
    id: 's1',
    title: 'Alarmas de fuerza',
    points: [
      { id: 'p1_1', title: 'Falla de AC', status: 'PENDING' },
      { id: 'p1_2', title: 'Rectificador averiado', status: 'PENDING' },
      { id: 'p1_3', title: 'Bajo voltaje DC', status: 'PENDING' },
    ],
  },
  {
    id: 's2',
    title: 'Planta Huawei',
    points: [
      { id: 'p2_1', title: 'Estado de módulos', status: 'PENDING' },
      { id: 'p2_2', title: 'Baterías y cableado', status: 'PENDING' },
      { id: 'p2_3', title: 'Controlador SMU', status: 'PENDING' },
    ],
  },
  {
    id: 's3',
    title: 'Infraestructura',
    points: [
      { id: 'p3_1', title: 'Cerramiento y candados', status: 'PENDING' },
      { id: 'p3_2', title: 'Estado de torre/mástil', status: 'PENDING' },
      { id: 'p3_3', title: 'Impermeabilización', status: 'PENDING' },
    ],
  },
  {
    id: 's4',
    title: 'Electromecánica',
    points: [
      { id: 'p4_1', title: 'Tableros de transferencia', status: 'PENDING' },
      { id: 'p4_2', title: 'Climatización/Aires', status: 'PENDING' },
      { id: 'p4_3', title: 'Grupo electrógeno', status: 'PENDING' },
    ],
  },
  {
    id: 's5',
    title: 'Tierras',
    points: [
      { id: 'p5_1', title: 'Barras de tierra', status: 'PENDING' },
      { id: 'p5_2', title: 'Conexiones equipotenciales', status: 'PENDING' },
    ],
  },
  {
    id: 's6',
    title: 'Transmisión',
    points: [
      { id: 'p6_1', title: 'Alineación de antenas', status: 'PENDING' },
      { id: 'p6_2', title: 'Cables ODU/IDU', status: 'PENDING' },
    ],
  },
];

interface VisitContextValue {
  visits: Visit[];
  isLoading: boolean;
  createVisit: (data: Partial<Visit>) => string;
  updateVisit: (id: string, data: Partial<Visit>) => void;
  deleteVisit: (id: string) => void;
  updatePointStatus: (visitId: string, sectionId: string, pointId: string, status: ChecklistStatus) => void;
  addFinding: (visitId: string, finding: Finding) => void;
  updateFinding: (visitId: string, findingId: string, data: Partial<Finding>) => void;
  getVisit: (id: string) => Visit | undefined;
}

const VisitContext = createContext<VisitContextValue | null>(null);

export function VisitProvider({ children }: { children: ReactNode }) {
  const [visits, setVisits] = useState<Visit[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadVisits();
  }, []);

  const loadVisits = async () => {
    try {
      const stored = await AsyncStorage.getItem('@mantenimiento_visits');
      if (stored) {
        setVisits(JSON.parse(stored));
      }
    } catch (e) {
      console.error('Error loading visits', e);
    } finally {
      setIsLoading(false);
    }
  };

  const saveVisits = async (newVisits: Visit[]) => {
    setVisits(newVisits);
    try {
      await AsyncStorage.setItem('@mantenimiento_visits', JSON.stringify(newVisits));
    } catch (e) {
      console.error('Error saving visits', e);
    }
  };

  const createVisit = (data: Partial<Visit>) => {
    const newVisit: Visit = {
      id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
      siteId: data.siteId || '',
      siteName: data.siteName || '',
      workOrder: data.workOrder || '',
      technician: data.technician || '',
      date: new Date().toISOString(),
      status: 'BORRADOR',
      sections: JSON.parse(JSON.stringify(INITIAL_SECTIONS)),
      findings: [],
    };
    
    saveVisits([newVisit, ...visits]);
    return newVisit.id;
  };

  const updateVisit = (id: string, data: Partial<Visit>) => {
    const updated = visits.map(v => v.id === id ? { ...v, ...data } : v);
    saveVisits(updated);
  };

  const deleteVisit = (id: string) => {
    const updated = visits.filter(v => v.id !== id);
    saveVisits(updated);
  };

  const updatePointStatus = (visitId: string, sectionId: string, pointId: string, status: ChecklistStatus) => {
    const updated = visits.map(v => {
      if (v.id === visitId) {
        const sections = v.sections.map(s => {
          if (s.id === sectionId) {
            const points = s.points.map(p => p.id === pointId ? { ...p, status } : p);
            return { ...s, points };
          }
          return s;
        });
        return { ...v, sections };
      }
      return v;
    });
    saveVisits(updated);
  };

  const addFinding = (visitId: string, finding: Finding) => {
    const updated = visits.map(v => {
      if (v.id === visitId) {
        return { ...v, findings: [...v.findings, finding] };
      }
      return v;
    });
    saveVisits(updated);
  };

  const updateFinding = (visitId: string, findingId: string, data: Partial<Finding>) => {
    const updated = visits.map(v => {
      if (v.id === visitId) {
        const findings = v.findings.map(f => f.id === findingId ? { ...f, ...data } : f);
        return { ...v, findings };
      }
      return v;
    });
    saveVisits(updated);
  };

  const getVisit = (id: string) => visits.find(v => v.id === id);

  return (
    <VisitContext.Provider value={{
      visits,
      isLoading,
      createVisit,
      updateVisit,
      deleteVisit,
      updatePointStatus,
      addFinding,
      updateFinding,
      getVisit
    }}>
      {children}
    </VisitContext.Provider>
  );
}

export function useVisits() {
  const context = useContext(VisitContext);
  if (!context) throw new Error('useVisits must be used within VisitProvider');
  return context;
}
