import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Image } from 'react-native';
import { useColors } from '@/hooks/useColors';
import * as ImagePicker from 'expo-image-picker';
import { Photo } from '@/types';
import { Feather } from '@expo/vector-icons';

interface PhotoPickerProps {
  photos: Photo[];
  onAdd: (photo: Photo) => void;
  onRemove: (id: string) => void;
  type: 'ANTES' | 'DESPUES' | 'GENERAL';
  label: string;
}

export function PhotoPicker({ photos, onAdd, onRemove, type, label }: PhotoPickerProps) {
  const colors = useColors();

  const handlePick = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      alert('Se requiere acceso a la cámara.');
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.7,
    });

    if (!result.canceled && result.assets[0]) {
      onAdd({
        id: Date.now().toString(),
        uri: result.assets[0].uri,
        type,
        timestamp: Date.now(),
      });
    }
  };

  const typePhotos = photos.filter(p => p.type === type);

  return (
    <View style={styles.container}>
      <Text style={[styles.label, { color: colors.foreground }]}>{label}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
        {typePhotos.map(photo => (
          <View key={photo.id} style={styles.photoContainer}>
            <Image source={{ uri: photo.uri }} style={[styles.photo, { borderColor: colors.border }]} />
            <TouchableOpacity
              style={styles.removeBtn}
              onPress={() => onRemove(photo.id)}
            >
              <Feather name="x" size={12} color="#FFF" />
            </TouchableOpacity>
          </View>
        ))}
        <TouchableOpacity
          style={[styles.addBtn, { backgroundColor: colors.muted, borderColor: colors.border }]}
          onPress={handlePick}
        >
          <Feather name="camera" size={24} color={colors.mutedForeground} />
          <Text style={[styles.addText, { color: colors.mutedForeground }]}>Añadir</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: 16,
  },
  label: {
    fontSize: 14,
    fontFamily: 'Inter_500Medium',
    marginBottom: 8,
  },
  scrollContent: {
    gap: 12,
  },
  photoContainer: {
    position: 'relative',
  },
  photo: {
    width: 100,
    height: 100,
    borderRadius: 8,
    borderWidth: 1,
  },
  removeBtn: {
    position: 'absolute',
    top: -6,
    right: -6,
    backgroundColor: '#EF4444',
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addBtn: {
    width: 100,
    height: 100,
    borderRadius: 8,
    borderWidth: 1,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
  },
  addText: {
    fontSize: 12,
    fontFamily: 'Inter_500Medium',
    marginTop: 4,
  }
});
