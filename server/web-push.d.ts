declare module "web-push" {
  export type VapidKeys = {
    publicKey: string;
    privateKey: string;
  };

  export type PushSubscription = {
    endpoint: string;
    expirationTime?: number | null;
    keys: {
      p256dh: string;
      auth: string;
    };
  };

  export type SendNotificationOptions = {
    TTL?: number;
    urgency?: "very-low" | "low" | "normal" | "high";
    topic?: string;
  };

  const webpush: {
    generateVAPIDKeys(): VapidKeys;
    setVapidDetails(subject: string, publicKey: string, privateKey: string): void;
    sendNotification(subscription: PushSubscription, payload?: string, options?: SendNotificationOptions): Promise<void>;
  };

  export default webpush;
}
