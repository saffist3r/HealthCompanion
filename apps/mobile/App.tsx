import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  DeviceEventEmitter,
  Platform,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  NavigationContainer,
  DarkTheme,
} from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
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
import { navigateTo, navigationRef, openNudgeScreen, openPainLog } from './src/navigation';
import HomeScreen from './src/screens/HomeScreen';
import LogScreen from './src/screens/LogScreen';
import MeScreen from './src/screens/MeScreen';
import LifeReviewScreen from './src/screens/LifeReviewScreen';
import GlucoseScreen from './src/screens/GlucoseScreen';
import MealsScreen from './src/screens/MealsScreen';
import CaptureMealScreen from './src/screens/CaptureMealScreen';
import ReportsScreen from './src/screens/ReportsScreen';
import ActivityScreen from './src/screens/ActivityScreen';
import MentalScreen from './src/screens/MentalScreen';
import WatchSettingsScreen from './src/screens/WatchSettingsScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import RemindersSettingsScreen from './src/screens/RemindersSettingsScreen';
import MorningLogScreen from './src/screens/MorningLogScreen';
import PainLogScreen from './src/screens/PainLogScreen';
import Reb3iLiveScreen from './src/screens/Reb3iLiveScreen';
import LoginScreen from './src/screens/LoginScreen';
import AddEntrySheet, { type ComposeLaunch } from './src/components/AddEntrySheet';
import { HUD } from './src/ui/hud';
import { startGlucoseForegroundCatchUp } from './src/glucose/store';
import { checkWatchouts } from './src/watchouts';

const Tab = createBottomTabNavigator();
const HomeStack = createNativeStackNavigator();
const LogStack = createNativeStackNavigator();
const InsightsStack = createNativeStackNavigator();
const MeStack = createNativeStackNavigator();
const RootStack = createNativeStackNavigator();

export { navigationRef };

const TAB_BAR_CONTENT_HEIGHT = 58;

/**
 * Android gesture nav often reports only ~20dp via safe-area, while the
 * mandatory/tappable system zone is ~48dp — tabs must clear that full zone.
 */
const ANDROID_NAV_CLEARANCE = 48;

const stackHeader = {
  headerStyle: { backgroundColor: HUD.bg },
  headerTintColor: HUD.ink,
  headerTitleStyle: { fontFamily: HUD.fontCondensed, fontWeight: '700' as const },
  headerShadowVisible: false,
  contentStyle: { backgroundColor: HUD.bg },
};

const HUD_NAV_THEME = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    primary: HUD.cyan,
    background: HUD.bg,
    card: HUD.bg,
    text: HUD.ink,
    border: HUD.line,
    notification: HUD.red,
  },
};

function HomeStackScreen() {
  return (
    <HomeStack.Navigator screenOptions={stackHeader}>
      <HomeStack.Screen name="HomeMain" component={HomeScreen} options={{ headerShown: false }} />
      <HomeStack.Screen name="GlucoseDetail" component={GlucoseScreen} options={{ title: 'Glucose' }} />
    </HomeStack.Navigator>
  );
}

function LogStackScreen() {
  return (
    <LogStack.Navigator screenOptions={stackHeader}>
      <LogStack.Screen name="LogMain" component={LogScreen} options={{ headerShown: false }} />
      <LogStack.Screen name="Meals" component={MealsScreen} options={{ title: 'Meals' }} />
      <LogStack.Screen name="CaptureMeal" component={CaptureMealScreen} options={{ title: 'Capture meal' }} />
    </LogStack.Navigator>
  );
}

function InsightsStackScreen() {
  return (
    <InsightsStack.Navigator screenOptions={stackHeader}>
      <InsightsStack.Screen name="ReportsHome" component={ReportsScreen} options={{ headerShown: false }} />
      <InsightsStack.Screen name="LifeReview" component={LifeReviewScreen} options={{ title: 'Life Review' }} />
    </InsightsStack.Navigator>
  );
}

function MeStackScreen() {
  return (
    <MeStack.Navigator screenOptions={stackHeader}>
      <MeStack.Screen name="MeMain" component={MeScreen} options={{ headerShown: false }} />
      <MeStack.Screen name="WatchSettings" component={WatchSettingsScreen} options={{ title: 'Watch' }} />
      <MeStack.Screen name="Activity" component={ActivityScreen} options={{ title: 'Health and activity' }} />
      <MeStack.Screen name="Mental" component={MentalScreen} options={{ title: 'Mind history' }} />
      <MeStack.Screen name="RemindersSettings" component={RemindersSettingsScreen} options={{ title: 'Reminders' }} />
      <MeStack.Screen name="AppSettings" component={SettingsScreen} options={{ title: 'Connection and account' }} />
    </MeStack.Navigator>
  );
}

const TAB_ICONS: Record<string, [keyof typeof Ionicons.glyphMap, keyof typeof Ionicons.glyphMap]> = {
  Home: ['pulse', 'pulse-outline'],
  Log: ['list', 'list-outline'],
  Insights: ['analytics', 'analytics-outline'],
  Me: ['person-circle', 'person-circle-outline'],
};

