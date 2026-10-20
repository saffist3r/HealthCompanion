import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  TouchableOpacity,
  useColorScheme,
  View,
  Text,
} from 'react-native';
import {
  NavigationContainer,
  DarkTheme,
  DefaultTheme,
} from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as Notifications from 'expo-notifications';
import { AuthProvider, useAuth } from './src/auth/AuthContext';
import { startGlucoseAutoSync, stopGlucoseAutoSync } from './src/glucoseCloudSync';
import { startPumpAutoSync, stopPumpAutoSync } from './src/pumpCloudSync';
import { startActivityAutoSync, stopActivityAutoSync } from './src/activityCloudSync';
import {
  isNudgeResponse,
  syncAllNudges,
  checkMissedGlucose,
} from './src/pushNudges';
import { navigateTo, navigationRef, openNudgeScreen } from './src/navigation';
import DashboardScreen from './src/screens/DashboardScreen';
import GlucoseScreen from './src/screens/GlucoseScreen';
import MealsScreen from './src/screens/MealsScreen';
import CaptureMealScreen from './src/screens/CaptureMealScreen';
import ReportsScreen from './src/screens/ReportsScreen';
import LifeReviewScreen from './src/screens/LifeReviewScreen';
import ActivityScreen from './src/screens/ActivityScreen';
import MentalScreen from './src/screens/MentalScreen';
import SettingsHubScreen from './src/screens/SettingsHubScreen';
import WatchSettingsScreen from './src/screens/WatchSettingsScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import RemindersSettingsScreen from './src/screens/RemindersSettingsScreen';
import MorningLogScreen from './src/screens/MorningLogScreen';
import LoginScreen from './src/screens/LoginScreen';
import AddEntrySheet from './src/components/AddEntrySheet';

const Tab = createBottomTabNavigator();
const MealsStack = createNativeStackNavigator();
const ReportsStack = createNativeStackNavigator();
const SettingsStack = createNativeStackNavigator();
const RootStack = createNativeStackNavigator();
export { navigationRef };

/** Content row for text-only tabs (no icon slot). */
const TAB_BAR_CONTENT_HEIGHT = 44;
/**
 * Android gesture nav often reports only ~20dp via safe-area, while the
 * mandatory/tappable system zone is ~48dp — tabs must clear that full zone.
 */
const ANDROID_NAV_CLEARANCE = 48;

function TabLabel({ label, color }: { label: string; color: string }) {
  return (
    <Text style={{ fontSize: 12, color, fontWeight: '600', textAlign: 'center' }} numberOfLines={1}>
      {label}
    </Text>
  );
}

function MealsStackScreen() {
  const isDark = useColorScheme() === 'dark';
  return (
    <MealsStack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: isDark ? '#0d1117' : '#f3f7f6' },
        headerTintColor: isDark ? '#e6edf3' : '#111',
      }}
    >
      <MealsStack.Screen name="MealsList" component={MealsScreen} options={{ title: 'Meals' }} />
      <MealsStack.Screen
        name="CaptureMeal"
        component={CaptureMealScreen}
        options={{ title: 'Capture meal' }}
      />
    </MealsStack.Navigator>
  );
}

function ReportsStackScreen() {
  const isDark = useColorScheme() === 'dark';
  return (
    <ReportsStack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: isDark ? '#0d1117' : '#f3f7f6' },
        headerTintColor: isDark ? '#e6edf3' : '#111',
      }}
    >
      <ReportsStack.Screen
        name="ReportsHome"
        component={ReportsScreen}
        options={{ headerShown: false }}
      />
      <ReportsStack.Screen
        name="LifeReview"
        component={LifeReviewScreen}
        options={{ title: 'Life review' }}
      />
    </ReportsStack.Navigator>
  );
}

