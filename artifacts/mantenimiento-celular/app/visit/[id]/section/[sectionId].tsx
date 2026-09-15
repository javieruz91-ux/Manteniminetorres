import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useVisits } from '@/context/VisitContext';
import { useColors } from '@/hooks/useColors';
import { Card } from '@/components/Card';
import { ChecklistStatus } from '@/types';
import * as Haptics from 'expo-haptics';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function SectionDetailScreen() {
  const { id, sectionId } = useLocalSearchParams<{ id: string, sectionId: string }>();
  const { getVisit, updatePointStatus, saveFindingAndStatus } = useVisits();
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const visit = getVisit(id);
  const section = visit?.sections.find(s => s.id === sectionId);

  if (!visit || !section) return null;

  const isReadOnly = visit.lifecycleStatus === 'CERRADA';

  const handleStatusSelect = async (pointId: string, status: ChecklistStatus) => {
    if (isReadOnly) return;
    Haptics.selectionAsync();
    
    if (status === 'NOK' || status === 'SC') {
      // Don't update point status yet to avoid orphan NOK records.
      // Instead, navigate to finding creation. Status is updated there.
      router.push({
        pathname: `/visit/${visit.id}/finding/${pointId}` as any,
        params: { sectionId: section.id, status }
      });
    } else {
      // If changing from NOK to something else, prompt to delete finding
      const hasFinding = visit.findings.find(f => f.pointId === pointId);
      if (hasFinding) {
        Alert.alert(
          'Eliminar Hallazgo',
          'Al cambiar el estado se eliminará el hallazgo registrado. ¿Continuar?',
          [
            { text: 'Cancelar', style: 'cancel' },
            { 
              text: 'Eliminar', 
              style: 'destructive',
              onPress: async () => {
                await saveFindingAndStatus(visit.id, pointId, section.id, status, null);
              }
            }
          ]
        );
      } else {
        await updatePointStatus(visit.id, section.id, pointId, status);
      }
    }
  };

  const StatusOption = ({ pointId, currentStatus, targetStatus, label, color, icon }: any) => {
    const isSelected = currentStatus === targetStatus;
    return (
      <TouchableOpacity
        testID={`btn-status-${targetStatus}`}
        activeOpacity={isReadOnly ? 1 : 0.7}
        onPress={() => handleStatusSelect(pointId, targetStatus)}
        style={[
          styles.statusBtn,
          {
            backgroundColor: isSelected ? color : colors.background,
            borderColor: isSelected ? color : colors.border,
            opacity: isReadOnly && !isSelected ? 0.5 : 1
          }
        ]}
      >
        <Feather name={icon} size={16} color={isSelected ? '#FFF' : colors.mutedForeground} />
        <Text style={[
          styles.statusBtnText,
          { color: isSelected ? '#FFF' : colors.mutedForeground }
        ]}>
          {label}
        </Text>
      </TouchableOpacity>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom, 40) }]}>
        <View style={styles.header}>
          <Text style={[styles.title, { color: colors.foreground }]}>{section.title}</Text>
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
            {isReadOnly ? "Visita de solo lectura. No se permiten cambios." : "Evalúa cada punto. Al marcar NOK se solicitará evidencia."}
          </Text>
        </View>

        <View style={styles.pointsList}>
          {section.points.map(point => {
            const hasFinding = visit.findings.some(f => f.pointId === point.id);
            return (
              <Card key={point.id} style={styles.pointCard}>
                <View style={styles.pointHeader}>
                  <Text style={[styles.pointTitle, { color: colors.foreground }]}>{point.title}</Text>
                  {hasFinding && (
                    <Feather name="alert-triangle" size={16} color={colors.warning} />
                  )}
                </View>

                <View style={styles.optionsRow}>
                  <StatusOption 
                    pointId={point.id} 
                    currentStatus={point.status} 
                    targetStatus="OK" 
                    label="OK" 
                    color={colors.success} 
                    icon="check" 
                  />
                  <StatusOption 
                    pointId={point.id} 
                    currentStatus={point.status} 
                    targetStatus="NOK" 
                    label="NOK" 
                    color={colors.destructive} 
                    icon="x" 
                  />
                  <StatusOption 
                    pointId={point.id} 
                    currentStatus={point.status} 
                    targetStatus="SC" 
                    label="S/C" 
                    color={colors.warning} 
                    icon="minus" 
                  />
                  <StatusOption 
                    pointId={point.id} 
                    currentStatus={point.status} 
                    targetStatus="NA" 
                    label="N/A" 
                    color={colors.na} 
                    icon="slash" 
                  />
                </View>

                 {(point.status === 'NOK' || point.status === 'SC') && !hasFinding && (
                  <Text style={[styles.nokWarning, { color: colors.destructive }]}>
                     Se requiere registrar un hallazgo con descripción y fotografía.
                  </Text>
                )}
                {hasFinding && (
                  <Text style={[styles.findingInfo, { color: colors.warning }]}>
                    Hallazgo registrado.
                  </Text>
                )}
              </Card>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: 16,
    paddingBottom: 40,
  },
  header: {
    marginBottom: 20,
  },
  title: {
    fontSize: 22,
    fontFamily: 'Inter_700Bold',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
  },
  pointsList: {
    gap: 16,
  },
  pointCard: {
    padding: 16,
    gap: 16,
  },
  pointHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  pointTitle: {
    fontSize: 16,
    fontFamily: 'Inter_600SemiBold',
    flex: 1,
    marginRight: 8,
  },
  optionsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  statusBtn: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  statusBtnText: {
    fontSize: 12,
    fontFamily: 'Inter_600SemiBold',
  },
  nokWarning: {
    fontSize: 12,
    fontFamily: 'Inter_500Medium',
    marginTop: -4,
  },
  findingInfo: {
    fontSize: 12,
    fontFamily: 'Inter_500Medium',
    marginTop: -4,
  }
});