import React, { useMemo, useState } from 'react';
import {
  Alert,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { File } from 'expo-file-system';
import { Feather } from '@expo/vector-icons';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Input } from '@/components/Input';
import { useColors } from '@/hooks/useColors';
import { useAuth } from '@/lib/auth';
import { useTemplate } from '@/context/TemplateContext';
import { MIME_XLSX, type TemplateMapping, validateTemplateMappings } from '@/lib/templateApi';
import type { TemplateEvidenceSlot, TemplateFieldType } from '@/types';

const TYPES: TemplateFieldType[] = [
  'text',
  'number',
  'date',
  'selection',
  'measurement',
  'observation',
  'status',
];

function bytesToBase64(bytes: Uint8Array): string {
  let result = '';
  const chunk = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    result += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
  }
  return btoa(result);
}

async function pickXlsx(): Promise<{ name: string; base64: string } | null> {
  if (Platform.OS === 'web') {
    return new Promise(resolve => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) return resolve(null);
        if (!file.name.toLowerCase().endsWith('.xlsx')) {
          Alert.alert('Formato no válido', 'Solo se acepta un archivo .xlsx.');
          return resolve(null);
        }
        resolve({ name: file.name, base64: bytesToBase64(new Uint8Array(await file.arrayBuffer())) });
      };
      input.click();
    });
  }
  const result = await File.pickFileAsync({ mimeTypes: [MIME_XLSX] });
  if (result.canceled) return null;
  const file = result.result;
  if (!file) return null;
  const name = file.name || 'plantilla.xlsx';
  if (!name.toLowerCase().endsWith('.xlsx')) {
    Alert.alert('Formato no válido', 'Solo se acepta un archivo .xlsx.');
    return null;
  }
  return { name, base64: bytesToBase64(new Uint8Array(await file.arrayBuffer())) };
}

type DraftMapping = TemplateMapping & { ignored: boolean };

