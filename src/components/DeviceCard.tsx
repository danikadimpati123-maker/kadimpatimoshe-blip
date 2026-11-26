import React from 'react';
import { 
  Smartphone, 
  Video, 
  MapPin, 
  Trash2, 
  Battery, 
  BatteryCharging, 
  CheckCircle2, 
  Clock 
} from 'lucide-react';
import { ParentChildDevice } from '../types';

interface DeviceCardProps {
  device: ParentChildDevice;
  onOpenLiveStream: (device: ParentChildDevice) => void;
  onOpenLocation: (device: ParentChildDevice) => void;
  onUnlink: (device: ParentChildDevice) => void;
  isSelected?: boolean;
  onToggleSelection?: (device: ParentChildDevice) => void;
}

export const DeviceCard: React.FC<DeviceCardProps> = ({
  device,
  onOpenLiveStream,
  onOpenLocation,
  onUnlink,
  isSelected = false,
  onToggleSelection,
}) => {
  // 1. మోడల్ నేమ్ కరెక్ట్గా పట్టుకోవడానికి అన్ని వేరియేషన్స్ చెక్ చేయడం
  const rawModelName = 
    device.deviceModelName || 
    device.telemetry?.deviceModelName || 
    (device as any).modelName || 
    (device as any).deviceName || 
    (device as any).name;

  const modelName = (!rawModelName || rawModelName === 'Android' || rawModelName.startsWith('Android 1'))
    ? `Device ${device.pairingCode || device.childId?.slice(0, 8) || 'Unknown'}`
    : rawModelName;

  const isOnline = device.isOnline ?? (device as any).online ?? false;
  const isPending = device.status === 'pending' || device.status === 'unpaired';

  // 2. బ్యాటరీ మరియు ఛార్జింగ్ సేఫ్ రీడింగ్ (రూట్ లేదా టెలిమెట్రీ ఆబ్జెక్ట్ నుండి)
  const batteryLevel = 
    device.telemetry?.batteryLevel !== undefined 
      ? device.telemetry.batteryLevel 
      : (device as any).batteryLevel !== undefined 
      ? (device as any).batteryLevel 
      : (device as any).battery ?? 100;

  const isCharging = 
    device.telemetry?.isCharging !== undefined 
      ? device.telemetry.isCharging 
      : (device as any).isCharging ?? false;

  // 3. లాస్ట్ హార్ట్బీట్ / లాస్ట్ సీన్ ఫార్మాటింగ్
  const rawHeartbeat = 
    device.lastHeartbeat || 
    device.lastSeen || 
    (device as any).timestamp || 
    (device as any).updatedAt;

  const formatLastSeen = (timestamp?: string | Date | number) => {
    if (!timestamp) return 'Recently';
    try {
      let date: Date;
      if (timestamp instanceof Date) {
        date = timestamp;
      } else if (typeof timestamp === 'number') {
        date = new Date(timestamp < 100000000000 ? timestamp * 1000 : timestamp);
      } else if (/^\d+$/.test(timestamp.trim())) {
        const num = Number(timestamp.trim());
        date = new Date(num < 100000000000 ? num * 1000 : num);
      } else {
        date = new Date(timestamp);
      }
      if (isNaN(date.getTime())) return 'Recently';
      const diffMs = Date.now() - date.getTime();
      const diffMins = Math.floor(diffMs / 60000);
      if (diffMins < 1) return 'Just now';
      if (diffMins < 60) return `${diffMins}m ago`;
      const diffHours = Math.floor(diffMins / 60);
      if (diffHours < 24) return `${diffHours}h ago`;
      return date.toLocaleDateString();
    } catch {
      return 'Recently';
    }
  };

  return (
    <article 
      className={`bg-white rounded-xl border p-5 shadow-xs hover:shadow-md transition-all flex flex-col justify-between group relative cursor-pointer ${
        isSelected ? 'border-emerald-500 ring-1 ring-emerald-500' : 'border-[#e4e9e5]'
      }`}
      onClick={() => onToggleSelection?.(device)}
    >
      {/* Selection Checkbox */}
      <div className="absolute top-4 right-4 z-10">
        <div 
          className={`w-5 h-5 rounded-md border flex items-center justify-center transition-all ${
            isSelected 
              ? 'bg-emerald-500 border-emerald-500 text-white' 
              : 'bg-white border-neutral-300 group-hover:border-emerald-400'
          }`}
        >
          {isSelected && <CheckCircle2 className="w-3.5 h-3.5" />}
        </div>
      </div>

      <div>
        {/* Card Top */}
        <div className="flex items-start justify-between gap-3 mb-4 pr-8">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-11 h-11 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0 border border-blue-100">
              <Smartphone className="w-5 h-5" />
            </div>
            <div className="min-w-0 flex-1">
              <span className="block text-[10px] font-bold text-[#71807b] tracking-wider uppercase">
                DEVICE MODEL NAME
              </span>
              {/* truncate తీసేసి full name లేదా wrap అయ్యేలా మార్చడం */}
              <h3 className="font-bold text-sm text-[#202b29] break-words" title={modelName}>
                {modelName}
              </h3>
            </div>
          </div>

          {/* Status Badge */}
          <span
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold shrink-0 ${
              device.status === 'regenerated'
                ? 'bg-amber-100 text-amber-900 border border-amber-300'
                : isPending
                ? 'bg-amber-100 text-amber-800'
                : isOnline
                ? 'bg-emerald-100 text-emerald-800'
                : 'bg-neutral-100 text-neutral-600'
            }`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                device.status === 'regenerated'
                  ? 'bg-amber-600 animate-ping'
                  : isPending
                  ? 'bg-amber-500'
                  : isOnline
                  ? 'bg-emerald-600 animate-pulse'
                  : 'bg-neutral-400'
              }`}
            />
            {device.status === 'regenerated' ? 'Re-link Needed' : isPending ? 'Pending' : isOnline ? 'Online' : 'Offline'}
          </span>
        </div>

        {/* Device Attributes Grid */}
        <div className="grid grid-cols-2 gap-2.5 py-3 border-y border-neutral-100 text-xs mb-3">
          <div>
            <span className="block text-[10px] font-bold text-[#71807b] uppercase">DEVICE ID</span>
            <span className="font-mono text-[11px] text-neutral-700 truncate block" title={device.deviceId || device.childId}>
              {device.deviceId ? device.deviceId.slice(0, 14) + '...' : device.childId}
            </span>
          </div>

          <div>
            <span className="block text-[10px] font-bold text-[#71807b] uppercase">PAIRING CODE</span>
            <span className="font-mono font-bold text-emerald-800 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200/50 inline-block">
              {device.pairingCode || '—'}
            </span>
          </div>

          <div>
            <span className="block text-[10px] font-bold text-[#71807b] uppercase">PLATFORM & STATE</span>
            <span className="text-neutral-700 capitalize truncate block">
              {device.platform || 'Android'} {device.appState ? `• ${device.appState}` : ''}
            </span>
          </div>

          <div>
            <span className="block text-[10px] font-bold text-[#71807b] uppercase">LAST HEARTBEAT</span>
            <span className="text-neutral-700 flex items-center gap-1">
              <Clock className="w-3 h-3 text-neutral-400" />
              {isOnline ? 'Active now' : formatLastSeen(rawHeartbeat)}
            </span>
          </div>
        </div>

        {/* Telemetry Summary & Counters Strip */}
        <div className="bg-neutral-50 rounded-lg p-3 mb-4 border border-neutral-100 space-y-2 text-xs">
          <div className="flex items-center justify-between gap-2 text-neutral-700">
            <div className="flex items-center gap-1.5 font-medium shrink-0">
              {isCharging ? (
                <BatteryCharging className="w-4 h-4 text-emerald-600" />
              ) : (
                <Battery className="w-4 h-4 text-neutral-500" />
              )}
              <span>Battery: {batteryLevel}%</span>
            </div>
            
            <span className="text-neutral-600 flex items-center gap-1 text-[11px] shrink-0">
              <Clock className="w-3.5 h-3.5 text-neutral-400" />
              {isOnline ? 'Active now' : formatLastSeen(rawHeartbeat)}
            </span>
          </div>
        </div>
      </div>

      {/* Card Actions */}
      <div className="flex items-center justify-between gap-2 pt-2" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => onOpenLiveStream(device)}
            disabled={isPending}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-[#3979c6] hover:bg-[#2d67aa] text-white transition-colors disabled:opacity-50 shadow-xs"
            title="Open real-time camera streaming with front/back lens toggle"
          >
            <Video className="w-3.5 h-3.5" />
            Live Stream
          </button>

          <button
            onClick={() => onOpenLocation(device)}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-neutral-100 hover:bg-neutral-200 text-neutral-700 transition-colors"
            title="Locate this device"
          >
            <MapPin className="w-3.5 h-3.5 text-neutral-500" />
            GPS
          </button>
        </div>

        <button
          onClick={() => onUnlink(device)}
          className="px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-bold transition-colors shadow-xs flex items-center gap-1.5"
          title={`Permanently delete ${modelName} from database`}
        >
          <Trash2 className="w-3.5 h-3.5" />
          <span>Delete Device</span>
        </button>
      </div>
    </article>
  );
};
