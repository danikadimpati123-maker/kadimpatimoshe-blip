import { sendEmailVerification } from "firebase/auth";
import { ref, set, update, onValue, get, remove } from "firebase/database";
import {
  auth,
  db,
  onAuthStateChanged,
  norm,
  pathRef,
  signInWithEmail,
  signUpWithEmail,
  signOut,
  claimCode,
  startHeartbeat,
  pushData,
  watchData,
  isDeviceLive,
  sendCmd,
  watchCmd,
  ackCmd,
  startStreamNode,
  sendSDP,
  watchSDP,
  addIce,
  watchIce,
  stopStreamNode,
  type StreamMode,
} from "./rtdb";

export {
  auth,
  db,
  onAuthStateChanged,
  sendEmailVerification,
  norm,
  pathRef,
  signInWithEmail,
  signUpWithEmail,
  signOut,
  claimCode,
  startHeartbeat,
  pushData,
  watchData,
  isDeviceLive,
  sendCmd,
  watchCmd,
  ackCmd,
  startStreamNode,
  sendSDP,
  watchSDP,
  addIce,
  watchIce,
  stopStreamNode,
  type StreamMode,
};
export { detectDeviceName, syncDeviceName } from "./deviceName";

export const database = db;

export const sanitizeForRTDB = (data: any) =>
  JSON.parse(JSON.stringify(data ?? {}, (_, v) => (typeof v === "number" && !Number.isFinite(v) ? 0 : v)));

const toList = (v: any) => (Array.isArray(v) ? v : v && typeof v === "object" ? Object.values(v) : []);

const makeCode = () => {
  const chars = "0123456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  return `FG-${Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join("")}`;
};

const getSavedUid = (): string | undefined => {
  if (auth.currentUser?.uid) return auth.currentUser.uid;
  try {
    return JSON.parse(localStorage.getItem("kidguard_user") || "{}")?.uid;
  } catch {
    return undefined;
  }
};

export const saveParentSession = (user: { uid: string; email: string }) =>
  localStorage.setItem("kidguard_user", JSON.stringify(user));

export const sendRemoteCommand = (code: string, command: string, extra: Record<string, any> = {}) =>
  sendCmd(code, command, { command, requestedAt: Date.now(), ...extra });

// ---------------- CONSOLE HELPERS (BUILT ON ./rtdb) ----------------
export interface DeviceVerificationResult {
  code: string;
  existsInRTDB: boolean;
  rtdbPath: string;
  deviceModelName: string;
  status: "online" | "ready" | "pending" | "paired" | "synced";
  platform: string;
  batteryLevel: number;
  lastSeen?: string;
  verified: boolean;
  rawData?: any;
}

export const getOrCreateChildPairingCode = async (
  uid: string,
  deviceId: string,
  modelName = "Child Device"
) => {
  const snap = await get(ref(db, `user_pairing_codes/${uid}`));
  if (snap.exists()) return norm(snap.val());
  const code = makeCode();
  const now = Date.now();
  await update(ref(db), {
    [`user_pairing_codes/${uid}`]: code,
    [`devices/${code}`]: {
      deviceId,
      childId: `child_${code}`,
      pairingCode: code,
      deviceModelName: modelName,
      online: true,
      ts: now,
      lastSeen: new Date(now).toISOString(),
    },
  });
  return code;
};

export const searchAndVerifyChildDevice = async (code: string): Promise<DeviceVerificationResult> => {
  const c = norm(code);
  if (!c || c.length < 4) {
    throw new Error("Please enter a valid binding code (e.g. FG-ABCDEF).");
  }
  const pendingSnap = await get(ref(db, `pending_binds/${c}`));
  const foundPending = pendingSnap.exists() ? pendingSnap.val() : null;
  const deviceSnap = !foundPending ? await get(pathRef(c)) : null;
  const foundData = foundPending || (deviceSnap?.exists() ? deviceSnap.val() : null);
  const foundPath = foundPending ? `pending_binds/${c}` : `devices/${c}`;

  return {
    code: c,
    existsInRTDB: Boolean(foundData),
    rtdbPath: `/${foundPath}`,
    deviceModelName: foundData?.deviceModelName || foundData?.modelName || `Device ${c}`,
    status: foundData?.status === "paired" || foundData?.status === "synced" ? "synced" : "ready",
    platform: foundData?.platform || "android",
    batteryLevel: foundData?.telemetry?.batteryLevel ?? foundData?.batteryLevel ?? 85,
    lastSeen: foundData?.lastSeen ? String(foundData.lastSeen) : new Date().toISOString(),
    verified: Boolean(foundData),
    rawData: foundData,
  };
};

export const pairChildDevice = async (parentUid: string, code: string, customModelName?: string) => {
  const c = norm(code);
  if (!c) throw new Error("Invalid pairing code");
  const existing = (await claimCode(c, parentUid)) || {};
  const childId = existing.childId || `child_${c}`;
  const deviceModelName = customModelName?.trim() || existing.deviceModelName || `Device ${c}`;
  const now = Date.now();
  const deviceRecord = {
    childId,
    deviceId: existing.deviceId || `dev_${c}`,
    pairingCode: c,
    deviceModelName,
    online: true,
    isOnline: true,
    lastSeen: now,
    lastHeartbeat: now,
    ts: now,
    timestamp: new Date(now).toISOString(),
  };
  await update(ref(db), {
    [`parents/${parentUid}/children/${childId}`]: deviceRecord,
    [`devices/${c}/childId`]: childId,
    [`devices/${c}/pairingCode`]: c,
    [`devices/${c}/deviceModelName`]: deviceModelName,
  });
  return deviceRecord as any;
};

