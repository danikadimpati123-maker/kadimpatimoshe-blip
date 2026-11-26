import React, { useState, useEffect, useMemo } from 'react';
import { Bell, Search, MessageSquare, Gamepad2, GraduationCap, Share2, Clock, CheckCircle2, Radio, Trash2, X } from 'lucide-react';
import { ParentChildDevice, NotificationItem } from '../types';
import { updateChildNotifications } from '../services/firebase';
import { watchNotifs } from '../services/notifPipeline';

type CategoryFilter = 'all' | 'messaging' | 'social' | 'education' | 'game';

const CATEGORIES: { id: CategoryFilter; label: string }[] = [
  { id: 'all', label: 'All Alerts' },
  { id: 'messaging', label: 'Messaging' },
  { id: 'social', label: 'Social' },
  { id: 'education', label: 'Education' },
  { id: 'game', label: 'Games' },
];

const getCatIcon = (cat?: string) =>
  cat === 'messaging' ? <MessageSquare className="w-4 h-4 text-emerald-600" />
  : cat === 'social' ? <Share2 className="w-4 h-4 text-pink-600" />
  : cat === 'game' ? <Gamepad2 className="w-4 h-4 text-purple-600" />
  : cat === 'education' ? <GraduationCap className="w-4 h-4 text-blue-600" />
  : <Bell className="w-4 h-4 text-amber-600" />;

const toMs = (ts?: string | number | null): number => {
  if (!ts) return 0;
  const n = typeof ts === 'number' ? ts : /^\d+$/.test(String(ts).trim()) ? Number(ts) : Date.parse(String(ts));
  return Number.isFinite(n) && n > 0 ? (n < 1e11 ? n * 1000 : n) : 0;
};

const formatTime = (ts?: string | number | null): string => {
  const ms = toMs(ts);
  if (!ms) return 'Just now';
  const sec = Math.floor((Date.now() - ms) / 1000);
  if (sec < 45) return 'Just now';
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  const d = new Date(ms);
  return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
};

const normalizeList = (raw: any): NotificationItem[] => {
  const src = raw?.items ?? raw;
  const arr = Array.isArray(src) ? src : src && typeof src === 'object' ? Object.values(src) : [];
  return arr
    .filter((x): x is any => Boolean(x && typeof x === 'object'))
    .map((x) => ({ ...x, text: x.text ?? x.body ?? x.message ?? '' }))
    .sort((a, b) => toMs(b.timestamp) - toMs(a.timestamp));
};

