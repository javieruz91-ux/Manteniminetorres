import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Alert } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useVisits } from '@/context/VisitContext';
import { useColors } from '@/hooks/useColors';
import { Input } from '@/components/Input';
import { Button } from '@/components/Button';
import { PhotoPicker } from '@/components/PhotoPicker';
import { FindingPriority, Photo } from '@/types';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function FindingModalScreen() {
  const { id, pointId, sectionId } = useLocalSearchParams<{ id: string, pointId: string, sectionId: string }>();
  const { getVisit, addFinding, updateFinding } = useVisits();
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const visit = getVisit(id);
  // Check if finding already exists
  const existingFinding = visit?.findings.find(f => f.pointId === pointId);

  const [description, setDescription] = useState(existingFinding?.description || '');
  const [responsible, setResponsible] = useState(existingFinding?.responsible || '');
  const [commitmentDate, setCommitmentDate] = useState(existingFinding?.commitmentDate || '');
  const [priority, setPriority] = useState<FindingPriority>(existingFinding?.priority || 'MEDIA');
  const [photos, setPhotos] = useState<Photo[]>(existingFinding?.photos || []);

  const handleSave = () => {
    if (!description || !responsible || !commitmentDate) {
      Alert.alert('Datos Incompletos', 'Por favor completa todos los campos de texto.');
      return;
    }

    if (photos.filter(p => p.type === 'ANTES').length === 0) {
      Alert.alert('Evidencia Requerida', 'Debes incluir al menos una foto del estado ANTES.');
      return;
    }

    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

    if (existingFinding) {
      updateFinding(id, existingFinding.id, {
        description,
        responsible,
        commitmentDate,
        priority,
        photos
      });
    } else {
      addFinding(id, {
        id: Date.now().toString(),
        pointId,
        sectionId,
        description,
        responsible,
        priority,
        commitmentDate,
        photos,
        state: 'ABIERTO'
      });
    }

    router.back();
  };

  const handleAddPhoto = (photo: Photo) => setPhotos(prev => [...prev, photo]);
  const handleRemovePhoto = (photoId: string) => setPhotos(prev => prev.filter(p => p.id !== photoId));

  const PriorityBtn = ({ val }: { val: FindingPriority }) => (
    <Button
      title={val}
      variant={priority === val ? 'primary' : 'outline'}
      onPress={() => setPriority(val)}
      style={styles.priorityBtn}
      size="sm"
    />
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <KeyboardAwareScrollViewCompat contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 16) }}>
        <View style={styles.content}>
          <Input 
            label="Descripción del problema" 
            value={description}
            onChangeText={setDescription}
            placeholder="Detalla lo que encontraste..."
            multiline
            numberOfLines={3}
            style={{ height: 80 }}
          />

          <View style={styles.priorityContainer}>
            <Text style={[styles.label, { color: colors.foreground }]}>Prioridad</Text>
            <View style={styles.priorityRow}>
              <PriorityBtn val="BAJA" />
              <PriorityBtn val="MEDIA" />
              <PriorityBtn val="ALTA" />
              <PriorityBtn val="CRITICA" />
            </View>
          </View>

          <Input 
            label="Responsable de corregir" 
            value={responsible}
            onChangeText={setResponsible}
            placeholder="Nombre o rol"
          />

          <Input 
            label="Fecha compromiso (Estimada)" 
            value={commitmentDate}
            onChangeText={setCommitmentDate}
            placeholder="DD/MM/YYYY"
          />

          <View style={styles.divider} />

          <PhotoPicker 
            label="Evidencia: Estado Encontrado (Requerido)"
            type="ANTES"
            photos={photos}
            onAdd={handleAddPhoto}
            onRemove={handleRemovePhoto}
          />

          <PhotoPicker 
            label="Evidencia: Estado Corregido (Opcional si se corrige en sitio)"
            type="DESPUES"
            photos={photos}
            onAdd={handleAddPhoto}
            onRemove={handleRemovePhoto}
          />

          <Button 
            title="Guardar Hallazgo"
            onPress={handleSave}
            size="lg"
            style={{ marginTop: 20 }}
          />
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
  priorityContainer: {
    marginBottom: 16,
  },
  label: {
    fontSize: 14,
    fontFamily: 'Inter_500Medium',
    marginBottom: 8,
  },
  priorityRow: {
    flexDirection: 'row',
    gap: 8,
  },
  priorityBtn: {
    flex: 1,
    paddingHorizontal: 0,
  },
  divider: {
    height: 1,
    backgroundColor: '#E2E8F0',
    marginVertical: 16,
  }
});
