const fs = require('fs');
let code = fs.readFileSync('artifacts/mantenimiento-celular/app/visit/[id]/summary.tsx', 'utf8');

code = code.replace(/const { getVisit, updateVisit, triggerSync, isOnline } = useVisits\(\);/, 'const { getVisit, updateVisit, triggerSync, closeVisit, reopenVisit, isOnline } = useVisits();');

let closeReplacement = `onPress: async () => {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            const auditEvent = createAuditEvent('CLOSE_VISIT', 'Visita cerrada y lista para sincronización');
            await closeVisit(visit.id, auditEvent);
            triggerSync();
            Alert.alert('¡Cerrada!', 'La visita ha sido cerrada y está en cola de sincronización.');
          }`;
code = code.replace(/onPress: \(\) => \{[\s\S]*?Alert\.alert\('¡Cerrada!', 'La visita ha sido cerrada y está en cola de sincronización.'\);\s*\}/, closeReplacement);

let reopenReplacement = `const confirmReopenVisit = async () => {
    if (!reopenReason.trim()) {
      Alert.alert('Razón requerida', 'Debes especificar por qué reabres la visita.');
      return;
    }
    
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    const auditEvent = createAuditEvent('REOPEN_VISIT', reopenReason);
    await reopenVisit(visit.id, auditEvent);
    triggerSync(); 
    setReopenModalVisible(false);
    setReopenReason('');
    Alert.alert('Reabierta', 'La visita ha sido reabierta.');
  };`;
code = code.replace(/const confirmReopenVisit = \(\) => \{[\s\S]*?Alert\.alert\('Reabierta', 'La visita ha sido reabierta.'\);\s*\};/, reopenReplacement);

let manualSyncReplacement = `const handleManualSync = async () => {
    if (!user) {
      Alert.alert('Iniciar Sesión Requerido', 'Necesitas iniciar sesión para sincronizar.', [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Iniciar Sesión', onPress: () => login() }
      ]);
      return;
    }
    
    await updateVisit(visit.id, { nextAttemptAt: Date.now() });
    triggerSync();
  };`;
code = code.replace(/const handleManualSync = \(\) => \{[\s\S]*?triggerSync\(\);\s*\};/, manualSyncReplacement);

fs.writeFileSync('artifacts/mantenimiento-celular/app/visit/[id]/summary.tsx', code);
