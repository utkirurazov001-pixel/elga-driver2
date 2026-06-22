import { registerRootComponent } from 'expo';

import App from './App';
import { initCrash, wrapApp } from './src/crash';

// Crash/xato monitoringi (Sentry) — DSN berilgan bo'lsa yoqiladi, aks holda no-op.
// Sozlash: ../SENTRY_SETUP.md
initCrash();

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(wrapApp(App));
