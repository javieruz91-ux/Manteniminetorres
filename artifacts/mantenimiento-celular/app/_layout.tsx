import React, { useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from '@expo-google-fonts/inter';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { VisitProvider } from '@/context/VisitContext';
import { useColors } from '@/hooks/useColors';
import { StatusBar } from 'expo-status-bar';

import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { setAuthTokenGetter, setBaseUrl } from "@workspace/api-client-react";
import { AuthProvider } from "@/lib/auth";

const domain = process.env.EXPO_PUBLIC_DOMAIN;
if (domain) setBaseUrl(`https://${domain}`);
setAuthTokenGetter(async () => {
  if (Platform.OS === 'web') return localStorage.getItem('auth_session_token');
  return await SecureStore.getItemAsync('auth_session_token');
});

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient();

function RootLayoutNav() {
  const colors = useColors();
  
  return (
    <>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.header },
          headerTintColor: colors.headerForeground,
          headerBackVisible: true,
          headerShadowVisible: false,
          headerTitleStyle: {
            fontFamily: 'Inter_600SemiBold',
            fontSize: 18,
          }
        }}
      >
        <Stack.Screen name="index" options={{ title: 'Mantenimiento' }} />
        <Stack.Screen name="visit/[id]/index" options={{ title: 'Detalle de Visita' }} />
        <Stack.Screen name="visit/[id]/section/[sectionId]" options={{ title: 'Checklist' }} />
        <Stack.Screen name="visit/[id]/finding/[pointId]" options={{ title: 'Registrar Hallazgo', presentation: 'modal' }} />
        <Stack.Screen name="visit/[id]/findings" options={{ title: 'Hallazgos Registrados' }} />
        <Stack.Screen name="visit/[id]/summary" options={{ title: 'Resumen y Cierre' }} />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) return null;

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <GestureHandlerRootView>
              <KeyboardProvider>
                <VisitProvider>
                  <RootLayoutNav />
                </VisitProvider>
              </KeyboardProvider>
            </GestureHandlerRootView>
          </AuthProvider>
        </QueryClientProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