export default function TemplateSettingsScreen() {
  const colors = useColors();
  const router = useRouter();
  const { isAuthenticated, login } = useAuth();
  const { catalog, isLoading, error, upload, saveMappings } = useTemplate();
  const [busy, setBusy] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, DraftMapping>>({});

  const unmapped = catalog?.descriptor.unmappedCells ?? [];
  const initialized = useMemo(() => {
    const next: Record<string, DraftMapping> = {};
    for (const cell of unmapped) {
      next[cell.id] = drafts[cell.id] ?? {
        id: cell.id,
        candidateTarget: cell.target || `${cell.sheet}!${cell.cell}`,
        label: cell.fullText || cell.value || '',
        fullText: cell.fullText || cell.value || '',
        sheet: cell.sheet,
        section: '',
        subsection: '',
        type: 'text',
        evidenceSlot: 'photo',
        options: [],
        required: false,
        applicability: '',
        target: { cell: cell.cell },
        ignored: false,
      };
    }
    return next;
  }, [catalog, drafts, unmapped]);
  const unresolved = unmapped.filter(cell => !initialized[cell.id]?.ignored);
  const hasUnmapped = unresolved.length > 0;
  const ready = Boolean(catalog?.descriptor.ready && !hasUnmapped);
  const draftValues = Object.values(initialized).map(({ ignored, ...mapping }) => ({
    ...mapping,
    ignore: ignored,
    ignoreReason: ignored ? mapping.ignoreReason : undefined,
  }));
  const validationErrors = validateTemplateMappings(draftValues);

  const updateDraft = (id: string, patch: Partial<DraftMapping>) => {
    setDrafts(current => ({ ...current, [id]: { ...initialized[id], ...patch } }));
  };

  const chooseFile = async () => {
    if (!isAuthenticated) {
      await login();
      return;
    }
    if (catalog) {
      Alert.alert(
        'Reemplazar plantilla original',
        'Reemplazarla es destructivo: los nuevos borradores usarán otra versión. ¿Continuar?',
        [
          { text: 'Cancelar', style: 'cancel' },
          { text: 'Reemplazar', style: 'destructive', onPress: () => void doUpload(true) },
        ],
      );
      return;
    }
    await doUpload(false);
  };

  const doUpload = async (replace: boolean) => {
    const selected = await pickXlsx();
    if (!selected) return;
    setBusy(true);
    try {
      await upload({ fileName: selected.name, contentBase64: selected.base64, replace });
      setDrafts({});
      Alert.alert('Plantilla cargada', 'El servidor analizará el libro y mostrará la auditoría.');
    } catch (cause) {
      Alert.alert('No se pudo cargar', cause instanceof Error ? cause.message : 'Error desconocido');
    } finally {
      setBusy(false);
    }
  };

  const submitMappings = async () => {
    if (!catalog) return;
    if (validationErrors.length > 0) {
      Alert.alert('Mapeo incompleto', validationErrors[0].message);
      return;
    }
    setBusy(true);
    try {
      await saveMappings(draftValues);
      setDrafts({});
      Alert.alert('Mapeos guardados', 'La auditoría fue actualizada.');
    } catch (cause) {
      Alert.alert('No se pudieron guardar', cause instanceof Error ? cause.message : 'Error desconocido');
    } finally {
      setBusy(false);
    }
  };

  if (!isAuthenticated) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <Feather name="lock" size={36} color={colors.mutedForeground} />
        <Text style={[styles.title, { color: colors.foreground }]}>Configuración de plantilla</Text>
        <Text style={{ color: colors.mutedForeground, textAlign: 'center' }}>
          Inicia sesión como propietario para administrar la plantilla Excel original.
        </Text>
        <Button title="Iniciar sesión" onPress={login} style={styles.button} />
      </View>
    );
  }

  return (
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={styles.content}>
      <Card style={styles.card}>
        <Text style={[styles.title, { color: colors.foreground }]}>Plantilla Excel original</Text>
        <Text style={[styles.explanation, { color: colors.mutedForeground }]}>
          Esta plantilla es la única fuente del catálogo operativo. No se crean campos de ejemplo.
        </Text>
        {!catalog && !isLoading && (
          <Text style={[styles.missing, { color: colors.destructive }]}>
            Falta cargar la plantilla Excel original
          </Text>
        )}
        {error && <Text style={{ color: colors.destructive }}>{error}</Text>}
        <Button
          title={catalog ? 'Reemplazar plantilla (.xlsx)' : 'Cargar plantilla (.xlsx)'}
          onPress={chooseFile}
          loading={busy}
          icon={<Feather name="upload" size={18} color="#FFF" />}
        />
      </Card>

      {catalog && (
        <>
          <Card style={styles.card}>
            <Text style={[styles.heading, { color: colors.foreground }]}>Auditoría</Text>
            <AuditRow label="Archivo" value={catalog.descriptor.fileName} />
            <AuditRow label="Versión" value={catalog.descriptor.version} />
            <AuditRow label="Hash" value={catalog.descriptor.hash} />
            <AuditRow label="Fecha" value={catalog.descriptor.uploadedAt} />
            <AuditRow label="Totales" value={`${catalog.descriptor.sheets} hojas · ${catalog.descriptor.sections} secciones · ${catalog.descriptor.fields} campos`} />
            <Text style={{ color: ready ? colors.success : colors.warning, fontFamily: 'Inter_700Bold' }}>
              {ready ? 'LISTA PARA NUEVAS VISITAS' : 'NO LISTA · HAY CAMPOS SIN RESOLVER'}
            </Text>
          </Card>
          {unmapped.length > 0 && (
            <Card style={styles.card}>
              <Text style={[styles.heading, { color: colors.foreground }]}>
                Celdas editables sin mapear ({unmapped.length})
              </Text>
              <Text style={{ color: colors.mutedForeground, marginBottom: 12 }}>
                Cada celda debe mapearse o ignorarse con una razón explícita.
              </Text>
              {unmapped.map(cell => {
                const mapping = initialized[cell.id];
                const ignored = mapping.ignored;
                const setType = (type: TemplateFieldType) => updateDraft(cell.id, {
                  type,
                  options: type === 'status' ? ['OK', 'NOK', 'SC', 'NA'] : mapping.options,
                  evidenceSlot: type === 'observation' ? 'observation' : mapping.evidenceSlot || 'photo',
                });
                return (
                  <View key={cell.id} style={[styles.mapping, { borderColor: colors.border }]}>
                    <Text style={[styles.cellTitle, { color: colors.foreground }]}>
                      {cell.sheet} · {cell.cell} · {cell.fullText || cell.value || 'Sin texto'}
                    </Text>
                    <Input label="Etiqueta" value={mapping.label} editable={!ignored} onChangeText={label => updateDraft(cell.id, { label })} />
                    <Input label="Texto completo" value={mapping.fullText || ''} editable={!ignored} onChangeText={fullText => updateDraft(cell.id, { fullText })} />
                    <Input label="Sección" value={mapping.section} editable={!ignored} onChangeText={section => updateDraft(cell.id, { section })} />
                    <Input label="Subsección" value={mapping.subsection || ''} editable={!ignored} onChangeText={subsection => updateDraft(cell.id, { subsection })} />
                    <Text style={[styles.inputLabel, { color: colors.foreground }]}>Tipo</Text>
                    <View style={styles.typeOptions}>
                      {TYPES.map(type => (
                        <TouchableOpacity key={type} disabled={ignored} onPress={() => setType(type)} style={[styles.typeOption, { borderColor: mapping.type === type ? colors.primary : colors.border, backgroundColor: mapping.type === type ? colors.primary : colors.background }]}>
                          <Text style={{ color: mapping.type === type ? '#FFF' : colors.foreground, fontSize: 12 }}>{type}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                    <Input label="Opciones (separadas por coma)" value={(mapping.options || []).join(', ')} editable={!ignored} onChangeText={options => updateDraft(cell.id, { options: options.split(',').map(value => value.trim()).filter(Boolean) })} />
                    <Input label="Aplicabilidad" value={mapping.applicability || ''} editable={!ignored} onChangeText={applicability => updateDraft(cell.id, { applicability })} />
                    <Text style={[styles.inputLabel, { color: colors.foreground }]}>Evidencia</Text>
                    <View style={styles.typeOptions}>
                      {(['none', 'photo', 'observation'] as TemplateEvidenceSlot[]).map(slot => (
                        <TouchableOpacity key={slot} disabled={ignored} onPress={() => updateDraft(cell.id, { evidenceSlot: slot })} style={[styles.typeOption, { borderColor: mapping.evidenceSlot === slot ? colors.primary : colors.border, backgroundColor: mapping.evidenceSlot === slot ? colors.primary : colors.background }]}>
                          <Text style={{ color: mapping.evidenceSlot === slot ? '#FFF' : colors.foreground, fontSize: 12 }}>{slot}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                    <Input label="Celda o rango exacto" value={mapping.target.cell || mapping.target.range || ''} editable={!ignored} onChangeText={target => updateDraft(cell.id, { target: target.includes(':') ? { range: target } : { cell: target } })} />
                    <TouchableOpacity disabled={ignored} onPress={() => updateDraft(cell.id, { required: !mapping.required })} style={styles.checkbox}>
                      <Feather name={mapping.required ? 'check-square' : 'square'} size={20} color={mapping.required ? colors.primary : colors.mutedForeground} />
                      <Text style={{ color: colors.foreground }}>Campo obligatorio</Text>
                    </TouchableOpacity>
                    <TouchableOpacity testID={`ignore-${cell.id}`} onPress={() => updateDraft(cell.id, { ignored: !ignored, ignoreReason: ignored ? '' : mapping.ignoreReason })} style={styles.checkbox}>
                      <Feather name={ignored ? 'check-square' : 'square'} size={20} color={ignored ? colors.warning : colors.mutedForeground} />
                      <Text style={{ color: colors.foreground }}>Ignorar explícitamente</Text>
                    </TouchableOpacity>
                    {ignored && <Input label="Razón obligatoria" value={mapping.ignoreReason || ''} onChangeText={ignoreReason => updateDraft(cell.id, { ignoreReason })} />}
                  </View>
                );
              })}
              <Button title="Guardar mapeos" onPress={submitMappings} loading={busy} disabled={validationErrors.length > 0} />
            </Card>
          )}
        </>
      )}
      <Button title="Volver" variant="ghost" onPress={() => router.back()} />
    </ScrollView>
  );
}

function AuditRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.auditRow}>
      <Text style={styles.auditLabel}>{label}</Text>
      <Text style={styles.auditValue}>{value || '—'}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 16, paddingBottom: 40, width: '100%', maxWidth: 820, alignSelf: 'center' },
  card: { padding: 16, gap: 12 },
  title: { fontSize: 22, fontFamily: 'Inter_700Bold', marginBottom: 4 },
  heading: { fontSize: 18, fontFamily: 'Inter_700Bold' },
  explanation: { lineHeight: 20, marginBottom: 4 },
  missing: { fontFamily: 'Inter_700Bold', marginBottom: 4 },
  button: { marginTop: 16, minWidth: 180 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, gap: 12 },
  auditRow: { flexDirection: 'row', gap: 12, borderBottomWidth: 1, borderBottomColor: '#E2E8F0', paddingVertical: 8 },
  auditLabel: { width: 90, color: '#64748B', fontFamily: 'Inter_600SemiBold' },
  auditValue: { flex: 1, color: '#0F172A' },
  mapping: { borderWidth: 1, borderRadius: 8, padding: 12, marginTop: 8 },
  cellTitle: { fontFamily: 'Inter_700Bold', marginBottom: 8 },
  checkbox: { flexDirection: 'row', gap: 8, alignItems: 'center', paddingVertical: 8 },
  inputLabel: { fontFamily: 'Inter_500Medium', fontSize: 14, marginBottom: -2 },
  typeOptions: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 },
  typeOption: { borderWidth: 1, borderRadius: 7, paddingHorizontal: 8, paddingVertical: 7 },
});