function SettingsStackScreen() {
  const isDark = useColorScheme() === 'dark';
  return (
    <SettingsStack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: isDark ? '#0d1117' : '#f3f7f6' },
        headerTintColor: isDark ? '#e6edf3' : '#111',
      }}
    >
      <SettingsStack.Screen
        name="SettingsHub"
        component={SettingsHubScreen}
        options={{ title: 'Settings', headerShown: false }}
      />
      <SettingsStack.Screen
        name="WatchSettings"
        component={WatchSettingsScreen}
        options={{ title: 'Watch' }}
      />
      <SettingsStack.Screen
        name="RemindersSettings"
        component={RemindersSettingsScreen}
        options={{ title: 'Reminders' }}
      />
      <SettingsStack.Screen
        name="AppSettings"
        component={SettingsScreen}
        options={{ title: 'Connection' }}
      />
    </SettingsStack.Navigator>
  );
}

function MainTabs() {
  const isDark = useColorScheme() === 'dark';
  const insets = useSafeAreaInsets();
  const [composeOpen, setComposeOpen] = useState(false);
  const bottomInset =
    Platform.OS === 'android'
      ? Math.max(insets.bottom, ANDROID_NAV_CLEARANCE)
      : Math.max(insets.bottom, 8);
  const tabBarHeight = TAB_BAR_CONTENT_HEIGHT + bottomInset;

  return (
    <View style={{ flex: 1 }}>
      <Tab.Navigator
        initialRouteName="Today"
        safeAreaInsets={{ top: 0, right: 0, left: 0, bottom: 0 }}
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: '#0d9488',
          tabBarInactiveTintColor: isDark ? '#8b949e' : '#9ca3af',
          tabBarIconStyle: { display: 'none', height: 0, width: 0 },
          tabBarLabelPosition: 'below-icon',
          tabBarItemStyle: {
            justifyContent: 'center',
            paddingTop: 0,
            paddingBottom: 0,
          },
          tabBarStyle: {
            backgroundColor: isDark ? '#0d1117' : '#fff',
            borderTopColor: isDark ? '#21262d' : '#e5e7eb',
            height: tabBarHeight,
            paddingBottom: bottomInset,
            paddingTop: 0,
          },
        }}
      >
        <Tab.Screen
          name="Today"
          component={DashboardScreen}
          options={{
            tabBarLabel: ({ color }) => <TabLabel label="Today" color={color} />,
            tabBarIcon: () => null,
          }}
        />
        <Tab.Screen
          name="Glucose"
          component={GlucoseScreen}
          options={{
            tabBarLabel: ({ color }) => <TabLabel label="Glucose" color={color} />,
            tabBarIcon: () => null,
          }}
        />
        <Tab.Screen
          name="Meals"
          component={MealsStackScreen}
          options={{
            tabBarLabel: ({ color }) => <TabLabel label="Meals" color={color} />,
            tabBarIcon: () => null,
          }}
        />
        <Tab.Screen
          name="Reports"
          component={ReportsStackScreen}
          options={{
            tabBarLabel: ({ color }) => <TabLabel label="Reports" color={color} />,
            tabBarIcon: () => null,
            headerShown: false,
          }}
        />
        <Tab.Screen
          name="Mental"
          component={MentalScreen}
          options={{
            tabBarLabel: ({ color }) => <TabLabel label="Mental" color={color} />,
            tabBarIcon: () => null,
          }}
        />
        <Tab.Screen
          name="Activity"
          component={ActivityScreen}
          options={{
            tabBarLabel: ({ color }) => <TabLabel label="Activity" color={color} />,
            tabBarIcon: () => null,
          }}
        />
        <Tab.Screen
          name="Settings"
          component={SettingsStackScreen}
          options={{
            tabBarLabel: ({ color }) => <TabLabel label="Settings" color={color} />,
            tabBarIcon: () => null,
          }}
        />
      </Tab.Navigator>

      <TouchableOpacity
        accessibilityLabel="Add entry"
        style={{
          position: 'absolute',
          right: 20,
          bottom: tabBarHeight + 16,
          width: 56,
          height: 56,
          borderRadius: 28,
          backgroundColor: '#0d9488',
          alignItems: 'center',
          justifyContent: 'center',
          shadowColor: '#000',
          shadowOpacity: 0.2,
          shadowRadius: 8,
          shadowOffset: { width: 0, height: 4 },
          elevation: 6,
        }}
        onPress={() => setComposeOpen(true)}
      >
        <Text style={{ color: '#fff', fontSize: 32, fontWeight: '300', marginTop: -2 }}>+</Text>
      </TouchableOpacity>

      <AddEntrySheet
        visible={composeOpen}
        onClose={() => setComposeOpen(false)}
        onCaptureMeal={() => {
          if (navigationRef.isReady()) {
            navigateTo('Meals', { screen: 'CaptureMeal' });
          }
        }}
      />
    </View>
  );
}