export const NotificationsView: React.FC<{
  devices: ParentChildDevice[];
  selectedDevice: ParentChildDevice | null;
  onSelectDevice: (d: ParentChildDevice) => void;
}> = ({ devices, selectedDevice, onSelectDevice }) => {
  const currentDevice = selectedDevice || devices[0];
  const pairingCode = (currentDevice?.pairingCode || currentDevice?.childId?.replace('child_', '') || currentDevice?.deviceId || '').trim();

  const [liveList, setLiveList] = useState<NotificationItem[] | null>(null);
  const [isListening, setIsListening] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all');

  useEffect(() => {
    if (!feedback) return;
    const t = setTimeout(() => setFeedback(null), 3500);
    return () => clearTimeout(t);
  }, [feedback]);

  useEffect(() => {
    if (!pairingCode) {
      setLiveList(null);
      return;
    }
    setIsListening(true);
    const unsub = watchNotifs(pairingCode, (list) => {
      setLiveList(normalizeList(list));
      setIsListening(false);
    });
    return () => unsub();
  }, [pairingCode]);

  const notifications: NotificationItem[] = useMemo(
    () => liveList ?? normalizeList(currentDevice?.notifications),
    [liveList, currentDevice?.notifications]
  );

  const { counts, filtered } = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    const c = { messaging: 0, social: 0, education: 0, game: 0 };
    const list = notifications.filter((item) => {
      if (!item || typeof item !== 'object') return false;
      if (item.category && item.category in c) c[item.category as keyof typeof c]++;
      const matchCat = categoryFilter === 'all' || item.category === categoryFilter;
      const matchQ = !q || [item.appName, item.packageName, item.title, item.text].some((v) => String(v || '').toLowerCase().includes(q));
      return matchCat && matchQ;
    });
    return { counts: c, filtered: list };
  }, [notifications, searchTerm, categoryFilter]);

  if (!currentDevice) {
    return (
      <div className="bg-white rounded-2xl border border-[#e4e9e5] p-12 text-center text-neutral-500">
        <Bell className="w-12 h-12 text-neutral-300 mx-auto mb-3" />
        <h3 className="text-base font-bold text-neutral-800">No Paired Devices</h3>
        <p className="text-xs mt-1">Pair a device to inspect synchronized real-time notifications.</p>
      </div>
    );
  }

  const handleClear = async () => {
    if (!pairingCode) return;
    setClearing(true);
    try {
      await updateChildNotifications(pairingCode, []);
      setLiveList([]);
      setFeedback('Cleared notifications in Firebase RTDB');
    } finally {
      setClearing(false);
    }
  };

  const getCount = (id: CategoryFilter) => id === 'all' ? notifications.length : counts[id];

  return (
    <div className="space-y-5">
      <div className="bg-white rounded-xl border border-[#e4e9e5] p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-700 flex items-center justify-center border border-amber-100">
            <Bell className="w-5 h-5" />
          </div>
          <div>
            <span className="block text-[10px] font-bold text-[#71807b] uppercase">SELECT CHILD DEVICE</span>
            <select
              value={currentDevice.childId}
              onChange={(e) => { const d = devices.find((x) => x.childId === e.target.value); if (d) onSelectDevice(d); }}
              className="font-bold text-sm text-[#202b29] bg-transparent outline-none cursor-pointer"
            >
              {devices.map((d) => (
                <option key={d.childId} value={d.childId}>
                  {d.deviceModelName || `Device ${d.childId.slice(0, 8)}`} {d.pairingCode ? `(${d.pairingCode})` : ''}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-neutral-50 border border-neutral-200 text-xs">
            <Radio className={`w-3.5 h-3.5 ${isListening ? 'text-amber-500 animate-pulse' : 'text-emerald-500'}`} />
            <span className="font-mono text-[11px] text-neutral-600">/devices/{pairingCode || 'code'}/notifications</span>
          </div>
          {notifications.length > 0 && (
            <button onClick={handleClear} disabled={clearing} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200/60 disabled:opacity-50 cursor-pointer">
              <Trash2 className="w-3.5 h-3.5" /><span>Clear</span>
            </button>
          )}
        </div>
      </div>

      {feedback && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs px-4 py-2.5 rounded-xl flex items-center justify-between">
          <span className="flex items-center gap-2 font-medium"><CheckCircle2 className="w-4 h-4 text-emerald-600" />{feedback}</span>
          <button onClick={() => setFeedback(null)} className="font-bold">×</button>
        </div>
      )}

      {notifications.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'TOTAL NOTIFICATIONS', val: notifications.length, sub: 'Real-time Synced', cls: 'text-[#202b29]' },
            { label: 'MESSAGES & CHATS', val: counts.messaging, sub: 'WhatsApp, SMS, Telegram', cls: 'text-emerald-700' },
            { label: 'SOCIAL & MEDIA', val: counts.social, sub: 'YouTube, Social Media', cls: 'text-pink-700' },
            { label: 'EDUCATION & GAMES', val: counts.education + counts.game, sub: `${counts.education} school, ${counts.game} gaming`, cls: 'text-blue-700' },
          ].map((s) => (
            <div key={s.label} className="bg-white rounded-xl border border-[#e4e9e5] p-4">
              <span className="text-[10px] font-bold text-[#71807b] uppercase block">{s.label}</span>
              <span className={`text-2xl font-extrabold mt-1 block ${s.cls}`}>{s.val}</span>
              <span className="text-[10px] text-neutral-400">{s.sub}</span>
            </div>
          ))}
        </div>
      )}

      <div className="bg-white rounded-xl border border-[#e4e9e5] p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-neutral-100">
          <div className="flex flex-wrap items-center gap-1.5">
            {CATEGORIES.map((cat) => (
              <button
                key={cat.id}
                onClick={() => setCategoryFilter(cat.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer ${categoryFilter === cat.id ? 'bg-amber-100 text-amber-900 border border-amber-300' : 'bg-neutral-50 text-neutral-600 border border-neutral-200'}`}
              >
                {cat.label} {getCount(cat.id) > 0 ? `(${getCount(cat.id)})` : ''}
              </button>
            ))}
          </div>

          <div className="relative">
            <Search className="w-4 h-4 text-neutral-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search notifications…"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9 pr-7 py-1.5 rounded-lg text-xs bg-neutral-50 border border-neutral-200 focus:outline-none focus:border-amber-500 w-48 md:w-60"
            />
            {searchTerm && (
              <button onClick={() => setSearchTerm('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-neutral-400">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="py-12 px-6 text-center border-2 border-dashed border-neutral-200 rounded-xl bg-neutral-50/50">
            <Bell className="w-8 h-8 text-amber-600 mx-auto mb-2.5" />
            <h4 className="text-sm font-bold text-neutral-900">
              {notifications.length === 0 ? 'No notifications reported today' : 'No notifications match your filter'}
            </h4>
            <p className="text-xs text-neutral-500 max-w-md mx-auto mt-1">
              {notifications.length === 0
                ? `Listening to /devices/${pairingCode || 'code'}/notifications for background alerts.`
                : 'Try clearing the search text or switching the category filter.'}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-neutral-100">
            {filtered.map((item, idx) => (
              <div key={item.id || `notif_${idx}`} className="py-3 flex items-start gap-3 hover:bg-neutral-50/70 p-2 rounded-xl">
                <div className="w-9 h-9 rounded-xl bg-neutral-100 flex items-center justify-center shrink-0 border border-neutral-200 mt-0.5">
                  {getCatIcon(item.category)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold text-neutral-900 flex items-center gap-1.5">
                      {item.appName || 'Application'}
                      {item.category && <span className="text-[9px] uppercase px-1.5 py-0.5 rounded bg-neutral-100 text-neutral-600 border border-neutral-200">{item.category}</span>}
                    </span>
                    <span className="text-[11px] text-neutral-400 flex items-center gap-1">
                      <Clock className="w-3 h-3" />{formatTime(item.timestamp)}
                    </span>
                  </div>
                  {item.title && <h4 className="text-xs font-semibold text-neutral-800 mt-0.5">{item.title}</h4>}
                  {item.text && <p className="text-xs text-neutral-600 mt-0.5 line-clamp-2">{item.text}</p>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
