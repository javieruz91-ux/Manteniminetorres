import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, Alert, Modal, TextInput } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useVisits } from '@/context/VisitContext';
import { useAuth } from '@/lib/auth';
import { useColors } from '@/hooks/useColors';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as Crypto from 'expo-crypto';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { saveAndShareTemplateExport } from '@/utils/templateExport';
import { exportTemplate, getTemplateExportBlockReason } from '@/lib/templateApi';
import { useTemplate } from '@/context/TemplateContext';
import { AuditEvent, Finding } from '@/types';
import { getCloseEligibility } from '@/utils/maintenanceRules';

export default function SummaryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { getVisit, updateVisit, triggerSync, closeVisit, reopenVisit, isDemoMode } = useVisits();
  const { user, login } = useAuth();
  const { catalog } = useTemplate();
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [isGenerating, setIsGenerating] = useState(false);
  const [reopenModalVisible, setReopenModalVisible] = useState(false);
  const [reopenReason, setReopenReason] = useState('');

  const visit = getVisit(id);
  if (!visit) return null;

  // Exact Validations
  const {
    generalDataComplete: isGeneralDataComplete,
    allPointsEvaluated,
    allNokHaveFindings,
    missingItems,
    eligible: canClose,
  } = getCloseEligibility(visit);
  const isClosed = visit.lifecycleStatus === 'CERRADA';

  const createAuditEvent = (action: string, reason: string): AuditEvent => {
    return {
      id: Crypto.randomUUID(),
      eventType: action,
      occurredAt: new Date().toISOString(),
      actorId: user?.id || (isDemoMode ? 'demo-technician' : 'unknown'),
      metadata: { reason }
    };
  };

  const handleCloseVisit = async () => {
    if (!canClose) {
      if (!isGeneralDataComplete) {
         missingItems.unshift("Datos generales del sitio incompletos.");
      }
      Alert.alert('Incompleto', 'Faltan los siguientes requisitos:\n\n' + missingItems.join('\n'));
      return;
    }

    if (!user && !isDemoMode) {
      Alert.alert(
        'Iniciar Sesión Requerido',
        'Necesitas iniciar sesión para cerrar y sincronizar la visita.',
        [
          { text: 'Cancelar', style: 'cancel' },
          { text: 'Iniciar Sesión', onPress: () => login() }
        ]
      );
      return;
    }

    Alert.alert(
      'Cerrar Visita',
      '¿Estás seguro de cerrar esta visita? No podrás hacer más cambios hasta reabrirla.',
      [
        { text: 'Cancelar', style: 'cancel' },
        { 
          text: 'Cerrar', 
          onPress: async () => {
            try {
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              const auditEvent = createAuditEvent('CLOSE_VISIT', 'Visita cerrada y lista para sincronización');
              await closeVisit(visit.id, auditEvent);
              if (!isDemoMode) triggerSync();
              Alert.alert(
                '¡Cerrada!',
                isDemoMode
                  ? 'La visita ficticia quedó cerrada localmente. La sincronización no se verifica en modo demo.'
                  : 'La visita ha sido cerrada y está en cola de sincronización.',
              );
            } catch (e: any) {
              Alert.alert('Error', e.message);
            }
          }
        }
      ]
    );
  };

  const confirmReopenVisit = async () => {
    if (!reopenReason.trim()) {
      Alert.alert('Razón requerida', 'Debes especificar por qué reabres la visita.');
      return;
    }
    
    try {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      const auditEvent = createAuditEvent('REOPEN_VISIT', reopenReason);
      await reopenVisit(visit.id, auditEvent);
      if (!isDemoMode) triggerSync();
      setReopenModalVisible(false);
      setReopenReason('');
      Alert.alert('Reabierta', 'La visita ha sido reabierta.');
    } catch (e: any) {
      Alert.alert('Error', e.message);
    }
  };

  const handleReopenVisit = () => {
    if (!user && !isDemoMode) {
      Alert.alert('Iniciar Sesión Requerido', 'Necesitas iniciar sesión para reabrir la visita.', [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Iniciar Sesión', onPress: () => login() }
      ]);
      return;
    }

    setReopenModalVisible(true);
  };

  const handleManualSync = async () => {
    if (isDemoMode) {
      Alert.alert(
        'Sincronización no verificable',
        'El modo demo conserva los datos y fotografías únicamente en este dispositivo o navegador.',
      );
      return;
    }
    if (!user) {
      Alert.alert('Iniciar Sesión Requerido', 'Necesitas iniciar sesión para sincronizar.', [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Iniciar Sesión', onPress: () => login() }
      ]);
      return;
    }
    
    try {
      await updateVisit(visit.id, { nextAttemptAt: Date.now() });
      triggerSync();
    } catch (e: any) {
      Alert.alert('Error', e.message);
    }
  };

  const handleDownload = async (format: 'xlsx' | 'pdf') => {
    const exportBlock = getTemplateExportBlockReason(visit, catalog?.descriptor);
    if (exportBlock) {
      Alert.alert(exportBlock, exportBlock);
      return;
    }
    try {
      setIsGenerating(true);
      const result = await exportTemplate(visit.id, format);
      if (
        result.verification &&
        (result.verification.verified === false ||
          result.verification.valid === false)
      ) {
        throw new Error('La verificación del archivo exportado falló.');
      }
      await saveAndShareTemplateExport(result);
    } catch (error) {
      Alert.alert('Error', error instanceof Error ? error.message : 'No se pudo descargar el archivo.');
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
          <Text style={{ color: colors.mutedForeground, marginBottom: 12 }}>
            Ciclo de Vida: <Text style={{ fontFamily: 'Inter_700Bold', color: colors.foreground }}>{visit.lifecycleStatus}</Text>
          </Text>
          <Text style={{ color: colors.mutedForeground, marginBottom: 12 }}>
            Sincronización: <Text style={{ fontFamily: 'Inter_700Bold', color: colors.foreground }}>
              {isDemoMode ? 'NO VERIFICABLE (DEMO)' : visit.syncStatus}
            </Text>
          </Text>
          {isDemoMode && (
            <Text style={[styles.demoNotice, { color: colors.warning }]}>
              Las fotos permanecen locales y no se suben. Ningún dato ficticio se envía al servidor.
            </Text>
          )}
          
          <ValidationItem ok={isGeneralDataComplete} text="Datos generales completos" />
          <ValidationItem ok={allPointsEvaluated} text="Todos los puntos de checklist evaluados" />
          <ValidationItem ok={allNokHaveFindings} text="Requisitos completos en hallazgos (NOK)" />
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

        {visit.syncError && (
          <Card style={[styles.card, { borderColor: colors.destructive, borderWidth: 1 }]}>
            <Text style={[styles.cardTitle, { color: colors.destructive }]}>Error de Sincronización</Text>
            <Text style={{ color: colors.foreground }}>{visit.syncError}</Text>
            <Text style={{ color: colors.mutedForeground, marginTop: 4, fontSize: 12 }}>
              Reintentos: {visit.syncAttemptCount || 0}
            </Text>
            <Button 
              title="Forzar Sincronización"
              variant="outline"
              onPress={handleManualSync}
              style={{ marginTop: 12 }}
            />
          </Card>
        )}

        {isClosed ? (
          <Card style={[styles.card, { borderColor: visit.syncStatus === 'SINCRONIZADO' ? colors.success : colors.primary, borderWidth: 2 }]}>
            <View style={{ alignItems: 'center', marginBottom: 20 }}>
              <Feather name={visit.syncStatus === 'SINCRONIZADO' ? "check-circle" : "cloud"} size={48} color={visit.syncStatus === 'SINCRONIZADO' ? colors.success : colors.primary} style={{ marginBottom: 12 }} />
              <Text style={[styles.cardTitle, { color: colors.foreground, textAlign: 'center' }]}>
                {visit.syncStatus === 'SINCRONIZADO' ? 'Visita Sincronizada' : 'Visita Cerrada'}
              </Text>
              <Text style={{ color: colors.mutedForeground, textAlign: 'center', marginTop: 4 }}>
                {visit.syncStatus === 'SINCRONIZADO' 
                  ? 'Los datos ya están en el servidor central. Puedes descargar los reportes.' 
                  : 'La visita está cerrada y lista para sincronizarse.'}
              </Text>
            </View>
            
            <View style={{ gap: 12 }}>
              <Button 
                title="Descargar Reporte Excel"
                variant="outline"
                icon={<Feather name="download" size={18} color={colors.foreground} />}
                 onPress={() => void handleDownload('xlsx')}
                disabled={isGenerating}
              />
              <Button 
                title="Descargar Reporte Fotográfico (PDF)"
                variant="outline"
                icon={<Feather name="file-text" size={18} color={colors.foreground} />}
                 onPress={() => void handleDownload('pdf')}
                disabled={isGenerating}
                loading={isGenerating}
              />
              <Button 
                title="Reabrir Visita"
                variant="destructive"
                onPress={handleReopenVisit}
                disabled={isGenerating || visit.syncStatus === 'SINCRONIZANDO'}
              />
            </View>
          </Card>
        ) : (
          <Button
            testID="btn-close-visit"
            title="Cerrar Visita"
            size="lg"
            onPress={handleCloseVisit}
            disabled={!canClose}
            icon={<Feather name="lock" size={20} color={!canClose ? colors.mutedForeground : "#FFF"} />}
            style={{ marginTop: 20 }}
          />
        )}
      </ScrollView>

      <Modal visible={reopenModalVisible} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.background }]}>
            <Text style={[styles.cardTitle, { color: colors.foreground, marginBottom: 8 }]}>Reabrir Visita</Text>
            <Text style={{ color: colors.mutedForeground, marginBottom: 16 }}>
              Por favor indica la razón para reabrir la visita:
            </Text>
            
            <TextInput
              style={[
                styles.modalInput, 
                { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }
              ]}
              placeholder="Razón de reapertura..."
              placeholderTextColor={colors.mutedForeground}
              value={reopenReason}
              onChangeText={setReopenReason}
              multiline
            />
            
            <View style={styles.modalActions}>
              <Button 
                title="Cancelar" 
                variant="outline" 
                onPress={() => {
                  setReopenModalVisible(false);
                  setReopenReason('');
                }} 
                style={{ flex: 1 }} 
              />
              <Button 
                title="Reabrir" 
                variant="destructive" 
                onPress={confirmReopenVisit} 
                style={{ flex: 1 }} 
              />
            </View>
          </View>
        </View>
      </Modal>
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
  demoNotice: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 12,
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
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  modalContent: {
    width: '100%',
    padding: 24,
    borderRadius: 12,
  },
  modalInput: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    minHeight: 100,
    textAlignVertical: 'top',
    fontFamily: 'Inter_400Regular',
    fontSize: 15,
    marginBottom: 20,
  },
  modalActions: {
    flexDirection: 'row',
    gap: 12,
  }
});