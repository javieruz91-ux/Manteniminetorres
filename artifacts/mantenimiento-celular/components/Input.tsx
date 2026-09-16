import React from 'react';
import { Platform, TextInput, View, Text, StyleSheet, TextInputProps } from 'react-native';
import { useColors } from '../hooks/useColors';

interface InputProps extends TextInputProps {
  label?: string;
  error?: string;
}

function eventValue(event: unknown): string {
  if (event && typeof event === 'object') {
    const candidate = event as {
      nativeEvent?: { text?: unknown };
      target?: { value?: unknown };
    };
    if (typeof candidate.nativeEvent?.text === 'string') return candidate.nativeEvent.text;
    if (typeof candidate.target?.value === 'string') return candidate.target.value;
  }
  return '';
}

export function Input({ label, error, style, ...props }: InputProps) {
  const colors = useColors();
  const { onChangeText, onChange, ...inputProps } = props;
  const webInputProps = Platform.OS === 'web'
    ? {
        ...inputProps,
        onChangeText: undefined,
        onChange: (event: unknown) => {
          onChangeText?.(eventValue(event));
          onChange?.(event as Parameters<NonNullable<TextInputProps['onChange']>>[0]);
        },
      }
    : {
        ...inputProps,
        onChangeText,
        onChange,
      };

  return (
    <View style={styles.container}>
      {label && (
        <Text style={[styles.label, { color: colors.foreground, fontFamily: 'Inter_500Medium' }]}>
          {label}
        </Text>
      )}
      <TextInput
        style={[
          styles.input,
          {
            backgroundColor: colors.background,
            borderColor: error ? colors.destructive : colors.input,
            color: colors.foreground,
            borderRadius: colors.radius,
            fontFamily: 'Inter_400Regular',
          },
          style,
        ]}
        placeholderTextColor={colors.mutedForeground}
        {...webInputProps}
      />
      {error && (
        <Text style={[styles.error, { color: colors.destructive, fontFamily: 'Inter_400Regular' }]}>
          {error}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: 16,
  },
  label: {
    fontSize: 14,
    marginBottom: 8,
  },
  input: {
    borderWidth: 1,
    height: 48,
    paddingHorizontal: 12,
    fontSize: 16,
  },
  error: {
    fontSize: 12,
    marginTop: 4,
  },
});
