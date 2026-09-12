import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Alert, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useVisits } from '@/context/VisitContext';
import { useColors } from '@/hooks/useColors';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { generateAndShareCSV, generateAndSharePDF } from '@/utils/report';

export default function SummaryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { getVisit, updateVisit } = useVisits();
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [isSyncing, setIsSyncing] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);

  const visit = getVisit(id);
  if (!visit) return null;

  // Validation
  const isGeneralDataComplete = !!(visit.siteId && visit.siteName && visit.workOrder && visit.technician);
  
  let allPointsEvaluated = true;
  let allNokHaveFindings = true;
  
  visit.sections.forEach(section => {
    section.points.forEach(point => {
      if (point.status === 'PENDING') {
        allPointsEvaluated = false;
      }
      if (point.status === 'NOK') {
        const hasFinding = visit.findings.some(f => f.pointId === point.id);
        if (!hasFinding) allNokHaveFindings = false;
      }
    });
  });

  const canSync = isGeneralDataComplete && allPointsEvaluated && allNokHaveFindings && visit.status !== 'SINCRONIZADO';

  const handleSync = async () => {
    if (!canSync) {
      Alert.alert('Incompleto', 'Revisa los requisitos antes de sincronizar.');
      return;
    }

    setIsSyncing(true);
    // Simulate network delay
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    updateVisit(visit.id, { status: 'SINCRONIZADO' });
    setIsSyncing(false);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    Alert.alert('¡Éxito!', 'La visita ha sido sincronizada al servidor.');
  };

  const handleDownloadCSV = async () => {
    try {
      setIsGenerating(true);
      await generateAndShareCSV(visit);
    } catch (error) {
      Alert.alert('Error', 'No se pudo generar el archivo de mantenimiento.');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleDownloadPDF = async () => {
    try {
      setIsGenerating(true);
      await generateAndSharePDF(visit);
    } catch (error) {
      Alert.alert('Error', 'No se pudo generar el reporte fotográfico.');
    } finally {
      setIsGenerating(false);
    }
  };

  const ValidationItem = ({ ok, text }: { ok: boolean, text: string }) => (
    <View style={styles.valItem}>
      <Feather name={ok ? "check-circle" : "x-circle"} size={18} color={ok ? colors.success : colors.destructive} />
      <Text style={[styles.valText, { color: ok ? colors.foreground : colors.destructive }]}>{text}</Text>
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom, 40) }]}>
        
        <Card style={styles.card}>
          <Text style={[styles.cardTitle, { color: colors.foreground }]}>Estado de la Visita</Text>
          
          <ValidationItem ok={isGeneralDataComplete} text="Datos generales completos" />
          <ValidationItem ok={allPointsEvaluated} text="Todos los puntos de checklist evaluados" />
          <ValidationItem ok={allNokHaveFindings} text="Todos los puntos NOK tienen hallazgos" />
        </Card>

        <Card style={styles.card}>
          <Text style={[styles.cardTitle, { color: colors.foreground }]}>Resumen Numérico</Text>
          
          <View style={styles.statRow}>
            <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Hallazgos Registrados</Text>
            <Text style={[styles.statValue, { color: colors.foreground }]}>{visit.findings.length}</Text>
          </View>
          
          <View style={styles.statRow}>
            <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Fotografías Totales</Text>
            <Text style={[styles.statValue, { color: colors.foreground }]}>
              {visit.findings.reduce((acc, f) => acc + f.photos.length, 0)}
            </Text>
          </View>
        </Card>

        {visit.status === 'SINCRONIZADO' ? (
          <Card style={[styles.card, { borderColor: colors.success, borderWidth: 2 }]}>
            <View style={{ alignItems: 'center', marginBottom: 20 }}>
              <Feather name="check-circle" size={48} color={colors.success} style={{ marginBottom: 12 }} />
              <Text style={[styles.cardTitle, { color: colors.foreground, textAlign: 'center' }]}>Visita Sincronizada</Text>
              <Text style={{ color: colors.mutedForeground, textAlign: 'center', marginTop: 4 }}>
                Los datos ya están en el servidor central. Puedes descargar los reportes.
              </Text>
            </View>
            
            <View style={{ gap: 12 }}>
              <Button 
                title="Descargar Reporte (CSV)"
                variant="outline"
                icon={<Feather name="download" size={18} color={colors.foreground} />}
                onPress={handleDownloadCSV}
                disabled={isGenerating}
              />
              <Button 
                title="Descargar Reporte Fotográfico (PDF)"
                variant="outline"
                icon={<Feather name="file-text" size={18} color={colors.foreground} />}
                onPress={handleDownloadPDF}
                disabled={isGenerating}
                loading={isGenerating}
              />
              <Button 
                title="Volver al Inicio"
                variant="primary"
                onPress={() => router.navigate('/')}
                style={{ marginTop: 12 }}
                disabled={isGenerating}
              />
            </View>
          </Card>
        ) : (
          <Button
            testID="btn-sync-visit"
            title={isSyncing ? "Sincronizando..." : "Sincronizar Visita"}
            size="lg"
            onPress={handleSync}
            disabled={!canSync || isSyncing}
            loading={isSyncing}
            icon={!isSyncing && <Feather name="upload-cloud" size={20} color={!canSync ? colors.mutedForeground : "#FFF"} />}
            style={{ marginTop: 20 }}
          />
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: 16,
    gap: 16,
    paddingBottom: 40,
  },
  card: {
    padding: 16,
  },
  cardTitle: {
    fontSize: 18,
    fontFamily: 'Inter_700Bold',
    marginBottom: 16,
  },
  valItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 12,
  },
  valText: {
    fontSize: 15,
    fontFamily: 'Inter_500Medium',
  },
  statRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  statLabel: {
    fontSize: 15,
    fontFamily: 'Inter_400Regular',
  },
  statValue: {
    fontSize: 16,
    fontFamily: 'Inter_700Bold',
  }
});
