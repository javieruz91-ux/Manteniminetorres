import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useVisits } from '@/context/VisitContext';
import { useColors } from '@/hooks/useColors';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import type { ChecklistStatus, TemplateField } from '@/types';

const statusOptions: Array<{ value: ChecklistStatus; label: string; icon: any }> = [
  { value: 'OK', label: 'OK', icon: 'check' },
  { value: 'NOK', label: 'NOK', icon: 'x' },
  { value: 'SC', label: 'S/C', icon: 'minus' },
  { value: 'NA', label: 'N/A', icon: 'slash' },
];

export default function VisitDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { getVisit, updateResponse, updatePointStatus } = useVisits();
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [search, setSearch] = useState('');
  const visit = getVisit(id);

  const fields = visit?.templateFields ?? [];
  const visibleFields = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    if (!query) return fields;
    return fields.filter(field =>
      [field.label, field.fullText, field.sheet, field.section, field.subsection]
        .filter(Boolean)
        .some(value => String(value).toLocaleLowerCase().includes(query)),
    );
  }, [fields, search]);
  const groups = useMemo(() => {
    const grouped = new Map<string, TemplateField[]>();
    for (const field of visibleFields) {
      const key = `${field.sheet}\u0000${field.section || field.sheet}\u0000${field.subsection || ''}`;
      grouped.set(key, [...(grouped.get(key) || []), field]);
    }
    return [...grouped.entries()];
  }, [visibleFields]);

  if (!visit) {
    return <View style={[styles.center, { backgroundColor: colors.background }]}><Text style={{ color: colors.foreground }}>Visita no encontrada</Text></View>;
  }
  const editableFields = fields.filter(field => !field.isTitle && field.editable !== false);
  const completed = editableFields.filter(field => {
    if (field.type === 'status') {
      return visit.sections.some(section => section.points.some(point => point.id === field.id && point.status !== 'PENDING'));
    }
    const value = visit.responses[field.id];
    return value !== undefined && value !== null && String(value).trim() !== '';
  }).length;
  const progress = editableFields.length ? completed / editableFields.length : 0;
  const isReadOnly = visit.lifecycleStatus === 'CERRADA';

  const setValue = (field: TemplateField, value: unknown) => {
    if (!isReadOnly) void updateResponse(visit.id, field.id, value);
  };

  const statusFor = (fieldId: string): ChecklistStatus => {
    for (const section of visit.sections) {
      const point = section.points.find(candidate => candidate.id === fieldId);
      if (point) return point.status;
    }
    return 'PENDING';
  };

  const chooseStatus = async (field: TemplateField, status: ChecklistStatus) => {
    if (isReadOnly) return;
    const owner = visit.sections.find(section => section.points.some(point => point.id === field.id));
    if (!owner) return;
    if (status === 'NOK') {
      await updateResponse(visit.id, field.id, status);
      router.push({
        pathname: `/visit/${visit.id}/finding/${field.id}` as any,
        params: { sectionId: owner.id },
      });
    } else {
      await updatePointStatus(visit.id, owner.id, field.id, status);
      await updateResponse(visit.id, field.id, status);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom, 36) }]}>
        {!visit.template && (
          <Card style={[styles.card, { borderColor: colors.destructive, borderWidth: 1 }]}>
            <Text style={[styles.missing, { color: colors.destructive }]}>Falta cargar la plantilla Excel original</Text>
            <Text style={{ color: colors.mutedForeground }}>Esta visita no tiene un catálogo importado y no puede evaluarse ni exportarse.</Text>
            <Button title="Configurar plantilla" onPress={() => router.push('/settings/template')} variant="outline" />
          </Card>
        )}
        <Card style={styles.card}>
          <View style={styles.titleRow}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.title, { color: colors.foreground }]}>Captura de visita</Text>
              <Text style={{ color: colors.mutedForeground }}>
                {visit.template ? `Plantilla ${visit.template.version} · ${visit.template.hash.slice(0, 12)}` : 'Sin plantilla fijada'}
              </Text>
            </View>
            {isReadOnly && <Text style={{ color: colors.warning }}>Solo lectura</Text>}
          </View>
          <TextInput
            testID="field-search"
            value={search}
            onChangeText={setSearch}
            placeholder="Buscar campo, hoja o sección"
            placeholderTextColor={colors.mutedForeground}
            style={[styles.search, { color: colors.foreground, borderColor: colors.border }]}
          />
          <View style={styles.progressHeader}>
            <Text style={{ color: colors.foreground }}>Progreso de campos</Text>
            <Text style={{ color: colors.primary, fontFamily: 'Inter_700Bold' }}>{completed}/{editableFields.length}</Text>
          </View>
          <View style={[styles.progressBg, { backgroundColor: colors.muted }]}>
            <View style={[styles.progressFill, { width: `${progress * 100}%`, backgroundColor: colors.primary }]} />
          </View>
        </Card>

        {fields.length === 0 ? (
          <Card style={styles.card}><Text style={{ color: colors.mutedForeground }}>No hay campos importados para esta visita.</Text></Card>
        ) : groups.length === 0 ? (
          <Card style={styles.card}><Text style={{ color: colors.mutedForeground }}>No hay resultados para la búsqueda.</Text></Card>
        ) : groups.map(([key, group]) => {
          const [sheet, section, subsection] = key.split('\u0000');
          return (
            <Card key={key} style={styles.card}>
              <Text style={[styles.groupTitle, { color: colors.foreground }]}>{sheet}</Text>
              <Text style={[styles.groupSubtitle, { color: colors.mutedForeground }]}>{section}{subsection ? ` · ${subsection}` : ''}</Text>
              {group.map(field => (
                <FieldRenderer
                  key={field.id}
                  field={field}
                  value={visit.responses[field.id]}
                  status={statusFor(field.id)}
                  readOnly={isReadOnly}
                  colors={colors}
                  onValue={(value: unknown) => setValue(field, value)}
                  onStatus={(status: ChecklistStatus) => void chooseStatus(field, status)}
                  hasFinding={visit.findings.some(finding => finding.pointId === field.id)}
                />
              ))}
            </Card>
          );
        })}

        <View style={styles.actionRow}>
          <Button title={`Hallazgos (${visit.findings.length})`} variant="secondary" style={{ flex: 1 }} icon={<Feather name="alert-triangle" size={18} color={colors.foreground} />} onPress={() => router.push(`/visit/${visit.id}/findings`)} />
          <Button title="Resumen y Cierre" style={{ flex: 1 }} icon={<Feather name="file-text" size={18} color="#FFF" />} onPress={() => router.push(`/visit/${visit.id}/summary`)} />
        </View>
      </ScrollView>
    </View>
  );
}

