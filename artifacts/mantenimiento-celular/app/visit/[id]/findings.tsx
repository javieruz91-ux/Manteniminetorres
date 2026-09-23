import React from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useVisits } from '@/context/VisitContext';
import { useColors } from '@/hooks/useColors';
import { Card } from '@/components/Card';
import { Badge } from '@/components/Badge';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from '@/components/Button';

export default function FindingsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { getVisit } = useVisits();
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const visit = getVisit(id);
  if (!visit) return null;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <FlatList
        data={visit.findings}
        ListHeaderComponent={visit.lifecycleStatus === 'CERRADA' ? null :
          <Button title="Agregar hallazgo adicional" onPress={() => router.push(`/visit/${visit.id}/additional`)} />}
        keyExtractor={f => f.id}
        contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom, 16) }]}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Feather name="check-circle" size={48} color={colors.success} style={{ marginBottom: 16 }} />
            <Text style={[styles.emptyText, { color: colors.foreground }]}>No hay hallazgos registrados.</Text>
            <Text style={[styles.emptySub, { color: colors.mutedForeground }]}>
              Se requerirá registrar un hallazgo si marcas un punto como NOK.
            </Text>
          </View>
        }
        renderItem={({ item }) => {
          // Find the section this finding belongs to, to show context
          const section = visit.sections.find(s => s.id === item.sectionId);
          const point = section?.points.find(p => p.id === item.pointId);

          return (
            <TouchableOpacity 
              activeOpacity={0.7}
              onPress={() => router.push(item.pointId.startsWith('additional:')
                ? `/visit/${visit.id}/additional?findingId=${item.id}`
                : `/visit/${visit.id}/finding/${item.pointId}?sectionId=${item.sectionId}`)}
            >
              <Card style={styles.card}>
                <View style={styles.cardHeader}>
                  <Badge priority={item.priority} />
                  <Badge state={item.state} />
                </View>
                
                <Text style={[styles.contextText, { color: colors.mutedForeground }]}>
                  {section?.name} · {section?.title} • {point?.title || 'Hallazgo adicional'}
                </Text>
                
                <Text style={[styles.description, { color: colors.foreground }]}>
                  {item.description}
                </Text>

                <View style={styles.footer}>
                  <View style={styles.footerItem}>
                    <Feather name="user" size={14} color={colors.mutedForeground} />
                    <Text style={[styles.footerText, { color: colors.mutedForeground }]}>{item.responsible}</Text>
                  </View>
                  <View style={styles.footerItem}>
                    <Feather name="calendar" size={14} color={colors.mutedForeground} />
                    <Text style={[styles.footerText, { color: colors.mutedForeground }]}>{item.commitmentDate || 'Pendiente'}</Text>
                  </View>
                  <View style={styles.footerItem}>
                    <Feather name="camera" size={14} color={colors.mutedForeground} />
                    <Text style={[styles.footerText, { color: colors.mutedForeground }]}>{item.photos.length} fotos</Text>
                  </View>
                </View>
              </Card>
            </TouchableOpacity>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: 16,
    gap: 12,
  },
  card: {
    padding: 16,
    gap: 12,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  contextText: {
    fontSize: 12,
    fontFamily: 'Inter_600SemiBold',
  },
  description: {
    fontSize: 15,
    fontFamily: 'Inter_400Regular',
    lineHeight: 22,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 4,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
  },
  footerItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  footerText: {
    fontSize: 12,
    fontFamily: 'Inter_500Medium',
  },
  emptyContainer: {
    padding: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    fontSize: 18,
    fontFamily: 'Inter_600SemiBold',
    marginBottom: 8,
  },
  emptySub: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  }
});
