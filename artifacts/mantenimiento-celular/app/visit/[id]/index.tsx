import React, { useMemo, useState } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useVisits } from '@/context/VisitContext';
import { useColors } from '@/hooks/useColors';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { useTemplate } from '@/context/TemplateContext';
import { createDemoCatalog } from '@/lib/demoTemplate';
import type { ChecklistStatus, Finding, TemplateField } from '@/types';
import {
  buildCapturePages,
  catalogQuestions,
  completedQuestionCount,
  currentSectionQuestionIds,
  DEFAULT_PAGE_SIZE,
  filterCaptureQuestions,
  presentationFields,
  PRESENTATION_SHEET,
  questionnaireSections,
  questionnaireSheets,
  questionObservationId,
  responseIsComplete,
  sectionQuestions,
  type CapturePage,
  type CaptureQuestion,
} from '@/utils/catalogNavigation';

const statusOptions: Array<{ value: ChecklistStatus; label: string; icon: any }> = [
  { value: 'OK', label: 'OK', icon: 'check' },
  { value: 'NOK', label: 'NOK', icon: 'x' },
  { value: 'SC', label: 'SC', icon: 'minus' },
  { value: 'NA', label: 'NA', icon: 'slash' },
];

function newFinding(questionId: string, sectionId: string): Finding {
  return {
    id: `finding:${questionId}`,
    pointId: questionId,
    sectionId,
    description: '',
    responsible: '',
    priority: 'MEDIA',
    startDate: new Date().toISOString().slice(0, 10),
    commitmentDate: '',
    completedDate: null,
    photos: [],
    state: 'ABIERTO',
  };
}

function fieldMatchesSearch(field: TemplateField, search: string): boolean {
  const query = search.trim().toLocaleLowerCase();
  if (!query) return true;
  return [field.label, field.fullText, field.sheet, field.section, field.subsection]
    .filter(Boolean)
    .some(value => String(value).toLocaleLowerCase().includes(query));
}

