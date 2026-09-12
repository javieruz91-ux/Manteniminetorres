import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useVisits } from '@/context/VisitContext';
import { useColors } from '@/hooks/useColors';
import { Input } from '@/components/Input';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { Feather } from '@expo/vector-icons';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function VisitDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { getVisit, updateVisit } = useVisits();
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const visit = getVisit(id);

  const [siteId, setSiteId] = useState('');
  const [siteName, setSiteName] = useState('');
  const [workOrder, setWorkOrder] = useState('');
  const [technician, setTechnician] = useState('');

  useEffect(() => {
    if (visit) {
      setSiteId(visit.siteId);
      setSiteName(visit.siteName);
      setWorkOrder(visit.workOrder);
      setTechnician(visit.technician);
    }
  }, [visit]);

  const saveGeneralData = () => {
    if (!id) return;
    updateVisit(id, { siteId, siteName, workOrder, technician });
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  if (!visit) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <Text style={{ color: colors.foreground }}>Visita no encontrada</Text>
      </View>
    );
  }

  const completedSections = visit.sections.filter(s => s.points.every(p => p.status !== 'PENDING')).length;
  const totalSections = visit.sections.length;
  const progress = totalSections > 0 ? completedSections / totalSections : 0;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <KeyboardAwareScrollViewCompat contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 16) }}>
        <View style={styles.content}>
          <Card style={styles.card}>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Datos Generales</Text>
            <Input 
              label="ID del Sitio" 
              value={siteId} 
              onChangeText={setSiteId} 
              onBlur={saveGeneralData}
              placeholder="Ej. BOG001"
            />
            <Input 
              label="Nombre del Sitio" 
              value={siteName} 
              onChangeText={setSiteName} 
              onBlur={saveGeneralData}
              placeholder="Ej. Las Lomas"
            />
            <Input 
              label="Orden de Trabajo" 
              value={workOrder} 
              onChangeText={setWorkOrder} 
              onBlur={saveGeneralData}
              placeholder="Ej. OT-2023-10-15"
            />
            <Input 
              label="Técnico Responsable" 
              value={technician} 
              onChangeText={setTechnician} 
              onBlur={saveGeneralData}
              placeholder="Ej. Juan Pérez"
            />
          </Card>

          <Card style={styles.card}>
            <View style={styles.progressHeader}>
              <Text style={[styles.sectionTitle, { color: colors.foreground, marginBottom: 0 }]}>Progreso de Inspección</Text>
              <Text style={[styles.progressText, { color: colors.primary }]}>{completedSections}/{totalSections}</Text>
            </View>
            <View style={[styles.progressBarBg, { backgroundColor: colors.muted }]}>
              <View style={[styles.progressBarFill, { backgroundColor: colors.primary, width: `${progress * 100}%` }]} />
            </View>

            <View style={styles.sectionsList}>
              {visit.sections.map((section) => {
                const pendingPoints = section.points.filter(p => p.status === 'PENDING').length;
                const isComplete = pendingPoints === 0;

                return (
                  <Button
                    key={section.id}
                    title={section.title}
                    variant={isComplete ? 'secondary' : 'outline'}
                    style={styles.sectionButton}
                    icon={
                      <Feather 
                        name={isComplete ? 'check-circle' : 'circle'} 
                        size={18} 
                        color={isComplete ? colors.success : colors.mutedForeground} 
                      />
                    }
                    onPress={() => router.push(`/visit/${visit.id}/section/${section.id}`)}
                  />
                );
              })}
            </View>
          </Card>

          <View style={styles.actionRow}>
            <Button
              title={`Hallazgos (${visit.findings.length})`}
              variant="secondary"
              style={styles.halfBtn}
              icon={<Feather name="alert-triangle" size={18} color={colors.foreground} />}
              onPress={() => router.push(`/visit/${visit.id}/findings`)}
            />
            <Button
              title="Resumen"
              variant="primary"
              style={styles.halfBtn}
              icon={<Feather name="file-text" size={18} color="#FFF" />}
              onPress={() => router.push(`/visit/${visit.id}/summary`)}
            />
          </View>
        </View>
      </KeyboardAwareScrollViewCompat>
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: 16,
    gap: 16,
  },
  card: {
    padding: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontFamily: 'Inter_700Bold',
    marginBottom: 16,
  },
  progressHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  progressText: {
    fontSize: 16,
    fontFamily: 'Inter_700Bold',
  },
  progressBarBg: {
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
    marginBottom: 20,
  },
  progressBarFill: {
    height: '100%',
    borderRadius: 4,
  },
  sectionsList: {
    gap: 10,
  },
  sectionButton: {
    justifyContent: 'flex-start',
  },
  actionRow: {
    flexDirection: 'row',
    gap: 12,
  },
  halfBtn: {
    flex: 1,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  }
});
