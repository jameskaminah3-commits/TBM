import type { CapacitorConfig } from "@capacitor/cli";

const serverUrl = process.env.CAPACITOR_SERVER_URL?.trim() || "https://tembeabilamatata.com";

const config: CapacitorConfig = {
  appId: "com.tembeabilamatata.app",
  appName: "Bila Matata",
  webDir: "dist/public",
  server: {
    url: serverUrl,
    cleartext: serverUrl.startsWith("http://"),
  },
};

export default config;