function SignedInRoot() {
  const isDark = useColorScheme() === 'dark';

  useEffect(() => {
    void syncAllNudges();
    // Android OS updates often leave notification access "on" but the listener unbound.
    if (Platform.OS === 'android') {
      void (async () => {
        try {
          const RNAndroidNotificationListener =
            require('react-native-android-notification-listener').default;
          const status = await RNAndroidNotificationListener?.getPermissionStatus?.();
          if (status === 'authorized' && RNAndroidNotificationListener?.requestRebind) {
            await RNAndroidNotificationListener.requestRebind();
          }
        } catch {
          /* ignore */
        }
      })();
    }
    const missedTimer = setInterval(() => {
      void checkMissedGlucose();
    }, 30 * 60 * 1000);

    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data;
      if (isNudgeResponse(data)) {
        openNudgeScreen((data as { screen?: string }).screen);
      }
    });

    void Notifications.getLastNotificationResponseAsync().then((response) => {
      if (response && isNudgeResponse(response.notification.request.content.data)) {
        const data = response.notification.request.content.data as { screen?: string };
        setTimeout(() => openNudgeScreen(data.screen), 400);
      }
    });

    return () => {
      clearInterval(missedTimer);
      sub.remove();
    };
  }, []);

  return (
    <RootStack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: isDark ? '#0d1117' : '#f3f7f6' },
        headerTintColor: isDark ? '#e6edf3' : '#111',
      }}
    >
      <RootStack.Screen name="Tabs" component={MainTabs} options={{ headerShown: false }} />
      <RootStack.Screen
        name="MorningLog"
        component={MorningLogScreen}
        options={{ title: 'Morning log', presentation: 'modal' }}
      />
    </RootStack.Navigator>
  );
}

function RootNavigator() {
  const isDark = useColorScheme() === 'dark';
  const { ready, signedIn } = useAuth();

  useEffect(() => {
    if (!ready) return;
    if (signedIn) {
      startGlucoseAutoSync(5 * 60 * 1000);
      startPumpAutoSync(5 * 60 * 1000);
      startActivityAutoSync(15 * 60 * 1000);
      return () => {
        stopGlucoseAutoSync();
        stopPumpAutoSync();
        stopActivityAutoSync();
      };
    }
    stopGlucoseAutoSync();
    stopPumpAutoSync();
    stopActivityAutoSync();
  }, [ready, signedIn]);

  if (!ready) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: isDark ? '#0d1117' : '#f3f7f6',
        }}
      >
        <ActivityIndicator color="#0d9488" />
      </View>
    );
  }

  return signedIn ? <SignedInRoot /> : <LoginScreen />;
}

export default function App() {
  const isDark = useColorScheme() === 'dark';
  return (
    <SafeAreaProvider>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <AuthProvider>
          <NavigationContainer
            ref={navigationRef}
            theme={isDark ? DarkTheme : DefaultTheme}
            linking={{
              prefixes: ['healthcompanion://'],
              config: {
                screens: {
                  MorningLog: 'morning',
                  Tabs: {
                    screens: {
                      Today: 'today',
                      Mental: 'mental',
                      Settings: {
                        screens: {
                          RemindersSettings: 'reminders',
                        },
                      },
                    },
                  },
                },
              },
            }}
          >
            <StatusBar style={isDark ? 'light' : 'dark'} />
            <RootNavigator />
          </NavigationContainer>
        </AuthProvider>
      </GestureHandlerRootView>
    </SafeAreaProvider>
  );
}
