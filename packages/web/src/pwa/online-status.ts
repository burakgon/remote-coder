import { useEffect, useState } from "react";

export function getOnline(): boolean {
  return typeof navigator === "undefined" ? true : navigator.onLine;
}

export function subscribeOnline(cb: (online: boolean) => void): () => void {
  const onOnline = () => cb(true);
  const onOffline = () => cb(false);
  window.addEventListener("online", onOnline);
  window.addEventListener("offline", onOffline);
  return () => {
    window.removeEventListener("online", onOnline);
    window.removeEventListener("offline", onOffline);
  };
}

export function useOnline(): boolean {
  const [online, setOnline] = useState(getOnline());
  useEffect(() => subscribeOnline(setOnline), []);
  return online;
}
