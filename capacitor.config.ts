import type { CapacitorConfig } from "@capacitor/cli";

const PRODUCTION_URL = "https://tools.rftransparent.ca";
const serverUrl = process.env.CAPACITOR_SERVER_URL?.trim() || PRODUCTION_URL;
const allowCleartext = process.env.CAPACITOR_ALLOW_CLEARTEXT === "1";
const localDevelopmentUrl = /^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?(?:\/|$)/.test(serverUrl);

if (serverUrl !== PRODUCTION_URL && !localDevelopmentUrl) {
  throw new Error(
    `CAPACITOR_SERVER_URL must be ${PRODUCTION_URL} or a local development URL. Received: ${serverUrl}`,
  );
}

if (!serverUrl.startsWith("https://") && !allowCleartext) {
  throw new Error("Cleartext Capacitor URLs require CAPACITOR_ALLOW_CLEARTEXT=1.");
}

if (allowCleartext && !localDevelopmentUrl) {
  throw new Error("Cleartext traffic is permitted only for a local development URL.");
}

const config: CapacitorConfig = {
  appId: "ca.rftransparent.tools",
  appName: "RF Tools",
  webDir: "capacitor/www",
  backgroundColor: "#1e3a8a",
  server: {
    url: serverUrl,
    cleartext: allowCleartext,
    allowNavigation: [],
    errorPath: "offline.html",
  },
  ios: {
    backgroundColor: "#1e3a8a",
    contentInset: "never",
    preferredContentMode: "mobile",
    allowsLinkPreview: false,
    webContentsDebuggingEnabled: localDevelopmentUrl,
  },
  plugins: {
    SplashScreen: {
      // The web runtime hides this as soon as the first view is ready. The
      // bounded fallback prevents a failed remote load from covering the
      // bundled offline page forever.
      launchAutoHide: true,
      launchShowDuration: 10_000,
      backgroundColor: "#1e3a8aff",
      showSpinner: false,
    },
    Keyboard: {
      resize: "native",
      resizeOnFullScreen: true,
    },
    StatusBar: {
      overlaysWebView: true,
      style: "DEFAULT",
    },
    PushNotifications: {
      presentationOptions: ["badge", "sound", "banner", "list"],
    },
  },
};

export default config;
