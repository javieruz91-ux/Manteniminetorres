import React, { useState } from 'react';
import { View, Text, StyleSheet, Alert, Platform } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useVisits } from '@/context/VisitContext';
import { useColors } from '@/hooks/useColors';
import { Input } from '@/components/Input';
import { Button } from '@/components/Button';
import { PhotoPicker } from '@/components/PhotoPicker';
import { FindingPriority, FindingState, Photo } from '@/types';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import * as Haptics from 'expo-haptics';
import * as FileSystem from 'expo-file-system/legacy';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function FindingModalScreen() {
  const { id, pointId, sectionId, status: requestedStatus } = useLocalSearchParams<{ id: string, pointId: string, sectionId: string, status?: string }>();
  const { getVisit, saveFindingAndStatus, savePhoto, updateFindingDraft } = useVisits();
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const visit = getVisit(id);
  const isReadOnly = visit?.lifecycleStatus === 'CERRADA';
  
  const existingFinding = visit?.findings.find(f => f.pointId === pointId);
  const pointStatus = visit?.sections.flatMap(section => section.points).find(point => point.id === pointId)?.status;
  const findingStatus = requestedStatus === 'SC' || pointStatus === 'SC' ? 'SC' : 'NOK';

  const [description, setDescription] = useState(existingFinding?.description || '');
  const [responsible, setResponsible] = useState(existingFinding?.responsible || '');
  const [commitmentDate, setCommitmentDate] = useState(existingFinding?.commitmentDate || '');
  const [priority, setPriority] = useState<FindingPriority>(existingFinding?.priority || 'MEDIA');
  const [state, setState] = useState<FindingState>(existingFinding?.state || 'ABIERTO');
  const [photos, setPhotos] = useState<Photo[]>(existingFinding?.photos || []);
  const [isSaving, setIsSaving] = useState(false);

  const persistDraft = (patch: Partial<import('@/types').Finding>) => {
    if (isReadOnly) return;
    void updateFindingDraft(id, pointId, patch).catch(error => {
      console.error('No se pudo guardar el borrador del hallazgo', error);
    });
  };

  // Simple date format regex check YYYY-MM-DD
  const isValidDate = (dateString: string) => {
    return /^\d{4}-\d{2}-\d{2}$/.test(dateString);
  };

  const handleSave = async () => {
    if (isReadOnly) return;
    
    if (!description.trim() || !responsible.trim()) {
      Alert.alert('Datos incompletos', 'Completa la descripción y los proveedores responsables.');
      return;
    }

    if (commitmentDate && !isValidDate(commitmentDate)) {
      Alert.alert('Formato Inválido', 'La fecha debe tener formato YYYY-MM-DD');
      return;
    }

    if (photos.length === 0) {
      Alert.alert('Evidencia Requerida', 'Debes incluir al menos una fotografía.');
      return;
    }

    if (state === 'CORREGIDO' && photos.filter(p => p.type === 'DESPUES').length === 0) {
      Alert.alert('Evidencia Requerida', 'Para estado CORREGIDO debes incluir evidencia DESPUES.');
      return;
    }

    setIsSaving(true);
    
    try {
      // Save all unsaved photos
      const updatedPhotos = await Promise.all(photos.map(async (p) => {
        // Skip web or already in documentDirectory
        if (Platform.OS === 'web' || p.uri.startsWith('http') || (FileSystem.documentDirectory && p.uri.includes(FileSystem.documentDirectory))) {
           return p;
        }
        const newUri = await savePhoto(p.uri, id, p.id);
        return { ...p, uri: newUri };
      }));

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

      if (existingFinding) {
        await saveFindingAndStatus(id, pointId, sectionId, findingStatus, {
          ...existingFinding,
          description,
          responsible,
          commitmentDate,
          completedDate: state === 'CORREGIDO' ? new Date().toISOString().split('T')[0] : null,
          priority,
          state,
          photos: updatedPhotos
        });
      } else {
        await saveFindingAndStatus(id, pointId, sectionId, findingStatus, {
          id: `finding:${pointId}`,
          pointId,
          sectionId,
          description,
          responsible,
          priority,
          startDate: new Date().toISOString().split('T')[0],
          commitmentDate,
          completedDate: state === 'CORREGIDO' ? new Date().toISOString().split('T')[0] : null,
          photos: updatedPhotos,
          state
        });
      }

      router.back();
    } catch(e) {
      console.error(e);
      Alert.alert('Error', 'Hubo un error al guardar el hallazgo o copiar las fotos.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleAddPhoto = (photo: Photo) => {
    if (isReadOnly) return;
    const nextPhotos = [...photos, photo];
    setPhotos(nextPhotos);
    persistDraft({ photos: nextPhotos });
  };
  
  const handleRemovePhoto = (photoId: string) => {
    if (isReadOnly) return;
    const nextPhotos = photos.filter(p => p.id !== photoId);
    setPhotos(nextPhotos);
    persistDraft({ photos: nextPhotos });
  };

  const PriorityBtn = ({ val }: { val: FindingPriority }) => (
    <Button
      title={val}
      variant={priority === val ? 'primary' : 'outline'}
      onPress={() => {
        if (isReadOnly) return;
        setPriority(val);
        persistDraft({ priority: val });
      }}
      style={styles.flexBtn}
      size="sm"
      disabled={isReadOnly}
    />
  );

  const StateBtn = ({ val }: { val: FindingState }) => (
    <Button
      title={val}
      variant={state === val ? (val === 'CORREGIDO' ? 'primary' : 'destructive') : 'outline'}
      onPress={() => {
        if (isReadOnly) return;
        setState(val);
        persistDraft({ state: val });
      }}
      style={styles.flexBtn}
      size="sm"
      disabled={isReadOnly}
    />
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <KeyboardAwareScrollViewCompat contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 16) }}>
        <View style={styles.content}>
          <Input 
            testID="finding-description"
            label="Descripción del problema" 
            value={description}
            onChangeText={value => {
              setDescription(value);
              persistDraft({ description: value });
            }}
            placeholder="Detalla lo que encontraste..."
            multiline
            numberOfLines={3}
            style={{ height: 80 }}
            editable={!isReadOnly}
          />

          <View style={styles.rowGroup}>
            <Text style={[styles.label, { color: colors.foreground }]}>Estado del Hallazgo</Text>
            <View style={styles.btnRow}>
              <StateBtn val="ABIERTO" />
              <StateBtn val="CORREGIDO" />
            </View>
          </View>

          <View style={styles.rowGroup}>
            <Text style={[styles.label, { color: colors.foreground }]}>Prioridad</Text>
            <View style={styles.btnRow}>
              <PriorityBtn val="BAJA" />
              <PriorityBtn val="MEDIA" />
              <PriorityBtn val="ALTA" />
              <PriorityBtn val="CRITICA" />
            </View>
          </View>

          <Input 
            testID="finding-responsible"
            label="Proveedores responsables (separados por coma)"
            value={responsible}
            onChangeText={value => {
              setResponsible(value);
              persistDraft({ responsible: value });
            }}
            placeholder="Ej. TELCEL, TELESITE"
            editable={!isReadOnly}
          />

          <Input 
            testID="finding-commitment-date"
            label="Fecha compromiso (opcional, YYYY-MM-DD)"
            value={commitmentDate}
            onChangeText={value => {
              setCommitmentDate(value);
              persistDraft({ commitmentDate: value });
            }}
            placeholder="Ej. 2023-10-25"
            editable={!isReadOnly}
          />

          <View style={styles.divider} />

          <PhotoPicker 
            label="Evidencia: Estado Encontrado (Requerido)"
            type="ANTES"
            photos={photos}
            onAdd={handleAddPhoto}
            onRemove={handleRemovePhoto}
            disabled={isReadOnly}
          />

          <PhotoPicker 
            label={state === 'CORREGIDO' ? "Evidencia: Estado Corregido (Requerido)" : "Evidencia: Estado Corregido (Opcional)"}
            type="DESPUES"
            photos={photos}
            onAdd={handleAddPhoto}
            onRemove={handleRemovePhoto}
            disabled={isReadOnly}
          />

          {!isReadOnly && (
            <Button 
              testID="btn-save-finding"
              title="Guardar Hallazgo"
              onPress={handleSave}
              size="lg"
              loading={isSaving}
              disabled={isSaving}
              style={{ marginTop: 20 }}
            />
          )}
        </View>
      </KeyboardAwareScrollViewCompat>
    </View>
  );
}


const styles = StyleSheet.create({
  content: {
    padding: 16,
    paddingBottom: 40,
  },
  rowGroup: {
    marginBottom: 16,
  },
  label: {
    fontSize: 14,
    fontFamily: 'Inter_500Medium',
    marginBottom: 8,
  },
  btnRow: {
    flexDirection: 'row',
    gap: 8,
  },
  flexBtn: {
    flex: 1,
    paddingHorizontal: 0,
  },
  divider: {
    height: 1,
    backgroundColor: '#E2E8F0',
    marginVertical: 16,
  }
});
