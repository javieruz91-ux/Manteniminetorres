import React from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity } from 'react-native';
import { useVisits } from '@/context/VisitContext';
import { useColors } from '@/hooks/useColors';
import { Feather } from '@expo/vector-icons';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { useRouter } from 'expo-router';
import { Badge } from '@/components/Badge';

import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function DashboardScreen() {
  const { visits, isLoading, createVisit } = useVisits();
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const handleStartVisit = () => {
    const id = createVisit({});
    router.push(`/visit/${id}`);
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'BORRADOR': return colors.warning;
      case 'LISTO_PARA_SINCRONIZAR': return colors.primary;
      case 'SINCRONIZADO': return colors.success;
      default: return colors.muted;
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'BORRADOR': return 'BORRADOR';
      case 'LISTO_PARA_SINCRONIZAR': return 'POR SINCRONIZAR';
      case 'SINCRONIZADO': return 'COMPLETADO';
      default: return status;
    }
  };

  const renderEmpty = () => (
    <View style={styles.emptyContainer}>
      <View style={[styles.emptyIcon, { backgroundColor: colors.muted }]}>
        <Feather name="clipboard" size={32} color={colors.mutedForeground} />
      </View>
      <Text style={[styles.emptyTitle, { color: colors.foreground, fontFamily: 'Inter_600SemiBold' }]}>
        Sin visitas recientes
      </Text>
      <Text style={[styles.emptyDesc, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
        Toca el botón inferior para comenzar un nuevo registro de mantenimiento preventivo.
      </Text>
    </View>
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.headerStatus, { backgroundColor: colors.header }]}>
        <View style={styles.statusRow}>
          <Feather name="wifi" size={16} color={colors.success} />
          <Text style={[styles.statusText, { color: colors.headerForeground }]}>En línea</Text>
        </View>
        <Text style={[styles.syncText, { color: colors.mutedForeground }]}>
          {visits.filter(v => v.status === 'LISTO_PARA_SINCRONIZAR').length} pendientes de envío
        </Text>
      </View>

      <FlatList
        data={visits}
        keyExtractor={v => v.id}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={renderEmpty}
        renderItem={({ item }) => (
          <TouchableOpacity onPress={() => router.push(`/visit/${item.id}`)} activeOpacity={0.7}>
            <Card style={styles.visitCard}>
              <View style={styles.cardHeader}>
                <Text style={[styles.siteName, { color: colors.foreground }]}>
                  {item.siteName || 'Sitio sin nombre'}
                </Text>
                <Badge
                  text={getStatusLabel(item.status)}
                  customColor={{
                    bg: getStatusColor(item.status),
                    text: '#FFF'
                  }}
                />
              </View>
              
              <View style={styles.cardBody}>
                <View style={styles.infoRow}>
                  <Feather name="hash" size={14} color={colors.mutedForeground} />
                  <Text style={[styles.infoText, { color: colors.mutedForeground }]}>
                    OT: {item.workOrder || 'N/A'}
                  </Text>
                </View>
                <View style={styles.infoRow}>
                  <Feather name="calendar" size={14} color={colors.mutedForeground} />
                  <Text style={[styles.infoText, { color: colors.mutedForeground }]}>
                    {new Date(item.date).toLocaleDateString()}
                  </Text>
                </View>
                <View style={styles.infoRow}>
                  <Feather name="alert-circle" size={14} color={item.findings.length > 0 ? colors.warning : colors.mutedForeground} />
                  <Text style={[styles.infoText, { color: item.findings.length > 0 ? colors.warning : colors.mutedForeground }]}>
                    {item.findings.length} hallazgos
                  </Text>
                </View>
              </View>
            </Card>
          </TouchableOpacity>
        )}
      />

      <View style={[styles.footer, { backgroundColor: colors.card, borderTopColor: colors.border, paddingBottom: Math.max(insets.bottom, 16) }]}>
        <Button
          testID="btn-start-visit"
          title="Iniciar Visita"
          icon={<Feather name="plus" size={20} color="#FFF" />}
          onPress={handleStartVisit}
          size="lg"
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  headerStatus: {
    padding: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  statusText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 14,
  },
  syncText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
  },
  listContent: {
    padding: 16,
    gap: 12,
    paddingBottom: 100,
  },
  visitCard: {
    padding: 16,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  siteName: {
    fontFamily: 'Inter_700Bold',
    fontSize: 16,
    flex: 1,
    marginRight: 8,
  },
  cardBody: {
    gap: 8,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  infoText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
  emptyIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 18,
    marginBottom: 8,
  },
  emptyDesc: {
    fontSize: 14,
    textAlign: 'center',
    paddingHorizontal: 32,
    lineHeight: 20,
  },
  footer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 16,
    borderTopWidth: 1,
  }
});
