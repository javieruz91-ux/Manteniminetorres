import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useColors } from '../hooks/useColors';
import { ChecklistStatus, FindingPriority, FindingState } from '../types';

interface BadgeProps {
  status?: ChecklistStatus;
  priority?: FindingPriority;
  state?: FindingState;
  text?: string;
  customColor?: { bg: string; text: string };
}

export function Badge({ status, priority, state, text, customColor }: BadgeProps) {
  const colors = useColors();

  let bg = colors.muted;
  let textColor = colors.mutedForeground;
  let label = text || '';

  if (status) {
    switch (status) {
      case 'OK':
        bg = colors.success;
        textColor = colors.successForeground;
        label = 'OK';
        break;
      case 'NOK':
        bg = colors.destructive;
        textColor = colors.destructiveForeground;
        label = 'NOK';
        break;
      case 'SC':
        bg = colors.warning;
        textColor = colors.warningForeground;
        label = 'S/C';
        break;
      case 'NA':
        bg = colors.na;
        textColor = colors.naForeground;
        label = 'N/A';
        break;
      case 'PENDING':
        bg = colors.muted;
        textColor = colors.mutedForeground;
        label = 'PENDIENTE';
        break;
    }
  } else if (priority) {
    label = priority;
    switch (priority) {
      case 'BAJA':
        bg = colors.secondary;
        textColor = colors.secondaryForeground;
        break;
      case 'MEDIA':
        bg = colors.warning;
        textColor = colors.warningForeground;
        break;
      case 'ALTA':
        bg = '#EA580C'; // Darker orange
        textColor = '#FFFFFF';
        break;
      case 'CRITICA':
        bg = colors.destructive;
        textColor = colors.destructiveForeground;
        break;
    }
  } else if (state) {
    label = state;
    switch (state) {
      case 'ABIERTO':
        bg = colors.warning;
        textColor = colors.warningForeground;
        break;
      case 'CORREGIDO':
        bg = colors.success;
        textColor = colors.successForeground;
        break;
    }
  } else if (customColor) {
    bg = customColor.bg;
    textColor = customColor.text;
  }

  return (
    <View style={[styles.badge, { backgroundColor: bg, borderRadius: colors.radius / 2 }]}>
      <Text style={[styles.text, { color: textColor, fontFamily: 'Inter_600SemiBold' }]}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    alignSelf: 'flex-start',
  },
  text: {
    fontSize: 11,
    letterSpacing: 0.5,
  },
});
