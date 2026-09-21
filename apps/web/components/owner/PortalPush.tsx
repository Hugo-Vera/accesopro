"use client";

import { useEffect } from "react";
import { api } from "@/lib/api";

type FirebaseWeb = {
  apiKey: string;
  projectId: string;
  appId: string;
  messagingSenderId: string;
  vapidKey: string;
  authDomain: string;
};

export function PortalPush() {
  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (typeof window === "undefined" || !("Notification" in window) || !("serviceWorker" in navigator)) return;
      const cfg = await api<{ firebase: FirebaseWeb | null }>("/api/push/config").catch(() => ({ firebase: null }));
      if (!cfg.firebase || cancelled) return;
      const perm = await Notification.requestPermission();
      if (perm !== "granted" || cancelled) return;
      try {
        const { initializeApp, getApps } = await import("firebase/app");
        const { getMessaging, getToken, isSupported } = await import("firebase/messaging");
        if (!(await isSupported())) return;
        const app = getApps()[0] ?? initializeApp({
          apiKey: cfg.firebase.apiKey,
          authDomain: cfg.firebase.authDomain,
          projectId: cfg.firebase.projectId,
          messagingSenderId: cfg.firebase.messagingSenderId,
          appId: cfg.firebase.appId,
        });
        await navigator.serviceWorker.register("/firebase-messaging-sw.js");
        const messaging = getMessaging(app);
        const token = await getToken(messaging, { vapidKey: cfg.firebase.vapidKey });
        if (token && !cancelled) {
          await api("/api/push/register", { method: "POST", body: JSON.stringify({ token, platform: "web" }) });
        }
      } catch {
        /* sin Firebase en el host: el portal sigue por SSE / poll */
      }
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, []);
  return null;
}