function FieldRenderer({ field, value, status, readOnly, colors, onValue, onStatus, hasFinding }: any) {
  if (field.isTitle || field.editable === false) {
    return <Text style={[styles.heading, { color: colors.foreground }]}>{field.label}</Text>;
  }
  if (field.type === 'status') {
    return (
      <View style={styles.field}>
        <View style={styles.fieldLabelRow}>
          <Text style={[styles.label, { color: colors.foreground }]}>{field.label}</Text>
          {hasFinding && <Feather name="alert-triangle" size={16} color={colors.warning} />}
        </View>
        <View style={styles.options}>
          {statusOptions.map(option => {
            const selected = status === option.value;
            const tint = option.value === 'OK' ? colors.success : option.value === 'NOK' ? colors.destructive : option.value === 'SC' ? colors.warning : colors.na;
            return (
              <TouchableOpacity
                key={option.value}
                testID={`status-${field.id}-${option.value}`}
                disabled={readOnly}
                onPress={() => onStatus(option.value)}
                style={[styles.status, { borderColor: selected ? tint : colors.border, backgroundColor: selected ? tint : colors.background, opacity: readOnly && !selected ? 0.5 : 1 }]}
              >
                <Feather name={option.icon} size={14} color={selected ? '#FFF' : colors.mutedForeground} />
                <Text style={{ color: selected ? '#FFF' : colors.mutedForeground, fontFamily: 'Inter_600SemiBold' }}>{option.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
        {status === 'NOK' && <Text style={{ color: colors.destructive, fontSize: 12 }}>Se requiere registrar un hallazgo.</Text>}
      </View>
    );
  }
  if (field.type === 'selection') {
    return (
      <View style={styles.field}>
        <Text style={[styles.label, { color: colors.foreground }]}>{field.label}</Text>
        <View style={styles.options}>
          {(field.options || []).map((option: string) => (
            <TouchableOpacity key={option} disabled={readOnly} onPress={() => onValue(option)} style={[styles.choice, { borderColor: value === option ? colors.primary : colors.border, backgroundColor: value === option ? colors.primary : colors.background }]}>
              <Text style={{ color: value === option ? '#FFF' : colors.foreground }}>{option}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
    );
  }
  const multiline = field.type === 'observation';
  return (
    <Input
      label={`${field.label}${field.required ? ' *' : ''}`}
      value={value == null ? '' : String(value)}
      editable={!readOnly}
      multiline={multiline}
      numberOfLines={multiline ? 4 : 1}
      keyboardType={field.type === 'number' || field.type === 'measurement' ? 'decimal-pad' : 'default'}
      onChangeText={onValue}
      placeholder={field.type === 'date' ? 'AAAA-MM-DD' : undefined}
      style={multiline ? { minHeight: 96, textAlignVertical: 'top', paddingTop: 12 } : undefined}
    />
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 16, width: '100%', maxWidth: 900, alignSelf: 'center' },
  card: { padding: 16, gap: 10 },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start' },
  title: { fontSize: 22, fontFamily: 'Inter_700Bold' },
  missing: { fontFamily: 'Inter_700Bold', fontSize: 16 },
  search: { height: 46, borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, marginTop: 8 },
  progressHeader: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  progressBg: { height: 8, borderRadius: 4, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 4 },
  groupTitle: { fontSize: 18, fontFamily: 'Inter_700Bold' },
  groupSubtitle: { fontSize: 14, marginBottom: 6 },
  heading: { fontSize: 17, fontFamily: 'Inter_700Bold', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#E2E8F0' },
  field: { gap: 8, paddingVertical: 8 },
  label: { fontFamily: 'Inter_600SemiBold', fontSize: 15 },
  fieldLabelRow: { flexDirection: 'row', justifyContent: 'space-between' },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  status: { borderWidth: 1, borderRadius: 8, paddingVertical: 10, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 5 },
  choice: { borderWidth: 1, borderRadius: 8, paddingVertical: 10, paddingHorizontal: 12 },
  actionRow: { flexDirection: 'row', gap: 12 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
});