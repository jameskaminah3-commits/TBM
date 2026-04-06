import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { UserPushPreferences } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";

type PushConfigResponse = {
  supported: boolean;
  publicKey: string | null;
  source: "env" | "ephemeral-dev" | "disabled";
  subject: string | null;
  preferences: UserPushPreferences;
  activeDeviceCount: number;
};

const pushConfigQueryKey = ["/api/push/config"] as const;

function isPushSupported() {
  return typeof window !== "undefined"
    && "Notification" in window
    && "serviceWorker" in navigator
    && "PushManager" in window;
}

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const normalizedBase64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(normalizedBase64);
  const outputArray = new Uint8Array(rawData.length);

  for (let index = 0; index < rawData.length; index += 1) {
    outputArray[index] = rawData.charCodeAt(index);
  }

  return outputArray;
}

function arrayBufferToBase64(buffer: ArrayBuffer) {
  let binary = "";
  const bytes = new Uint8Array(buffer);

  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }

  return window.btoa(binary);
}

function serializePushSubscription(subscription: PushSubscription) {
  const p256dh = subscription.getKey("p256dh");
  const auth = subscription.getKey("auth");

  if (!p256dh || !auth) {
    throw new Error("Push subscription keys are missing.");
  }

  return {
    endpoint: subscription.endpoint,
    expirationTime: subscription.expirationTime,
    keys: {
      p256dh: arrayBufferToBase64(p256dh),
      auth: arrayBufferToBase64(auth),
    },
  };
}

async function getServiceWorkerRegistration() {
  const registration = await navigator.serviceWorker.register("/sw.js");
  await navigator.serviceWorker.ready;
  return registration;
}

export function usePush(enabled = true) {
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">(
    isPushSupported() ? Notification.permission : "unsupported",
  );
  const [hasLocalSubscription, setHasLocalSubscription] = useState(false);

  const configQuery = useQuery<PushConfigResponse>({
    queryKey: pushConfigQueryKey,
    enabled: enabled,
    staleTime: 0,
    refetchOnWindowFocus: true,
  });

  const refreshLocalSubscription = async () => {
    if (!isPushSupported()) {
      setHasLocalSubscription(false);
      setPermission("unsupported");
      return;
    }

    setPermission(Notification.permission);
    const registration = await navigator.serviceWorker.getRegistration("/sw.js")
      || await navigator.serviceWorker.getRegistration();
    const subscription = await registration?.pushManager.getSubscription();
    setHasLocalSubscription(Boolean(subscription));
  };

  useEffect(() => {
    if (!enabled || !isPushSupported()) {
      return;
    }

    refreshLocalSubscription().catch(() => undefined);
  }, [enabled]);

  const registerPushMutation = useMutation({
    mutationFn: async () => {
      if (!isPushSupported()) {
        throw new Error("Push notifications are not supported in this browser.");
      }

      const currentPermission = Notification.permission === "default"
        ? await Notification.requestPermission()
        : Notification.permission;
      setPermission(currentPermission);

      if (currentPermission !== "granted") {
        throw new Error("Notification permission was not granted.");
      }

      const config = configQuery.data;
      if (!config?.publicKey) {
        throw new Error("Push is not configured on the server.");
      }

      const registration = await getServiceWorkerRegistration();
      let subscription = await registration.pushManager.getSubscription();

      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(config.publicKey),
        });
      }

      await apiRequest("POST", "/api/push/register", {
        platform: "web",
        provider: "web-push",
        permission: currentPermission,
        subscription: serializePushSubscription(subscription),
        deviceInfo: {
          userAgent: navigator.userAgent,
          language: navigator.language,
          platformLabel: navigator.platform,
        },
      });
      await refreshLocalSubscription();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: pushConfigQueryKey });
    },
  });

  const unregisterPushMutation = useMutation({
    mutationFn: async () => {
      if (!isPushSupported()) {
        return;
      }

      const registration = await navigator.serviceWorker.getRegistration("/sw.js")
        || await navigator.serviceWorker.getRegistration();
      const subscription = await registration?.pushManager.getSubscription();

      if (subscription) {
        await apiRequest("POST", "/api/push/unregister", { endpoint: subscription.endpoint });
        await subscription.unsubscribe();
      }

      await refreshLocalSubscription();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: pushConfigQueryKey });
    },
  });

  const updatePreferencesMutation = useMutation({
    mutationFn: async (preferences: Partial<UserPushPreferences>) =>
      apiRequest("PATCH", "/api/push/preferences", preferences),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: pushConfigQueryKey });
    },
  });

  const sendTestPushMutation = useMutation({
    mutationFn: async () => apiRequest("POST", "/api/push/test", {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/inbox"] });
    },
  });

  const previewNotificationMutation = useMutation({
    mutationFn: async () => {
      if (!isPushSupported()) {
        throw new Error("Notifications are not supported in this browser.");
      }

      const registration = await getServiceWorkerRegistration();
      registration.active?.postMessage({
        type: "SHOW_LOCAL_NOTIFICATION",
        payload: {
          title: "Preview notification",
          body: "This is a local browser preview from Tembea Bila Matata.",
          icon: "/favicon.png",
          badge: "/favicon.png",
          data: {
            url: "/inbox?view=alerts",
          },
        },
      });
    },
  });

  const pushStatus = useMemo(() => {
    if (!isPushSupported()) {
      return "unsupported" as const;
    }

    if (permission === "denied") {
      return "blocked" as const;
    }

    if (hasLocalSubscription && (configQuery.data?.activeDeviceCount ?? 0) > 0) {
      return "enabled" as const;
    }

    if (permission === "granted") {
      return "granted-no-device" as const;
    }

    return "disabled" as const;
  }, [configQuery.data?.activeDeviceCount, hasLocalSubscription, permission]);

  return {
    ...configQuery,
    permission,
    isSupported: isPushSupported(),
    hasLocalSubscription,
    pushStatus,
    registerPushMutation,
    unregisterPushMutation,
    updatePreferencesMutation,
    sendTestPushMutation,
    previewNotificationMutation,
    refreshLocalSubscription,
  };
}
