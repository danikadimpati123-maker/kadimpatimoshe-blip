import { update, onValue } from "firebase/database";
import { norm, pathRef } from "./rtdb";

const KEY = (c: string) => `kg_notif_${c}`;

export const pushNotif = (
  code: string,
  n: { appName: string; title: string; text?: string; body?: string; message?: string; category?: string; timestamp?: number }
) => {
  const c = norm(code);
  if (!c) return;
  const ts = n.timestamp || Date.now();
  const id = `n_${ts}_${Math.random().toString(36).slice(2, 5)}`;
  const item = {
    id,
    category: "system",
    ...n,
    text: n.text ?? n.body ?? n.message ?? "",
    timestamp: ts,
  };

  try {
    const prev = JSON.parse(localStorage.getItem(KEY(c)) || "[]");
    const next = [item, ...(Array.isArray(prev) ? prev : [])].slice(0, 100);
    localStorage.setItem(KEY(c), JSON.stringify(next));
  } catch {}

  // set బదులు update వాడితే Kotlin పుష్ చేసిన WhatsApp/Insta డేటా చెరిగిపోదు
  update(pathRef(c, `notifications/${id}`), item).catch(() => {});
};

export const watchNotifs = (code: string, cb: (list: any[]) => void) =>
  norm(code)
    ? onValue(pathRef(code, "notifications"), (s) =>
        cb(Array.isArray(s.val()) ? s.val() : Object.values(s.val() || {}))
      )
    : () => {};