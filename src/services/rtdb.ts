import { initializeApp, getApps } from "firebase/app";
import {
  getAuth,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut as fbSignOut,
  onAuthStateChanged,
  setPersistence,
  browserLocalPersistence,
} from "firebase/auth";
import {
  getDatabase,
  ref,
  set,
  update,
  onValue,
  get,
  remove,
  push,
  onChildAdded,
  onDisconnect,
} from "firebase/database";
import firebaseConfig from "../../firebase-applet-config.json";

const DB_URL = "https://kidguard-3b499-default-rtdb.asia-southeast1.firebasedatabase.app";
const app = getApps().length ? getApps()[0] : initializeApp({ ...firebaseConfig, databaseURL: DB_URL });

export const auth = getAuth(app);
export const db = getDatabase(app, DB_URL);
setPersistence(auth, browserLocalPersistence).catch(() => {});
export { onAuthStateChanged };

export type StreamMode = "camera" | "audio" | "screen";

export const norm = (code: string) => (code || "").trim().toUpperCase();
export const pathRef = (code: string, sub = "") =>
  ref(db, `devices/${norm(code)}${sub ? `/${sub}` : ""}`);

const clean = (data: any) =>
  JSON.parse(JSON.stringify(data ?? {}, (_, v) => (typeof v === "number" && !Number.isFinite(v) ? 0 : v)));

// ---------------- AUTH ----------------
export const signInWithEmail = (email: string, pass: string) =>
  signInWithEmailAndPassword(auth, email, pass).then((r) => r.user);

export const signUpWithEmail = (email: string, pass: string) =>
  createUserWithEmailAndPassword(auth, email, pass).then((r) => r.user);

export const signOut = () => fbSignOut(auth);

// ---------------- PAIRING & HEARTBEAT ----------------
export const claimCode = async (code: string, parentUid: string) => {
  const c = norm(code);
  const uid = (parentUid || "").trim();
  if (!c || !uid) return null;
  const snap = await get(pathRef(c));
  const data = { ...(snap.val() || {}), code: c, parentUid: uid, online: true, ts: Date.now() };
  await update(pathRef(c), data);
  return data;
};

export const startHeartbeat = (code: string) => {
  const c = norm(code);
  if (!c) return () => {};
  const onRef = pathRef(c, "online");
  onDisconnect(onRef).set(false).catch(() => {});
  const beat = () => {
    set(onRef, true).catch(() => {});
    update(pathRef(c), { online: true, ts: Date.now() }).catch(() => {});
  };
  beat();
  const id = window.setInterval(beat, 20000);
  return () => {
    window.clearInterval(id);
    set(onRef, false).catch(() => {});
  };
};

// ---------------- GENERIC PUSH & WATCH ----------------
export const pushData = (code: string, sub: string, data: any) => {
  const c = norm(code);
  if (!c) return Promise.resolve();
  return update(pathRef(c, sub), { ...clean(data), ts: Date.now() });
};

export const watchData = (code: string, sub: string, cb: (val: any) => void) => {
  const c = norm(code);
  if (!c) return () => {};
  return onValue(pathRef(c, sub), (snap) => cb(snap.val() ?? null));
};

export const isDeviceLive = (dev: any, maxAgeMs = 45000) =>
  Boolean(dev?.online && (!dev?.ts || Date.now() - Number(dev.ts) < maxAgeMs));

// ---------------- REMOTE COMMANDS ----------------
export const sendCmd = (code: string, cmd: string, extra: Record<string, any> = {}) =>
  pushData(code, "control", {
    cmd,
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    ack: false,
    ...extra,
  });

export const watchCmd = (code: string, cb: (cmd: any) => void) => {
  let lastId = "";
  return watchData(code, "control", (c) => {
    if (!c?.cmd || c.ack !== false) return;
    const id = String(c.id || c.ts || `${c.cmd}_${c.requestedAt ?? "default"}`);
    if (id !== lastId) {
      lastId = id;
      cb(c);
    }
  });
};

export const ackCmd = (code: string) =>
  update(pathRef(code, "control"), { ack: true, ackAt: Date.now() });

// ---------------- WEBRTC SIGNALING ----------------
export const startStreamNode = (code: string, mode: StreamMode) =>
  set(pathRef(code, "stream"), {
    mode,
    startedAt: Date.now(),
    offer: null,
    answer: null,
    childCandidates: null,
    parentCandidates: null,
  });

export const sendSDP = (code: string, type: "offer" | "answer", sdp: RTCSessionDescriptionInit) =>
  set(pathRef(code, `stream/${type}`), clean({ type: sdp.type, sdp: sdp.sdp }));

export const watchSDP = (
  code: string,
  type: "offer" | "answer",
  cb: (sdp: RTCSessionDescriptionInit) => void
) =>
  watchData(code, `stream/${type}`, (val) => {
    if (val?.sdp && val?.type) cb(val);
  });

export const addIce = (
  code: string,
  side: "childCandidates" | "parentCandidates",
  candidate: RTCIceCandidateInit
) => {
  const c = norm(code);
  if (!c || !candidate) return Promise.resolve();
  const raw = typeof (candidate as any).toJSON === "function" ? (candidate as any).toJSON() : candidate;
  return push(pathRef(c, `stream/${side}`), clean(raw));
};

export const watchIce = (
  code: string,
  side: "childCandidates" | "parentCandidates",
  cb: (candidate: RTCIceCandidateInit) => void
) => {
  const c = norm(code);
  if (!c) return () => {};
  return onChildAdded(pathRef(c, `stream/${side}`), (snap) => {
    const val = snap.val();
    if (val) cb(val);
  });
};

export const stopStreamNode = (code: string) => remove(pathRef(code, "stream"));
