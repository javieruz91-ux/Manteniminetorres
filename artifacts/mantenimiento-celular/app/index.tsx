import React from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Alert, Platform } from 'react-native';
import { useVisits } from '@/context/VisitContext';
import { useColors } from '@/hooks/useColors';
import { Feather } from '@expo/vector-icons';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { useRouter } from 'expo-router';
import { Badge } from '@/components/Badge';
import { useTemplate } from '@/context/TemplateContext';

import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getVisitConvenienceFields } from '@/utils/maintenanceRules';
import { saveAndShareTemplateExport } from '@/utils/templateExport';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { MIME_XLSX } from '@/lib/templateApi';
import { createDemoCatalog } from '@/lib/demoTemplate';

export default function DashboardScreen() {
  const { visits, createVisit, isOnline, isDemoMode, isLocalMode, resetDemoData } = useVisits();
  const {
    catalog,
    isLoading: templateLoading,
    uploadLocal,
    sourceBase64,
    sourceFileName,
  } = useTemplate();
  const demoFields = React.useMemo(() => createDemoCatalog().fields, []);
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [isDownloadingTemplate, setIsDownloadingTemplate] = React.useState(false);
  const [isImportingTemplate, setIsImportingTemplate] = React.useState(false);

  const handleLoadTemplate = async () => {
    try {
      setIsImportingTemplate(true);
      const result = await DocumentPicker.getDocumentAsync({
        type: MIME_XLSX,
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (result.canceled || !result.assets[0]) return;
      const asset = result.assets[0];
      const browserFile = (asset as typeof asset & { file?: File }).file;
      const contentBase64 = browserFile
        ? await (async () => {
            const bytes = new Uint8Array(await browserFile.arrayBuffer());
            let binary = '';
            bytes.forEach(byte => {
              binary += String.fromCharCode(byte);
            });
            return btoa(binary);
          })()
        : await FileSystem.readAsStringAsync(asset.uri, {
            encoding: FileSystem.EncodingType.Base64,
          });
      await uploadLocal({
        fileName: asset.name || 'mi_formato.xlsx',
        contentBase64,
        replace: true,
      });
      Alert.alert('Formato cargado', 'Ya puedes iniciar una visita con tus campos reales.');
    } catch (error) {
      Alert.alert(
        'No se pudo cargar',
        error instanceof Error
          ? error.message
          : 'Selecciona un archivo XLSX válido e inténtalo de nuevo.',
      );
    } finally {
      setIsImportingTemplate(false);
    }
  };

  const handleStartVisit = async () => {
    try {
      const id = await createVisit({});
      router.push(`/visit/${id}`);
    } catch (error) {
      Alert.alert('No se puede iniciar', error instanceof Error ? error.message : 'Error desconocido');
      router.push('/settings/template');
    }
  };

  const handleResetDemo = async () => {
    try {
      const id = await resetDemoData();
      router.push(`/visit/${id}`);
    } catch (error) {
      Alert.alert('No se pudo reiniciar', error instanceof Error ? error.message : 'Error desconocido');
    }
  };

  const handleDownloadBlankTemplate = async () => {
    if (!sourceBase64) {
      Alert.alert('Plantilla no disponible', 'Carga el formato oficial antes de descargarlo.');
      return;
    }
    try {
      setIsDownloadingTemplate(true);
      await saveAndShareTemplateExport({
        base64: sourceBase64,
        fileName: sourceFileName || 'Mantenimiento_Preventivo_a_Sitios_Celulares.xlsx',
        mime: MIME_XLSX,
      });
    } catch (error) {
      Alert.alert(
        'No se pudo descargar',
        error instanceof Error ? error.message : 'No se pudo descargar la plantilla Excel.',
      );
    } finally {
      setIsDownloadingTemplate(false);
    }
  };

  const getLifecycleColor = (status: string) => {
    switch (status) {
      case 'BORRADOR': return colors.muted;
      case 'ABIERTA': return colors.primary;
      case 'CERRADA': return colors.success;
      case 'REABIERTA': return colors.warning;
      default: return colors.muted;
    }
  };

  const getSyncColor = (status: string) => {
    switch (status) {
      case 'PENDIENTE': return colors.warning;
      case 'SINCRONIZANDO': return colors.primary;
      case 'SINCRONIZADO': return colors.success;
      case 'ERROR': return colors.destructive;
      default: return colors.muted;
    }
  };

  const renderEmpty = () => (
    <View style={styles.emptyContainer}>
      <View style={[styles.emptyIcon, { backgroundColor: colors.muted }]}>
        <Feather name="clipboard" size={32} color={colors.mutedForeground} />
      </View>
      <Text style={[styles.emptyTitle, { color: colors.foreground, fontFamily: 'Inter_600SemiBold' }]}>
        Sin visitas recientes
      </Text>
      <Text style={[styles.emptyDesc, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
        Toca el botón inferior para comenzar un nuevo registro de mantenimiento preventivo.
      </Text>
    </View>
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.headerStatus, { backgroundColor: colors.header }]}>
        <View style={styles.statusRow}>
          <Feather name="smartphone" size={16} color={colors.success} />
          <Text style={[styles.statusText, { color: colors.headerForeground }]}>
            {isLocalMode ? 'Modo local' : isOnline ? 'En línea' : 'Desconectado'}
          </Text>
        </View>
        <Text style={[styles.authText, { color: colors.headerForeground }]}>Sin cuenta requerida</Text>
      </View>
      
      <View style={[styles.syncBar, { backgroundColor: colors.muted }]}>
         <Text style={[styles.syncText, { color: colors.foreground }]}>
          Guardado automático en este dispositivo · {visits.length} visita(s)
        </Text>
      </View>

      {!templateLoading && !catalog && (
         <TouchableOpacity
          testID="missing-template-banner"
          onPress={() => router.push('/settings/template')}
          style={[styles.templateBanner, { backgroundColor: colors.destructive }]}
        >
          <Feather name="alert-triangle" size={16} color="#FFF" />
          <Text style={styles.templateBannerText}>
             Aún no has cargado tu formato · usa “Cargar mi formato Excel”
          </Text>
        </TouchableOpacity>
      )}

       {isDemoMode && (
        <View style={[styles.demoBanner, { backgroundColor: colors.warning }]}>
          <View style={styles.demoCopy}>
            <Text style={styles.demoTitle}>MODO DEMOSTRACIÓN · LOCAL</Text>
            <Text style={styles.demoText}>
              Puedes llenar y cerrar una visita. Para generar el Excel exacto, carga tu formato.
            </Text>
          </View>
          <TouchableOpacity
            accessibilityRole="button"
            testID="btn-reset-demo"
            onPress={handleResetDemo}
            style={styles.demoReset}
          >
            <Feather name="refresh-cw" size={14} color="#7C2D12" />
            <Text style={styles.demoResetText}>Reiniciar demo</Text>
          </TouchableOpacity>
        </View>
      )}

      <FlatList
        data={visits}
        keyExtractor={v => v.id}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={renderEmpty}
        renderItem={({ item }) => {
          const convenience = getVisitConvenienceFields(
            item,
            catalog?.fields ?? (item.demoOnly ? demoFields : []),
          );
          return (
          <TouchableOpacity
            testID={`visit-card-${item.id}`}
            onPress={() => router.push(`/visit/${item.id}`)}
            activeOpacity={0.7}
          >
            <Card style={styles.visitCard}>
              <View style={styles.cardHeader}>
                <Text style={[styles.siteName, { color: colors.foreground }]}>
                  {item.siteName || convenience.siteName || convenience.siteId || 'Sitio sin nombre'}
                </Text>
                <View style={{ gap: 4, alignItems: 'flex-end' }}>
                  <Badge
                    text={item.lifecycleStatus}
                    customColor={{
                      bg: getLifecycleColor(item.lifecycleStatus),
                      text: '#FFF'
                    }}
                  />
                  {item.demoOnly && (
                    <Badge
                      text="FICTICIA"
                      customColor={{ bg: colors.warning, text: '#422006' }}
                    />
                  )}
                  <Badge
                    text={item.syncStatus}
                    customColor={{
                      bg: getSyncColor(item.syncStatus),
                      text: '#FFF'
                    }}
                  />
                </View>
              </View>
              
              <View style={styles.cardBody}>
                <View style={styles.infoRow}>
                  <Feather name="hash" size={14} color={colors.mutedForeground} />
                  <Text style={[styles.infoText, { color: colors.mutedForeground }]}>
                    OT: {item.workOrder || convenience.workOrder || 'N/A'}
                  </Text>
                </View>
                <View style={styles.infoRow}>
                  <Feather name="calendar" size={14} color={colors.mutedForeground} />
                  <Text style={[styles.infoText, { color: colors.mutedForeground }]}>
                    {new Date(item.visitDate).toLocaleDateString()}
                  </Text>
                </View>
                <View style={styles.infoRow}>
                  <Feather name="alert-circle" size={14} color={item.findings.length > 0 ? colors.warning : colors.mutedForeground} />
                  <Text style={[styles.infoText, { color: item.findings.length > 0 ? colors.warning : colors.mutedForeground }]}>
                    {item.findings.length} hallazgos
                  </Text>
                </View>
                {item.syncStatus === 'ERROR' && item.syncError && (
                  <Text style={[styles.syncError, { color: colors.destructive }]} numberOfLines={2}>
                    {item.syncError}
                  </Text>
                )}
              </View>
            </Card>
          </TouchableOpacity>
          );
        }}
      />

      <View style={[styles.footer, { backgroundColor: colors.card, borderTopColor: colors.border, paddingBottom: Math.max(insets.bottom, 16) }]}>
        {!catalog && (
          <Button
            testID="btn-load-template"
            title="Cargar mi formato Excel"
            icon={<Feather name="upload" size={17} color="#FFF" />}
            onPress={() => void handleLoadTemplate()}
            loading={isImportingTemplate}
            disabled={isImportingTemplate}
          />
        )}
        {!catalog && (
          <Button
            testID="btn-demo-visit"
            title="Probar con datos de ejemplo"
            variant="outline"
            icon={<Feather name="play-circle" size={17} color={colors.foreground} />}
            onPress={() => void handleResetDemo()}
          />
        )}
        <Button
          title="Administración de plantilla"
          variant="ghost"
          icon={<Feather name="settings" size={17} color={colors.primary} />}
          onPress={() => router.push('/settings/template')}
        />
        {catalog && (
          <Button
            title="Descargar formato oficial"
            variant="outline"
            icon={<Feather name="download" size={17} color={colors.foreground} />}
            onPress={() => void handleDownloadBlankTemplate()}
            loading={isDownloadingTemplate}
            disabled={isDownloadingTemplate || !sourceBase64}
          />
        )}
        {catalog && (
          <Button
            testID="btn-start-visit"
            title="Nueva visita"
            icon={<Feather name="plus" size={20} color="#FFF" />}
            onPress={handleStartVisit}
            size="lg"
          />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  headerStatus: {
    padding: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  statusText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 14,
  },
  authBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    padding: 6,
  },
  authText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
  },
  syncBar: {
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  templateBanner: {
    marginHorizontal: 16,
    marginTop: 12,
    padding: 12,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  templateBannerText: {
    color: '#FFF',
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
    flex: 1,
  },
  syncText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
  },
  demoBanner: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  demoCopy: {
    flex: 1,
  },
  demoTitle: {
    color: '#422006',
    fontFamily: 'Inter_700Bold',
    fontSize: 12,
  },
  demoText: {
    color: '#7C2D12',
    fontFamily: 'Inter_400Regular',
    fontSize: 11,
    marginTop: 2,
  },
  demoReset: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(255,255,255,0.55)',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  demoResetText: {
    color: '#7C2D12',
    fontFamily: 'Inter_600SemiBold',
    fontSize: 11,
  },
  listContent: {
    padding: 16,
    gap: 12,
    paddingBottom: 100,
    width: '100%',
    maxWidth: 760,
    alignSelf: 'center',
  },
  visitCard: {
    padding: 16,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  siteName: {
    fontFamily: 'Inter_700Bold',
    fontSize: 16,
    flex: 1,
    marginRight: 8,
  },
  cardBody: {
    gap: 8,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  infoText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
  },
  syncError: {
    fontFamily: 'Inter_500Medium',
    fontSize: 12,
    lineHeight: 17,
    marginTop: 4,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
  emptyIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 18,
    marginBottom: 8,
  },
  emptyDesc: {
    fontSize: 14,
    textAlign: 'center',
    paddingHorizontal: 32,
    lineHeight: 20,
  },
  footer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 16,
    borderTopWidth: 1,
  }
});
