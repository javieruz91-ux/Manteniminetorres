import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Image, Platform } from 'react-native';
import { useColors } from '@/hooks/useColors';
import * as ImagePicker from 'expo-image-picker';
import { Photo, PhotoType } from '@/types';
import { Feather } from '@expo/vector-icons';
import { createUuid } from '@/lib/uuid';

interface PhotoPickerProps {
  photos: Photo[];
  onAdd: (photo: Photo) => void;
  onRemove: (id: string) => void;
  type: PhotoType;
  label: string;
  disabled?: boolean;
}

export function PhotoPicker({ photos, onAdd, onRemove, type, label, disabled = false }: PhotoPickerProps) {
  const colors = useColors();

  const handlePick = async (source: 'camera' | 'library') => {
    if (disabled) return;
    let result: ImagePicker.ImagePickerResult | null = null;
    if (source === 'library') {
      result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.7,
        allowsMultipleSelection: false,
      });
    } else if (Platform.OS === 'web') {
      try {
        result = await ImagePicker.launchCameraAsync({
          mediaTypes: ImagePicker.MediaTypeOptions.Images,
          quality: 0.7,
        });
      } catch {
        result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ImagePicker.MediaTypeOptions.Images,
          quality: 0.7,
          allowsMultipleSelection: false,
        });
      }
    } else {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') {
        alert('Se requiere acceso a la cámara.');
        return;
      }
      result = await ImagePicker.launchCameraAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.7,
      });
    }

    if (result && !result.canceled && result.assets[0]) {
      onAdd({
        id: createUuid(),
        uri: result.assets[0].uri,
        type,
        timestamp: Date.now(),
        objectPath: null,
        uploadStatus: 'pending'
      });
    }
  };

  const typePhotos = photos.filter(p => p.type === type);

  return (
    <View style={styles.container}>
      <Text style={[styles.label, { color: colors.foreground }]}>{label}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
        {typePhotos.map(photo => (
          <View key={photo.id} testID={`evidence-photo-${photo.id}`} style={styles.photoContainer}>
            <Image source={{ uri: photo.uri }} style={[styles.photo, { borderColor: colors.border }]} />
            {!disabled && (
              <TouchableOpacity
                style={styles.removeBtn}
                onPress={() => onRemove(photo.id)}
              >
                <Feather name="x" size={12} color="#FFF" />
              </TouchableOpacity>
            )}
            {photo.uploadStatus === 'failed' && (
              <View style={styles.errorOverlay}>
                <Feather name="alert-circle" size={24} color="#FFF" />
              </View>
            )}
          </View>
        ))}
        {!disabled && (
          <View style={styles.addActions}>
            <TouchableOpacity
              testID={`photo-library-${type}`}
              style={[styles.addBtn, { backgroundColor: colors.muted, borderColor: colors.border }]}
              onPress={() => void handlePick('library')}
            >
              <Feather name="image" size={22} color={colors.mutedForeground} />
              <Text style={[styles.addText, { color: colors.mutedForeground }]}>Archivo</Text>
            </TouchableOpacity>
            <TouchableOpacity
              testID={`photo-camera-${type}`}
              style={[styles.addBtn, { backgroundColor: colors.muted, borderColor: colors.border }]}
              onPress={() => void handlePick('camera')}
            >
              <Feather name="camera" size={22} color={colors.mutedForeground} />
              <Text style={[styles.addText, { color: colors.mutedForeground }]}>Cámara</Text>
            </TouchableOpacity>
          </View>
        )}
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
  addActions: {
    flexDirection: 'row',
    gap: 8,
  },
  addText: {
    fontSize: 12,
    fontFamily: 'Inter_500Medium',
    marginTop: 4,
  },
  errorOverlay: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(239, 68, 68, 0.5)',
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  }
});