export const deleteChildDevice = async (
  codeOrId: string,
  childId?: string,
  parentUid?: string
) => {
  const c = norm(codeOrId).replace(/^CHILD_|^DEV_/, "");
  const uid = parentUid || getSavedUid();
  if (!uid) return false;

  const removals: Promise<any>[] = [];
  if (childId) removals.push(remove(ref(db, `parents/${uid}/children/${childId}`)));
  if (c) {
    removals.push(remove(ref(db, `parents/${uid}/children/child_${c}`)));
    removals.push(remove(pathRef(c)));
  }

  try {
    const snap = await get(ref(db, `parents/${uid}/children`));
    if (snap.exists()) {
      const childrenMap = snap.val() || {};
      Object.entries(childrenMap).forEach(([key, val]: [string, any]) => {
        const matchesCode = c && norm(val?.pairingCode || "") === c;
        const matchesId =
          (childId && key === childId) ||
          (codeOrId && (key === codeOrId || val?.deviceId === codeOrId));
        if (matchesCode || matchesId) {
          removals.push(remove(ref(db, `parents/${uid}/children/${key}`)));
        }
      });
    }
  } catch {}

  await Promise.allSettled(removals);
  return true;
};

export const handleResetConsoleData = (parentUid: string) =>
  remove(ref(db, `parents/${parentUid}/children`));

export const subscribeToChildDevices = (
  parentUid: string,
  cb: (list: any[]) => void,
  onError?: (err: Error) => void
) =>
  onValue(
    ref(db, `parents/${parentUid}/children`),
    (snap) => {
      const val = snap.val();
      cb(
        val
          ? Object.entries(val).map(([k, v]: [string, any]) => ({
              childId: k,
              ...v,
              isOnline: isDeviceLive(v),
            }))
          : []
      );
    },
    onError
  );

export const subscribeToChildDeviceTelemetry = (
  code: string,
  cb: (data: any) => void,
  onError?: (err: Error) => void
) => {
  const c = norm(code);
  if (!c) return () => {};
  return onValue(
    pathRef(c),
    (snap) => {
      const v = snap.val();
      cb(v ? { ...v, pairingCode: c, isOnline: isDeviceLive(v) } : null);
    },
    onError
  );
};

export const subscribeToChildLocation = (
  code: string,
  cb: (loc: any) => void,
  onError?: (err: Error) => void
) => {
  const c = norm(code);
  if (!c) return () => {};
  return onValue(
    pathRef(c, "location"),
    (snap) => {
      const v = snap.val();
      if (!v || typeof v !== "object") {
        cb(null);
        return;
      }
      const lat = Number(v.latitude ?? v.lat);
      const lng = Number(v.longitude ?? v.lng ?? v.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        cb(null);
        return;
      }
      const acc = Math.round(Number(v.accuracy ?? v.acc) || 10);
      cb({
        ...v,
        latitude: lat,
        longitude: lng,
        lat,
        lng,
        lon: lng,
        accuracy: acc,
        acc,
        timestamp: v.timestamp || v.updatedAt || v.ts || Date.now(),
        address: v.address || `${lat.toFixed(5)}°, ${lng.toFixed(5)}°`,
      });
    },
    onError
  );
};

export const subscribeToChildCallLogs = (
  code: string,
  cb: (logs: any[]) => void,
  onError?: (err: Error) => void
) => {
  const c = norm(code);
  if (!c) return () => {};
  return onValue(pathRef(c, "callLogs"), (snap) => cb(toList(snap.val())), onError);
};

export const subscribeToChildAppUsage = (
  code: string,
  cb: (apps: any[]) => void,
  onError?: (err: Error) => void
) => {
  const c = norm(code);
  if (!c) return () => {};
  return onValue(pathRef(c, "appUsage"), (snap) => cb(toList(snap.val())), onError);
};

export const subscribeToChildNotifications = (
  code: string,
  cb: (notifs: any[]) => void,
  onError?: (err: Error) => void
) => {
  const c = norm(code);
  if (!c) return () => {};
  return onValue(pathRef(c, "notifications"), (snap) => cb(toList(snap.val())), onError);
};

export const updateChildLocation = (code: string, location: Record<string, any>) => {
  const c = norm(code);
  return c
    ? set(pathRef(c, "location"), { ...sanitizeForRTDB(location), updatedAt: Date.now() })
    : Promise.resolve();
};

export const updateChildAppUsage = (code: string, appUsage: any) => {
  const c = norm(code);
  return c ? set(pathRef(c, "appUsage"), sanitizeForRTDB(appUsage)) : Promise.resolve();
};

export const updateChildCallLogs = (code: string, callLogs: any) => {
  const c = norm(code);
  return c ? set(pathRef(c, "callLogs"), sanitizeForRTDB(callLogs)) : Promise.resolve();
};

export const updateChildNotifications = (code: string, notifications: any) => {
  const c = norm(code);
  return c ? set(pathRef(c, "notifications"), sanitizeForRTDB(notifications)) : Promise.resolve();
};

export const pushChildNotification = async (
  code: string,
  notif: {
    appName: string;
    packageName?: string;
    title: string;
    text?: string;
    body?: string;
    message?: string;
    category?: 'messaging' | 'social' | 'education' | 'game' | 'system';
    timestamp?: number;
  }
) => {
  const c = norm(code);
  if (!c) return;
  const now = notif.timestamp || Date.now();
  const id = `notif_${now}_${Math.random().toString(36).slice(2, 6)}`;
  await set(pathRef(c, `notifications/${id}`), sanitizeForRTDB({
    id,
    appName: notif.appName || 'System',
    packageName: notif.packageName || '',
    title: notif.title || '',
    text: notif.text ?? notif.body ?? notif.message ?? '',
    category: notif.category || 'system',
    timestamp: now,
  }));
};

