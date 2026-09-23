import React, { useState } from 'react';
import { Alert, Platform, ScrollView, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as FileSystem from 'expo-file-system/legacy';
import { useVisits } from '@/context/VisitContext';
import { useColors } from '@/hooks/useColors';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { PhotoPicker } from '@/components/PhotoPicker';
import { createUuid } from '@/lib/uuid';
import type { Finding, Photo } from '@/types';

export default function AdditionalFindingScreen() {
  const { id, findingId } = useLocalSearchParams<{ id: string; findingId?: string }>();
  const { getVisit, updateVisit, savePhoto } = useVisits();
  const colors = useColors();
  const router = useRouter();
  const visit = getVisit(id);
  const existing = visit?.findings.find(finding => finding.id === findingId && finding.pointId.startsWith('additional:'));
  const [sectionId, setSectionId] = useState(existing?.sectionId || visit?.sections[0]?.id || '');
  const [description, setDescription] = useState(existing?.description || '');
  const [responsible, setResponsible] = useState(existing?.responsible || '');
  const [commitmentDate, setCommitmentDate] = useState(existing?.commitmentDate || '');
  const [photos, setPhotos] = useState<Photo[]>(existing?.photos || []);
  const [saving, setSaving] = useState(false);
  if (!visit) return null;
  const readOnly = visit.lifecycleStatus === 'CERRADA';

  const save = async () => {
    if (!sectionId || !description.trim() || !responsible.trim() || !photos.length) {
      Alert.alert('Datos incompletos', 'Selecciona la sección y agrega descripción, proveedor y fotografía.');
      return;
    }
    if (commitmentDate && !/^\d{4}-\d{2}-\d{2}$/.test(commitmentDate)) {
      Alert.alert('Fecha inválida', 'Usa YYYY-MM-DD o deja la fecha pendiente.');
      return;
    }
    setSaving(true);
    try {
      const savedPhotos = await Promise.all(photos.map(async photo => {
        if (Platform.OS === 'web' || photo.uri.startsWith('http') ||
          (FileSystem.documentDirectory && photo.uri.includes(FileSystem.documentDirectory))) return photo;
        return { ...photo, uri: await savePhoto(photo.uri, visit.id, photo.id) };
      }));
      const pointId = existing?.pointId || `additional:${createUuid()}`;
      const finding: Finding = {
        id: existing?.id || `finding:${pointId}`,
        pointId,
        sectionId,
        description: description.trim(),
        responsible: responsible.split(/[,;\n]+|\s+\/\s+|\s+y\s+/i).map(value => value.trim()).filter(Boolean).join(', '),
        priority: existing?.priority || 'MEDIA',
        startDate: existing?.startDate || new Date().toISOString().slice(0, 10),
        commitmentDate,
        completedDate: null,
        photos: savedPhotos,
        state: 'ABIERTO',
      };
      await updateVisit(visit.id, {
        findings: [...visit.findings.filter(item => item.id !== finding.id), finding],
        sections: visit.sections.map(section => ({
          ...section,
          points: [
            ...section.points.filter(point => point.id !== pointId),
            ...(section.id === sectionId ? [{ id: pointId, title: 'Hallazgo adicional', status: 'NOK' as const }] : []),
          ],
        })),
      });
      router.back();
    } catch (error) {
      Alert.alert('Error', error instanceof Error ? error.message : 'No se pudo guardar el hallazgo.');
    } finally {
      setSaving(false);
    }
  };

  return <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: 16, gap: 14 }}>
    <Text style={{ color: colors.foreground, fontSize: 22, fontWeight: '700' }}>Hallazgo adicional</Text>
    <Text style={{ color: colors.mutedForeground }}>Selecciona la sección donde está el daño. El reporte se enviará a cada proveedor indicado.</Text>
    {visit.sections.map(section => <Button key={section.id}
      title={`${section.name} · ${section.title}`}
      variant={sectionId === section.id ? 'primary' : 'outline'}
      onPress={() => setSectionId(section.id)} disabled={readOnly} />)}
    <Input label="Descripción del daño" value={description} onChangeText={setDescription} multiline editable={!readOnly} />
    <Input label="Proveedores responsables (separados por coma)" value={responsible} onChangeText={setResponsible} editable={!readOnly} />
    <Input label="Fecha compromiso (opcional, YYYY-MM-DD)" value={commitmentDate} onChangeText={setCommitmentDate} editable={!readOnly} />
    <PhotoPicker label="Evidencia del daño" type="ANTES" photos={photos}
      onAdd={photo => setPhotos(current => [...current, photo])}
      onRemove={photoId => setPhotos(current => current.filter(photo => photo.id !== photoId))}
      disabled={readOnly} />
    {!readOnly && <Button title="Guardar hallazgo" onPress={() => void save()} loading={saving} disabled={saving} />}
    {!readOnly && existing && <Button title="Eliminar hallazgo" variant="destructive" onPress={() => {
      void updateVisit(visit.id, {
        findings: visit.findings.filter(item => item.id !== existing.id),
        sections: visit.sections.map(section => ({ ...section, points: section.points.filter(point => point.id !== existing.pointId) })),
      }).then(() => router.back());
    }} />}
  </ScrollView>;
}