export default function VisitDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const {
    getVisit,
    updateResponse,
    updatePointStatus,
    saveFindingAndStatus,
    migrateVisitToActiveTemplate,
  } = useVisits();
  const { catalog } = useTemplate();
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [selectedSheet, setSelectedSheet] = useState(PRESENTATION_SHEET);
  const [selectedSection, setSelectedSection] = useState('');
  const [pageIndex, setPageIndex] = useState(0);
  const [search, setSearch] = useState('');
  const visit = getVisit(id);

  const activeFields = catalog?.fields ?? (visit?.demoOnly ? createDemoCatalog().fields : []);
  const allQuestions = useMemo(() => catalogQuestions(activeFields), [activeFields]);
  const sheets = useMemo(
    () => [PRESENTATION_SHEET, ...questionnaireSheets(activeFields)],
    [activeFields],
  );
  const availableSections = useMemo(
    () => selectedSheet === PRESENTATION_SHEET
      ? ['Datos generales']
      : questionnaireSections(allQuestions, selectedSheet),
    [allQuestions, selectedSheet],
  );
  const activeSection = selectedSection && availableSections.includes(selectedSection)
    ? selectedSection
    : availableSections[0] ?? selectedSheet;
  const pages = useMemo<CapturePage[]>(
    () => buildCapturePages(activeFields, {
      sheet: selectedSheet,
      section: activeSection,
      search,
      pageSize: DEFAULT_PAGE_SIZE,
    }),
    [activeFields, activeSection, search, selectedSheet],
  );
  const safePageIndex = Math.min(pageIndex, Math.max(0, pages.length - 1));
  const currentPage = pages[safePageIndex];

  if (!visit) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <Text style={{ color: colors.foreground }}>Visita no encontrada</Text>
      </View>
    );
  }

  const isReadOnly = visit.lifecycleStatus === 'CERRADA';
  const realQuestionCount = allQuestions.length;
  const completed = completedQuestionCount(allQuestions, visit);
  const currentQuestions = selectedSheet === PRESENTATION_SHEET
    ? []
    : sectionQuestions(activeFields, selectedSheet, activeSection);
  const currentCompleted = completedQuestionCount(currentQuestions, visit);
  const progress = realQuestionCount ? completed / realQuestionCount : 0;
  const currentProgress = currentQuestions.length ? currentCompleted / currentQuestions.length : 0;
  const duplicateIds = new Set(allQuestions.map(question => question.field.id)).size !== allQuestions.length;
  const integrityError = !catalog && !visit.demoOnly
    ? 'No hay una plantilla activa para esta visita.'
    : duplicateIds
      ? 'El catálogo contiene preguntas duplicadas.'
      : null;

  const statusFor = (questionId: string): ChecklistStatus => {
    for (const section of visit.sections) {
      const point = section.points.find(candidate => candidate.id === questionId);
      if (point) return point.status;
    }
    const response = visit.responses[questionId];
    return ['OK', 'NOK', 'SC', 'NA'].includes(String(response))
      ? response as ChecklistStatus
      : 'PENDING';
  };

  const sectionForQuestion = (questionId: string) =>
    visit.sections.find(section => section.points.some(point => point.id === questionId));

  const chooseStatus = async (question: CaptureQuestion, status: ChecklistStatus) => {
    if (isReadOnly) return;
    const owner = sectionForQuestion(question.field.id);
    if (!owner) return;
    const existing = visit.findings.find(finding => finding.pointId === question.field.id);
    if (status === 'NOK' || status === 'SC') {
      await saveFindingAndStatus(
        visit.id,
        question.field.id,
        owner.id,
        status,
        existing ?? newFinding(question.field.id, owner.id),
      );
    } else {
      await updatePointStatus(visit.id, owner.id, question.field.id, status);
    }
    await updateResponse(visit.id, question.field.id, status);
  };

  const markRemainingOk = () => {
    if (selectedSheet === PRESENTATION_SHEET || isReadOnly) return;
    Alert.alert(
      'Marcar sección como OK',
      `Se marcarán como OK las ${currentQuestions.length - currentCompleted} preguntas pendientes de ${activeSection}.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Marcar como OK',
          onPress: () => {
            void (async () => {
              for (const questionId of currentSectionQuestionIds(activeFields, selectedSheet, activeSection)) {
                if (statusFor(questionId) !== 'PENDING') continue;
                const owner = sectionForQuestion(questionId);
                if (!owner) continue;
                await updatePointStatus(visit.id, owner.id, questionId, 'OK');
                await updateResponse(visit.id, questionId, 'OK');
              }
            })();
          },
        },
      ],
    );
  };

  const selectSheet = (sheet: string) => {
    setSelectedSheet(sheet);
    setSelectedSection('');
    setPageIndex(0);
  };

  const selectSection = (section: string) => {
    setSelectedSection(section);
    setPageIndex(0);
  };

  const selectSearch = (value: string) => {
    setSearch(value);
    setPageIndex(0);
  };

  const goNext = () => {
    if (safePageIndex < pages.length - 1) {
      setPageIndex(safePageIndex + 1);
      return;
    }
    const sheetIndex = sheets.indexOf(selectedSheet);
    if (sheetIndex < sheets.length - 1) {
      selectSheet(sheets[sheetIndex + 1]);
      return;
    }
    router.push(`/visit/${visit.id}/summary`);
  };

  const goPrevious = () => {
    if (safePageIndex > 0) {
      setPageIndex(safePageIndex - 1);
      return;
    }
    const sheetIndex = sheets.indexOf(selectedSheet);
    if (sheetIndex > 0) {
      const previousSheet = sheets[sheetIndex - 1];
      const previousSections = previousSheet === PRESENTATION_SHEET
        ? ['Datos generales']
        : questionnaireSections(allQuestions, previousSheet);
      setSelectedSheet(previousSheet);
      setSelectedSection(previousSections.at(-1) ?? '');
      setPageIndex(0);
    }
  };

  const handleMigrate = async () => {
    try {
      await migrateVisitToActiveTemplate(visit.id);
      Alert.alert('Visita actualizada', 'Se conservaron las respuestas y se cargó el catálogo completo.');
    } catch (error) {
      Alert.alert('No se pudo actualizar', error instanceof Error ? error.message : 'Carga primero la plantilla activa.');
    }
  };

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom, 32) }]}
        keyboardShouldPersistTaps="handled"
      >
        <Card style={styles.hero}>
          <View style={styles.titleRow}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.title, { color: colors.foreground }]}>Captura de mantenimiento</Text>
              <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
                Se guarda automáticamente en este dispositivo.
              </Text>
            </View>
            {isReadOnly && <Text style={{ color: colors.warning }}>Solo lectura</Text>}
          </View>
          <TextInput
            testID="field-search"
            value={search}
            onChangeText={selectSearch}
            placeholder="Buscar pregunta, hoja o sección"
            placeholderTextColor={colors.mutedForeground}
            style={[styles.search, { color: colors.foreground, borderColor: colors.border }]}
          />
          <View style={styles.progressHeader}>
            <Text style={{ color: colors.foreground }}>Progreso de preguntas reales</Text>
            <Text style={[styles.progressValue, { color: colors.primary }]}>{completed}/{realQuestionCount}</Text>
          </View>
          <View style={[styles.progressBackground, { backgroundColor: colors.muted }]}>
            <View style={[styles.progressFill, { width: `${progress * 100}%`, backgroundColor: colors.primary }]} />
          </View>
          {integrityError && <Text style={{ color: colors.destructive }}>{integrityError}</Text>}
          {visit.catalogMigrationNotice && (
            <View style={[styles.notice, { borderColor: colors.primary }]}>
              <Text style={{ color: colors.foreground, flex: 1 }}>{visit.catalogMigrationNotice}</Text>
              {catalog && <Button title="Actualizar catálogo" variant="outline" onPress={() => void handleMigrate()} />}
            </View>
          )}
        </Card>

        <Text style={[styles.selectorLabel, { color: colors.foreground }]}>Hoja</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          {sheets.map(sheet => (
            <TouchableOpacity
              key={sheet}
              testID={`sheet-${sheet}`}
              onPress={() => selectSheet(sheet)}
              style={[
                styles.chip,
                {
                  borderColor: selectedSheet === sheet ? colors.primary : colors.border,
                  backgroundColor: selectedSheet === sheet ? colors.primary : colors.card,
                },
              ]}
            >
              <Text style={{ color: selectedSheet === sheet ? colors.primaryForeground : colors.foreground, fontFamily: 'Inter_600SemiBold' }}>
                {sheet === PRESENTATION_SHEET ? 'Datos generales' : sheet}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {availableSections.length > 1 && (
          <>
            <Text style={[styles.selectorLabel, { color: colors.foreground }]}>Sección</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
              {availableSections.map(section => (
                <TouchableOpacity
                  key={section}
                  testID={`section-${section}`}
                  onPress={() => selectSection(section)}
                  style={[
                    styles.sectionChip,
                    {
                      borderColor: activeSection === section ? colors.primary : colors.border,
                      backgroundColor: activeSection === section ? colors.primary : colors.card,
                    },
                  ]}
                >
                  <Text style={{ color: activeSection === section ? colors.primaryForeground : colors.foreground }}>
                    {section}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </>
        )}

        <Card style={styles.pageCard}>
          <View style={styles.pageHeader}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.pageTitle, { color: colors.foreground }]}>
                {selectedSheet === PRESENTATION_SHEET ? 'Datos generales' : activeSection}
              </Text>
              <Text style={{ color: colors.mutedForeground }}>
                {pages.length ? `Grupo ${safePageIndex + 1} de ${pages.length}` : 'Sin resultados'}
                {selectedSheet !== PRESENTATION_SHEET ? ` · ${currentCompleted}/${currentQuestions.length} de esta sección` : ''}
              </Text>
            </View>
            <Text style={{ color: colors.primary, fontFamily: 'Inter_700Bold' }}>
              {currentPage?.questions.length ?? 0} visibles
            </Text>
          </View>

          {currentPage ? currentPage.questions.map(question => (
            <CaptureCard
              key={question.field.id}
              question={question}
              visit={visit}
              status={statusFor(question.field.id)}
              readOnly={isReadOnly}
              colors={colors}
              onStatus={status => void chooseStatus(question, status)}
               onFinding={() => {
                 const owner = sectionForQuestion(question.field.id);
                 if (!owner) return;
                 router.push({
                   pathname: `/visit/${visit.id}/finding/${question.field.id}` as any,
                   params: { sectionId: owner.id, status: statusFor(question.field.id) },
                 });
               }}
              onValue={(fieldId, value) => {
                if (!isReadOnly) void updateResponse(visit.id, fieldId, value);
              }}
            />
          )) : (
            <Text style={{ color: colors.mutedForeground }}>
              No hay preguntas que coincidan con la búsqueda.
            </Text>
          )}
        </Card>

        {selectedSheet !== PRESENTATION_SHEET && (
          <Button
            title={`Marcar pendientes de “${activeSection}” como OK`}
            variant="outline"
            icon={<Feather name="check-square" size={18} color={colors.foreground} />}
            onPress={markRemainingOk}
            disabled={isReadOnly || currentQuestions.length === 0}
          />
        )}

        <View style={styles.navigationRow}>
          <Button
            title="Anterior"
            variant="outline"
            style={{ flex: 1 }}
            icon={<Feather name="arrow-left" size={18} color={colors.foreground} />}
            onPress={goPrevious}
            disabled={selectedSheet === PRESENTATION_SHEET && safePageIndex === 0}
          />
          <Button
            title="Siguiente"
            style={{ flex: 1 }}
            icon={<Feather name="arrow-right" size={18} color={colors.primaryForeground} />}
            onPress={goNext}
          />
        </View>
        <Button
          title="Guardar y continuar después"
          variant="ghost"
          icon={<Feather name="save" size={18} color={colors.primary} />}
          onPress={() => router.replace('/')}
        />
        <Button
          title={`Revisar resumen (${realQuestionCount} preguntas)`}
          variant="secondary"
          onPress={() => router.push(`/visit/${visit.id}/summary`)}
        />
      </ScrollView>
    </View>
  );
}

function CaptureCard({
  question,
  visit,
  status,
  readOnly,
  colors,
  onStatus,
  onFinding,
  onValue,
}: {
  question: CaptureQuestion;
  visit: ReturnType<ReturnType<typeof useVisits>['getVisit']> & {};
  status: ChecklistStatus;
  readOnly: boolean;
  colors: any;
  onStatus: (status: ChecklistStatus) => void;
  onFinding: () => void;
  onValue: (fieldId: string, value: unknown) => void;
}) {
  if (!visit) return null;
  const { field, additionalFields } = question;
  const finding = visit.findings.find(candidate => candidate.pointId === field.id);
  return (
    <View testID={`question-card-${field.id}`} style={[styles.questionCard, { borderColor: colors.border, backgroundColor: colors.card }]}>
      <View style={styles.questionTitleRow}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.questionLabel, { color: colors.foreground }]}>{field.label}</Text>
          <Text style={[styles.questionMeta, { color: colors.mutedForeground }]}>
            {field.section || field.sheet}
          </Text>
        </View>
        {finding && <Feather name="alert-triangle" size={18} color={colors.warning} />}
      </View>
      {field.type === 'status' && (
        <View style={styles.statusRow}>
          {statusOptions.map(option => {
            const selected = status === option.value;
            const tint = option.value === 'OK'
              ? colors.success
              : option.value === 'NOK'
                ? colors.destructive
                : option.value === 'SC'
                  ? colors.warning
                  : colors.na;
            return (
              <TouchableOpacity
                key={option.value}
                testID={`status-${field.id}-${option.value}`}
                disabled={readOnly}
                onPress={() => onStatus(option.value)}
                style={[
                  styles.statusButton,
                  {
                    borderColor: selected ? tint : colors.border,
                    backgroundColor: selected ? tint : colors.background,
                    opacity: readOnly && !selected ? 0.5 : 1,
                  },
                ]}
              >
                <Text style={{ color: selected ? colors.primaryForeground : colors.foreground, fontFamily: 'Inter_700Bold' }}>
                  {option.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )}
      <Input
        label="Observación"
        value={String(visit.responses[questionObservationId(field.id)] ?? '')}
        editable={!readOnly}
        multiline
        numberOfLines={2}
        onChangeText={value => onValue(questionObservationId(field.id), value)}
        placeholder="Escribe una observación breve"
        style={styles.observation}
      />
      {additionalFields.map(additional => (
        <AdditionalField
          key={additional.id}
          field={additional}
          value={visit.responses[additional.id]}
          readOnly={readOnly}
          colors={colors}
          onValue={value => onValue(additional.id, value)}
        />
      ))}
      {(status === 'NOK' || status === 'SC') && (
        <View style={styles.findingBox}>
          <Text style={[styles.findingHint, { color: colors.warning }]}>
            Este punto requiere una descripción y al menos una fotografía.
          </Text>
          <Button
            title={finding?.description && finding.photos.length ? 'Editar hallazgo' : 'Completar hallazgo'}
            variant="outline"
            onPress={onFinding}
            disabled={readOnly}
          />
        </View>
      )}
    </View>
  );
}

function AdditionalField({
  field,
  value,
  readOnly,
  colors,
  onValue,
}: {
  field: TemplateField;
  value: unknown;
  readOnly: boolean;
  colors: any;
  onValue: (value: unknown) => void;
}) {
  if (field.type === 'selection' && field.options?.length) {
    return (
      <View style={styles.additionalBlock}>
        <Text style={[styles.additionalLabel, { color: colors.foreground }]}>{field.label}</Text>
        <View style={styles.statusRow}>
          {field.options.map(option => (
            <TouchableOpacity
              key={option}
              disabled={readOnly}
              onPress={() => onValue(option)}
              style={[
                styles.additionalChoice,
                {
                  borderColor: value === option ? colors.primary : colors.border,
                  backgroundColor: value === option ? colors.primary : colors.background,
                },
              ]}
            >
              <Text style={{ color: value === option ? colors.primaryForeground : colors.foreground }}>{option}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
    );
  }
  return (
    <Input
      label={field.label}
      value={value == null ? '' : String(value)}
      editable={!readOnly}
      keyboardType={field.type === 'number' || field.type === 'measurement' ? 'decimal-pad' : 'default'}
      onChangeText={onValue}
    />
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: 16, gap: 14, width: '100%', maxWidth: 900, alignSelf: 'center' },
  hero: { padding: 16, gap: 12 },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  title: { fontSize: 24, fontFamily: 'Inter_700Bold' },
  subtitle: { fontSize: 14, lineHeight: 20, marginTop: 4 },
  search: { height: 48, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, fontSize: 16 },
  progressHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  progressValue: { fontFamily: 'Inter_700Bold', fontSize: 16 },
  progressBackground: { height: 8, borderRadius: 4, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 4 },
  notice: { borderWidth: 1, borderRadius: 10, padding: 10, gap: 8 },
  selectorLabel: { fontFamily: 'Inter_700Bold', fontSize: 16 },
  chipRow: { gap: 8, paddingVertical: 2 },
  chip: { borderWidth: 1, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 11 },
  sectionChip: { borderWidth: 1, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 9 },
  pageCard: { padding: 12, gap: 12 },
  pageHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 4 },
  pageTitle: { fontSize: 20, fontFamily: 'Inter_700Bold' },
  questionCard: { borderWidth: 1, borderRadius: 14, padding: 14, gap: 10 },
  questionTitleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  questionLabel: { fontSize: 16, lineHeight: 22, fontFamily: 'Inter_700Bold' },
  questionMeta: { fontSize: 12, marginTop: 3 },
  statusRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  statusButton: { minWidth: 62, minHeight: 48, borderWidth: 1, borderRadius: 10, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  additionalBlock: { gap: 8 },
  additionalLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  additionalChoice: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10 },
  observation: { minHeight: 72, textAlignVertical: 'top', paddingTop: 12 },
  findingHint: { fontSize: 13, lineHeight: 18 },
  findingBox: { gap: 8, marginTop: 2 },
  navigationRow: { flexDirection: 'row', gap: 10 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
});