function MainTabs() {
  const insets = useSafeAreaInsets();
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeLaunch, setComposeLaunch] = useState<ComposeLaunch | null>(null);
  const bottomInset =
    Platform.OS === 'android'
      ? Math.max(insets.bottom, ANDROID_NAV_CLEARANCE)
      : Math.max(insets.bottom, 8);
  const tabBarHeight = TAB_BAR_CONTENT_HEIGHT + bottomInset;

  useEffect(() => {
    const sub = DeviceEventEmitter.addListener('open-compose', (payload?: ComposeLaunch) => {
      if (payload?.kind === 'injury' && payload.injuryMode === 'pain') {
        openPainLog({ injuryId: payload.painInjuryId });
        return;
      }
      setComposeLaunch(payload || null);
      setComposeOpen(true);
    });
    const painSub = DeviceEventEmitter.addListener(
      'open-pain-log',
      (payload?: { injuryId?: string }) => {
        openPainLog(payload);
      }
    );
    return () => {
      sub.remove();
      painSub.remove();
    };
  }, []);

  return (
    <View style={{ flex: 1, backgroundColor: HUD.bg }}>
      <Tab.Navigator
        initialRouteName="Home"
        safeAreaInsets={{ top: 0, right: 0, left: 0, bottom: 0 }}
        screenOptions={({ route }) => ({
          headerShown: false,
          tabBarActiveTintColor: HUD.cyan,
          tabBarInactiveTintColor: HUD.dim,
          tabBarLabelStyle: { fontFamily: HUD.fontCondensed, fontSize: 12, letterSpacing: 0.6 },
          tabBarIcon: ({ focused, color }) => (
            <Ionicons name={TAB_ICONS[route.name][focused ? 0 : 1]} size={23} color={color} />
          ),
          tabBarItemStyle: { paddingTop: 6 },
          tabBarStyle: {
            backgroundColor: HUD.bg,
            borderTopColor: HUD.line,
            height: tabBarHeight,
            paddingBottom: bottomInset,
          },
        })}
      >
        <Tab.Screen name="Home" component={HomeStackScreen} />
        <Tab.Screen name="Log" component={LogStackScreen} />
        <Tab.Screen name="Insights" component={InsightsStackScreen} />
        <Tab.Screen name="Me" component={MeStackScreen} />
      </Tab.Navigator>

      <TouchableOpacity
        accessibilityLabel="Add entry"
        style={{
          position: 'absolute',
          right: 20,
          bottom: tabBarHeight + 16,
          width: 58,
          height: 58,
          borderRadius: 29,
          backgroundColor: HUD.cyan,
          alignItems: 'center',
          justifyContent: 'center',
          shadowColor: HUD.cyan,
          shadowOpacity: 0.6,
          shadowRadius: 14,
          shadowOffset: { width: 0, height: 0 },
          elevation: 10,
        }}
        onPress={() => {
          setComposeLaunch(null);
          setComposeOpen(true);
        }}
      >
        <Ionicons name="add" size={32} color={HUD.bg} />
      </TouchableOpacity>

      <AddEntrySheet
        visible={composeOpen}
        launch={composeLaunch}
        onClose={() => {
          setComposeOpen(false);
          setComposeLaunch(null);
        }}
        onCaptureMeal={() => {
          if (navigationRef.isReady()) {
            navigateTo('Log', { screen: 'CaptureMeal' });
          }
        }}
      />
    </View>
  );
}

function SignedInRoot() {
  // Pick up readings stored while the app slept, whichever screen is open.
  useEffect(() => startGlucoseForegroundCatchUp(), []);

  // Watch-outs from your own patterns: on open, when coming back, and every 10 min while open.
  useEffect(() => {
    void checkWatchouts({ force: true });
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void checkWatchouts();
    });
    const timer = setInterval(() => void checkWatchouts(), 10 * 60 * 1000);
    return () => {
      sub.remove();
      clearInterval(timer);
    };
  }, []);

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
    <RootStack.Navigator screenOptions={stackHeader}>
      <RootStack.Screen name="Tabs" component={MainTabs} options={{ headerShown: false }} />
      <RootStack.Screen
        name="MorningLog"
        component={MorningLogScreen}
        options={{ title: 'Morning log', presentation: 'modal' }}
      />
      <RootStack.Screen
        name="PainLog"
        component={PainLogScreen}
        options={{ title: 'Pain check-in', presentation: 'modal' }}
      />
      <RootStack.Screen
        name="Reb3iLive"
        component={Reb3iLiveScreen}
        options={{ title: 'Talk with Reb3i', presentation: 'modal' }}
      />
    </RootStack.Navigator>
  );
}

function RootNavigator() {
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
          backgroundColor: HUD.bg,
        }}
      >
        <ActivityIndicator color={HUD.cyan} />
      </View>
    );
  }

  return signedIn ? <SignedInRoot /> : <LoginScreen />;
}

export default function App() {
  return (
    <SafeAreaProvider>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <AuthProvider>
          <NavigationContainer
            ref={navigationRef}
            theme={HUD_NAV_THEME}
            linking={{
              prefixes: ['healthcompanion://'],
              config: {
                screens: {
                  MorningLog: 'morning',
                  Tabs: {
                    screens: {
                      Home: { screens: { HomeMain: 'today' } },
                      Me: {
                        screens: {
                          Mental: 'mental',
                          RemindersSettings: 'reminders',
                        },
                      },
                    },
                  },
                },
              },
            }}
          >
            <StatusBar style="light" />
            <RootNavigator />
          </NavigationContainer>
        </AuthProvider>
      </GestureHandlerRootView>
    </SafeAreaProvider>
  );
}
