const fs = require('fs');
let code = fs.readFileSync('artifacts/mantenimiento-celular/app/visit/[id]/summary.tsx', 'utf8');

const closeRegex = /onPress: async \(\) => \{[\s\S]*?Alert\.alert\('¡Cerrada!', 'La visita ha sido cerrada y está en cola de sincronización.'\);\s*\}/;
const closeReplacement = `onPress: async () => {
            try {
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              const auditEvent = createAuditEvent('CLOSE_VISIT', 'Visita cerrada y lista para sincronización');
              await closeVisit(visit.id, auditEvent);
              triggerSync();
              Alert.alert('¡Cerrada!', 'La visita ha sido cerrada y está en cola de sincronización.');
            } catch (e: any) {
              Alert.alert('Error', e.message);
            }
          }`;

const reopenRegex = /const confirmReopenVisit = async \(\) => \{[\s\S]*?Alert\.alert\('Reabierta', 'La visita ha sido reabierta.'\);\s*\};/;
const reopenReplacement = `const confirmReopenVisit = async () => {
    if (!reopenReason.trim()) {
      Alert.alert('Razón requerida', 'Debes especificar por qué reabres la visita.');
      return;
    }
    
    try {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      const auditEvent = createAuditEvent('REOPEN_VISIT', reopenReason);
      await reopenVisit(visit.id, auditEvent);
      triggerSync(); 
      setReopenModalVisible(false);
      setReopenReason('');
      Alert.alert('Reabierta', 'La visita ha sido reabierta.');
    } catch (e: any) {
      Alert.alert('Error', e.message);
    }
  };`;

const manualSyncRegex = /const handleManualSync = async \(\) => \{[\s\S]*?triggerSync\(\);\s*\};/;
const manualSyncReplacement = `const handleManualSync = async () => {
    if (!user) {
      Alert.alert('Iniciar Sesión Requerido', 'Necesitas iniciar sesión para sincronizar.', [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Iniciar Sesión', onPress: () => login() }
      ]);
      return;
    }
    
    try {
      await updateVisit(visit.id, { nextAttemptAt: Date.now() });
      triggerSync();
    } catch (e: any) {
      Alert.alert('Error', e.message);
    }
  };`;

code = code.replace(closeRegex, closeReplacement);
code = code.replace(reopenRegex, reopenReplacement);
code = code.replace(manualSyncRegex, manualSyncReplacement);

fs.writeFileSync('artifacts/mantenimiento-celular/app/visit/[id]/summary.tsx', code);
