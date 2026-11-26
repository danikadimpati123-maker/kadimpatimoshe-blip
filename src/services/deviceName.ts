import { ref, update } from "firebase/database";
import { db } from "./rtdb";

export const detectDeviceName = () =>
  localStorage.getItem("kidguard_device_name")?.trim() ||
  (navigator as any).userAgentData?.model?.trim() ||
  navigator.userAgent.match(/(OnePlus[^;)/]+|Redmi[^;)/]+|POCO[^;)/]+|Realme[^;)/]+|SM-[A-Z0-9]+|Pixel[^;)/]+|iPhone|iPad)/i)?.[0].trim() ||
  (/android/i.test(navigator.userAgent) ? "Android Mobile" : /iphone|ipad/i.test(navigator.userAgent) ? "iPhone" : "Mobile Device");

export const syncDeviceName = (code: string, name = "") => {
  const c = (code || "").trim().toUpperCase();
  if (!c) return Promise.resolve();
  const cleanName = (name || "").trim() || detectDeviceName();
  return update(ref(db, `devices/${c}`), { deviceName: cleanName, deviceModelName: cleanName, ts: Date.now() });
};
