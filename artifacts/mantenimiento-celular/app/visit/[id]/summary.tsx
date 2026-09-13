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
import { exportTemplate, exportTemplateLocally, getTemplateExportBlockReason } from '@/lib/templateApi';
import { useTemplate } from '@/context/TemplateContext';
import { AuditEvent, Finding } from '@/types';
import { getCloseEligibility } from '@/utils/maintenanceRules';
import { createDemoCatalog } from '@/lib/demoTemplate';
import { getLogicalEditableFields } from '@/utils/templateFields';
import { catalogQuestions } from '@/utils/catalogNavigation';
import * as FileSystem from 'expo-file-system/legacy';
import { Platform } from 'react-native';

export default function SummaryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { getVisit, updateVisit, triggerSync, closeVisit, reopenVisit, isDemoMode, isLocalMode } = useVisits();
  const { user, login } = useAuth();
  const { catalog, sourceBase64, sourceFileName } = useTemplate();
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [isGenerating, setIsGenerating] = useState(false);
  const [reopenModalVisible, setReopenModalVisible] = useState(false);
  const [reopenReason, setReopenReason] = useState('');

  const visit = getVisit(id);
  if (!visit) return null;
  const activeFields = catalog?.fields ?? (visit.demoOnly ? createDemoCatalog().fields : []);
  const editableFields = getLogicalEditableFields(activeFields);
  const realQuestions = catalogQuestions(activeFields);
  const respondedQuestionCount = realQuestions.filter(question =>
    Object.prototype.hasOwnProperty.call(visit.responses || {}, question.field.id),
  ).length;
  const catalogIntegrityError = activeFields.length === 0
    ? 'No hay una plantilla activa para esta visita.'
    : catalog && catalog.descriptor.fields !== activeFields.length
      ? `El catálogo declara ${catalog.descriptor.fields} campos y cargó ${activeFields.length}.`
    : new Set(realQuestions.map(question => question.field.id)).size !== realQuestions.length
      ? 'La plantilla contiene campos editables duplicados.'
      : respondedQuestionCount !== realQuestions.length
        ? `La visita conserva ${respondedQuestionCount} respuestas para ${realQuestions.length} preguntas reales.`
        : null;

  // Exact Validations
  const {
    generalDataComplete: isGeneralDataComplete,
    allPointsEvaluated,
    allNokHaveFindings,
    missingItems,
    eligible: canClose,
  } = getCloseEligibility(visit, activeFields);
  const canCloseSafely = canClose && !catalogIntegrityError;
  const isClosed = visit.lifecycleStatus === 'CERRADA';
  const statusById = new Map(
    visit.sections.flatMap(section => section.points.map(point => [point.id, point.status] as const)),
  );
  const reviewItems = realQuestions.map(question => ({
    id: question.field.id,
    section: `${question.field.sheet} · ${question.field.section || question.field.sheet}`,
    title: question.field.label,
    status: statusById.get(question.field.id) ?? 'PENDING',
  }));

  const createAuditEvent = (action: string, reason: string): AuditEvent => {
    return {
      id: Crypto.randomUUID(),
      eventType: action,
      occurredAt: new Date().toISOString(),
      actorId: user?.id || 'local-technician',
      metadata: { reason }
    };
  };

  const handleCloseVisit = async () => {
    if (!canCloseSafely) {
      if (catalogIntegrityError) missingItems.unshift(catalogIntegrityError);
      if (!isGeneralDataComplete) {
         missingItems.unshift("Datos generales del sitio incompletos.");
      }
      Alert.alert('Incompleto', 'Faltan los siguientes requisitos:\n\n' + missingItems.join('\n'));
      return;
    }

    if (!user && !isLocalMode) {
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
              if (!isLocalMode) triggerSync();
              Alert.alert(
                '¡Cerrada!',
                isLocalMode
                  ? 'La visita quedó cerrada en este dispositivo. Puedes generar el reporte o respaldarla después.'
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
      if (!isLocalMode) triggerSync();
      setReopenModalVisible(false);
      setReopenReason('');
      Alert.alert('Reabierta', 'La visita ha sido reabierta.');
    } catch (e: any) {
      Alert.alert('Error', e.message);
    }
  };

  const handleReopenVisit = () => {
    if (!user && !isLocalMode) {
      Alert.alert('Iniciar Sesión Requerido', 'Necesitas iniciar sesión para reabrir la visita.', [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Iniciar Sesión', onPress: () => login() }
      ]);
      return;
    }

    setReopenModalVisible(true);
  };

  const handleManualSync = async () => {
    if (isLocalMode) {
      Alert.alert(
        'Modo local',
        'La visita queda guardada en este dispositivo. Inicia sesión después si quieres respaldarla.',
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
      const result = sourceBase64
        ? await exportTemplateLocally({
            fileName: sourceFileName || catalog?.descriptor.fileName || 'reporte.xlsx',
            contentBase64: sourceBase64,
            format,
            snapshot: visit,
            fields: activeFields.map(field => ({
              id: field.id,
              sheet: field.sheet,
              subsection: field.subsection || field.section,
              key: field.target?.cell || field.target?.range || field.id,
              label: field.label,
              responseType: field.type,
              options: field.options || [],
              required: Boolean(field.required),
              applicability: field.applicability || '',
              evidenceSlot: field.evidenceSlot || 'none',
              target: `${field.sheet}!${field.target?.cell || field.target?.range || ''}`,
              sourceEvidence: field.fullText || field.label,
              confidence: 1,
              state: 'mapped',
              ignoreReason: null,
            })),
            photos: await Promise.all(
              visit.findings.flatMap(finding => finding.photos).map(async photo => ({
                id: photo.id,
                contentBase64: await photoToBase64(photo.uri),
                contentType: photo.uri.toLowerCase().includes('.png') ? 'image/png' : 'image/jpeg',
              })),
            ),
          })
        : await exportTemplate(visit.id, format);
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
              {isLocalMode ? 'GUARDADA EN ESTE DISPOSITIVO' : visit.syncStatus}
            </Text>
          </Text>
          {isLocalMode && (
            <Text style={[styles.demoNotice, { color: colors.warning }]}>
              El uso local no necesita login. El respaldo al servidor queda disponible después.
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

        <Card style={styles.card}>
          <Text style={[styles.cardTitle, { color: colors.foreground }]}>Revisar antes de finalizar</Text>
          {reviewItems.length === 0 ? (
            <View style={styles.valItem}>
              <Feather name="check-circle" size={18} color={colors.success} />
              <Text style={[styles.valText, { color: colors.success }]}>No hay pendientes ni NOK.</Text>
            </View>
          ) : (
            reviewItems.map(item => (
              <View key={item.id} style={styles.reviewItem}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.foreground, fontFamily: 'Inter_600SemiBold' }}>{item.title}</Text>
                  <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>{item.section}</Text>
                </View>
                <Text style={[styles.reviewStatus, { color: item.status === 'NOK' ? colors.destructive : colors.warning }]}>
                  {item.status === 'NOK' ? 'NOK' : 'PENDIENTE'}
                </Text>
              </View>
            ))
          )}
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
                 {isLocalMode ? 'Visita cerrada localmente' : visit.syncStatus === 'SINCRONIZADO' ? 'Visita sincronizada' : 'Visita cerrada'}
              </Text>
              <Text style={{ color: colors.mutedForeground, textAlign: 'center', marginTop: 4 }}>
                 {isLocalMode
                   ? 'Los datos están guardados en este dispositivo.'
                   : visit.syncStatus === 'SINCRONIZADO'
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
            title="Finalizar y generar reporte"
            size="lg"
            onPress={handleCloseVisit}
            disabled={!canCloseSafely}
            icon={<Feather name="lock" size={20} color={!canCloseSafely ? colors.mutedForeground : "#FFF"} />}
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

async function photoToBase64(uri: string): Promise<string> {
  if (uri.startsWith('data:')) {
    return uri.split(',')[1] || '';
  }
  if (Platform.OS !== 'web') {
    return FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType.Base64,
    });
  }
  const response = await fetch(uri);
  const buffer = await response.arrayBuffer();
  let binary = '';
  new Uint8Array(buffer).forEach(byte => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
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
  reviewItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  reviewStatus: {
    fontFamily: 'Inter_700Bold',
    fontSize: 11,
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