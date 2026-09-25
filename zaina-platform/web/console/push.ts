// zaina-platform/web/console/push.ts
//
// Alerts on this phone or computer: the console's service worker receives
// the platform's web pushes (sw.ts) and shows them as notifications.

import { api } from "./api.ts";

export function alertsSupported(): boolean {
  return "serviceWorker" in navigator && "PushManager" in window && typeof Notification !== "undefined";
}

async function registration(): Promise<ServiceWorkerRegistration> {
  return navigator.serviceWorker.register("sw.js", { scope: "./" });
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!alertsSupported()) return null;
  return (await registration()).pushManager.getSubscription();
}

function keyBytes(base64url: string): Uint8Array {
  const padded = `${base64url}${"=".repeat((4 - (base64url.length % 4)) % 4)}`.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
}

export async function turnAlertsOn(publicKey: string): Promise<void> {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("Notifications weren't allowed.");
  const worker = await registration();
  const subscription = (await worker.pushManager.getSubscription())
    ?? await worker.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
  const json = subscription.toJSON();
  await api("POST", "/v1/console/push-subscriptions", { endpoint: json.endpoint, keys: json.keys });
}

export async function turnAlertsOff(): Promise<void> {
  const subscription = await currentSubscription();
  if (!subscription) return;
  await api("DELETE", "/v1/console/push-subscriptions", { endpoint: subscription.endpoint }).catch(() => {});
  await subscription.unsubscribe();
}
