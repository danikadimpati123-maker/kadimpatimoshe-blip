import React, { useState, useEffect, useRef, useMemo, useCallback, Component, ErrorInfo, ReactNode } from 'react';
import {
  Shield,
  Smartphone,
  ScreenShare,
  Video,
  Mic,
  Phone,
  Mail,
  Copy,
  Check,
  RefreshCw,
  Radio,
  Wifi,
  Delete,
  ArrowRight,
  LogOut,
  Users,
  CheckCircle2,
  AlertCircle,
  Bell,
  Loader2,
  Search,
  Activity,
  SwitchCamera
} from 'lucide-react';
import {
  auth,
  database,
  sanitizeForRTDB,
  startHeartbeat,
  pushData,
  watchCmd,
  ackCmd,
  stopStreamNode,
  subscribeToChildDevices,
  subscribeToChildDeviceTelemetry,
  saveParentSession,
  pairChildDevice,
  deleteChildDevice,
  handleResetConsoleData,
  signInWithEmail,
  signUpWithEmail,
  signOut as fbSignOut,
  onAuthStateChanged,
  getOrCreateChildPairingCode,
  sendEmailVerification,
  detectDeviceName,
  syncDeviceName
} from './services/firebase';
import { startChildWebRTCSession, startChildScreenShareSession } from './services/webrtc';
import { pushNotif } from './services/notifPipeline';
import { ref, update, set, onDisconnect, get } from 'firebase/database';
import { ParentChildDevice, ConsoleNavSection, DeviceTelemetryData } from './types';
import { Header } from './components/Header';
import { Sidebar } from './components/Sidebar';
import { DeviceCard } from './components/DeviceCard';
import { LiveLocationView } from './components/LiveLocationView';
import { ScreenMirrorView } from './components/ScreenMirrorView';
import { LiveCameraModal } from './components/LiveCameraModal';
import { NotificationsView } from './components/NotificationsView';
import { CallLogsView } from './components/CallLogsView';
import { AppUsageView } from './components/AppUsageView';
import { AddChildModal } from './components/AddChildModal';
import { AuthModal } from './components/AuthModal';

type AppRole = 'parent' | 'child' | null;

export type RemoteControlCommand =
  | 'startStream'
  | 'stopStream'
  | 'startScreenShare'
  | 'stopScreenShare'
  | 'startAudio'
  | 'stopAudio'
  | 'switchCamera';

export const sendRemoteControlCommand = async (
  pairingCode: string,
  command: RemoteControlCommand,
  parentUid: string,
  extraPayload?: Record<string, any>
) => {
  if (!database || !pairingCode) return;
  const code = pairingCode.trim().toUpperCase();
  const controlRef = ref(database, `devices/${code}/control`);
  const commandId = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

  await update(controlRef, {
    cmd: command,
    command,
    id: commandId,
    commandId,
    ...(extraPayload || {}),
    sentBy: parentUid,
    ack: false,
    acknowledged: false,
    requestedAt: Date.now(),
  });
};

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

class ConsoleErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, message: '' };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, message: error.message || 'Unexpected UI error occurred.' };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[KidGuard ErrorBoundary]:', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#F4F6F4] flex items-center justify-center p-4">
          <div className="max-w-md w-full bg-white rounded-3xl border border-rose-200 p-6 shadow-lg text-center space-y-4">
            <div className="w-12 h-12 rounded-2xl bg-rose-50 text-rose-600 flex items-center justify-center mx-auto">
              <AlertCircle className="w-6 h-6" />
            </div>
            <h2 className="text-lg font-extrabold text-[#1D302B]">Console Recovery Mode</h2>
            <p className="text-xs text-[#71807B]">{this.state.message}</p>
            <button
              onClick={() => {
                this.setState({ hasError: false, message: '' });
                window.location.reload();
              }}
              className="px-4 py-2 rounded-xl bg-[#0A9B70] text-white text-xs font-bold hover:bg-[#087957] transition-colors"
            >
              Reload Console
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const generatePairingCode = (): string => {
  const chars = '0123456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `FG-${code}`;
};

const normalizeDeviceCode = (dev: ParentChildDevice): string =>
  (dev.pairingCode || dev.childId?.replace(/^child_|^dev_/, '') || dev.deviceId || '')
    .trim()
    .toUpperCase();

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }],
};

const AppContent: React.FC = () => {
  // ----------------------------------------------------
  // Authentication & Onboarding State
  // ----------------------------------------------------
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [isAuthLoading, setIsAuthLoading] = useState<boolean>(true);
  const [isAuthSubmitting, setIsAuthSubmitting] = useState<boolean>(false);
  const [currentUser, setCurrentUser] = useState<{ uid: string; email: string } | null>(null);

  const [selectedRole, setSelectedRole] = useState<AppRole>(() => {
    const saved = localStorage.getItem('kidguard_device_role');
    return saved === 'parent' || saved === 'child' ? saved : null;
  });
  const [rememberRole, setRememberRole] = useState<boolean>(true);

  const [emailInput, setEmailInput] = useState<string>('');
  const [passwordInput, setPasswordInput] = useState<string>('');
  const [passcodeError, setPasscodeError] = useState<string | null>(null);
  const [isRegistering, setIsRegistering] = useState<boolean>(false);
  const [verificationSent, setVerificationSent] = useState<boolean>(false);

  // Toast Notification
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => {
      setToastMessage(null);
    }, 3200);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  // ----------------------------------------------------
  // Parent Console State
  // ----------------------------------------------------
  const [currentSection, setCurrentSection] = useState<ConsoleNavSection>('devices');
  const [devices, setDevices] = useState<ParentChildDevice[]>([]);
  const [telemetryByCode, setTelemetryByCode] = useState<Record<string, DeviceTelemetryData>>({});
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isAddChildModalOpen, setIsAddChildModalOpen] = useState<boolean>(false);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState<boolean>(false);
  const [activeStreamingDevice, setActiveStreamingDevice] = useState<ParentChildDevice | null>(null);
  const [selectedChildIds, setSelectedChildIds] = useState<string[]>([]);
  const [isBulkDeleting, setIsBulkDeleting] = useState<boolean>(false);
  const hasAutoOpenedAddModalRef = useRef<boolean>(false);

  const liveDevices = useMemo<ParentChildDevice[]>(() => {
    return devices.map((dev) => {
      const code = normalizeDeviceCode(dev);
      const live = code ? telemetryByCode[code] : undefined;
      if (!live) return dev;

      const mergedTelemetry = {
        ...(dev.telemetry || {}),
        ...(live.telemetry || {}),
        deviceModelName:
          live.telemetry?.deviceModelName ||
          live.deviceModelName ||
          dev.telemetry?.deviceModelName ||
          dev.deviceModelName,
        batteryLevel:
          live.telemetry?.batteryLevel !== undefined
            ? live.telemetry.batteryLevel
            : dev.telemetry?.batteryLevel,
        isCharging:
          live.telemetry?.isCharging !== undefined
            ? live.telemetry.isCharging
            : dev.telemetry?.isCharging,
        updatedAt: live.telemetry?.updatedAt || Date.now(),
      };

      const mergedPresence = {
        ...(dev.presence || {}),
        ...(live.presence || {}),
        online: live.isOnline ?? live.presence?.online ?? dev.presence?.online ?? dev.isOnline,
        heartbeatAt: live.lastHeartbeat || live.presence?.heartbeatAt || dev.presence?.heartbeatAt,
        lastSeen: live.lastSeen || live.presence?.lastSeen || dev.presence?.lastSeen,
      };

      return {
        ...dev,
        isOnline: live.isOnline ?? dev.isOnline,
        deviceModelName:
          live.deviceModelName ||
          live.telemetry?.deviceModelName ||
          dev.deviceModelName,
        platform: live.platform || dev.platform,
        appState: live.appState || dev.appState,
        lastHeartbeat: live.lastHeartbeat || live.presence?.heartbeatAt || dev.lastHeartbeat,
        lastSeen: live.lastSeen || live.presence?.lastSeen || dev.lastSeen,
        presence: mergedPresence,
        telemetry: mergedTelemetry,
        location: live.location || dev.location,
        callLogs: live.callLogs && live.callLogs.length > 0 ? live.callLogs : dev.callLogs,
        appUsage: live.appUsage && live.appUsage.length > 0 ? live.appUsage : dev.appUsage,
        notifications: live.notifications && live.notifications.length > 0 ? live.notifications : dev.notifications,
      };
    });
  }, [devices, telemetryByCode]);

  const filteredDevices = useMemo<ParentChildDevice[]>(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return liveDevices;
    return liveDevices.filter(
      (d) =>
        (d.deviceModelName || '').toLowerCase().includes(q) ||
        (d.pairingCode || '').toLowerCase().includes(q) ||
        (d.childId || '').toLowerCase().includes(q)
    );
  }, [liveDevices, searchQuery]);

  const selectedDevice = useMemo<ParentChildDevice | null>(() => {
    if (liveDevices.length === 0) return null;
    if (!selectedDeviceId) return liveDevices[0];
    return liveDevices.find((d) => d.childId === selectedDeviceId) || liveDevices[0];
  }, [liveDevices, selectedDeviceId]);

  const setSelectedDevice = useCallback((device: ParentChildDevice | null) => {
    setSelectedDeviceId(device ? device.childId : null);
  }, []);

  const toggleDeviceSelection = useCallback((device: ParentChildDevice) => {
    setSelectedChildIds((prev) =>
      prev.includes(device.childId) ? prev.filter((id) => id !== device.childId) : [...prev, device.childId]
    );
  }, []);

  const handleSelectAll = useCallback(() => {
    setSelectedChildIds((prev) =>
      prev.length === filteredDevices.length && filteredDevices.length > 0
        ? []
        : filteredDevices.map((d) => d.childId)
    );
  }, [filteredDevices]);

  const handleBulkDelete = useCallback(async () => {
    if (selectedChildIds.length === 0) return;
    setIsBulkDeleting(true);
    let successCount = 0;
    let failCount = 0;

    try {
      await Promise.all(
        selectedChildIds.map(async (childId) => {
          const device = liveDevices.find((d) => d.childId === childId);
          if (!device) {
            failCount++;
            return;
          }
          const ok = await deleteChildDevice(
            device.pairingCode || device.deviceId || childId,
            childId,
            currentUser?.uid
          );
          if (ok) successCount++;
          else failCount++;
        })
      );

      if (failCount > 0) {
        showToast(`Deleted ${successCount}, failed ${failCount}. Check console logs.`);
      } else {
        showToast(`Deleted ${successCount} device(s).`);
      }
      setSelectedChildIds((prev) => prev.filter((id) => !selectedChildIds.includes(id)));
    } catch (err: any) {
      showToast(`Bulk delete error: ${err.message}`);
    } finally {
      setIsBulkDeleting(false);
    }
  }, [selectedChildIds, liveDevices, currentUser?.uid, showToast]);

  const handleClearAllDevices = useCallback(async () => {
    if (!currentUser) return;
    try {
      await handleResetConsoleData(currentUser.uid);
      setDevices([]);
      setTelemetryByCode({});
      setSelectedChildIds([]);
      showToast('Account reset successfully.');
    } catch (err: any) {
      showToast(`Reset failed: ${err.message}`);
    }
  }, [currentUser, showToast]);

  // ----------------------------------------------------
  // Child Protection Client State
  // ----------------------------------------------------
  const detectedDeviceName = useMemo(() => detectDeviceName(), []);
  const deviceName = detectedDeviceName;
  const deviceModel = detectedDeviceName;
  const [pairingCode, setPairingCode] = useState<string>('');
  const [copied, setCopied] = useState<boolean>(false);
  const lastTelemetryPushRef = useRef<number>(0);

  const childHardwareId = useMemo(() => {
    return currentUser?.uid ? `dev_${currentUser.uid.slice(0, 8)}` : `dev_${pairingCode}`;
  }, [currentUser?.uid, pairingCode]);

  const childRecordId = useMemo(() => `child_${childHardwareId}`, [childHardwareId]);

  const [batteryLevel, setBatteryLevel] = useState<number>(100);
  const [isCharging, setIsCharging] = useState<boolean>(false);
  const batteryHealth = 'Normal (Hardware Sensor)';
  const batteryTemp = 25.0;
  const batteryVoltage = 3.8;

  const [location, setLocation] = useState<{
    latitude: number;
    longitude: number;
    accuracy: number;
    speed: number;
    address: string;
    timestamp: number;
  }>({
    latitude: 0.0,
    longitude: 0.0,
    accuracy: 0.0,
    speed: 0.0,
    address: 'Awaiting hardware GPS fix…',
    timestamp: Date.now(),
  });

  // Streaming & Hardware Refs
  const [screenMirrorActive, setScreenMirrorActive] = useState<boolean>(false);
  const screenFps = 12;
  const [cameraStreamActive, setCameraStreamActive] = useState<boolean>(false);
  const [cameraFacing, setCameraFacing] = useState<'environment' | 'user'>('environment');
  const [audioStreamActive, setAudioStreamActive] = useState<boolean>(false);
  const [audioSignalingStatus, setAudioSignalingStatus] = useState<string>('');

  const childVideoPreviewRef = useRef<HTMLVideoElement>(null);
  const childScreenPreviewRef = useRef<HTMLVideoElement>(null);
  const cameraPeerRef = useRef<RTCPeerConnection | null>(null);
  const cameraVideoSenderRef = useRef<RTCRtpSender | null>(null);
  const childCameraStreamRef = useRef<MediaStream | null>(null);
  const isSwitchingCameraRef = useRef<boolean>(false);

  const childAudioStreamRef = useRef<MediaStream | null>(null);
  const audioPeerRef = useRef<RTCPeerConnection | null>(null);

  const [childStreamStatus, setChildStreamStatus] = useState<string>('');
  const [childScreenStatus, setChildScreenStatus] = useState<string>('');

  useEffect(() => {
    if (selectedRole === 'child' && currentUser && auth) {
      getOrCreateChildPairingCode(currentUser.uid, childHardwareId, deviceModel).then((code) => {
        const finalCode = code || generatePairingCode();
        setPairingCode(finalCode);
        syncDeviceName(finalCode, deviceModel).catch(() => {});
      });
    }
  }, [selectedRole, currentUser?.uid, childHardwareId, deviceModel]);

  useEffect(() => {
    if (selectedRole === 'child' && pairingCode) {
      syncDeviceName(pairingCode, deviceModel).catch(() => {});
    }
  }, [selectedRole, pairingCode, deviceModel]);

  const guardian = useMemo(
    () => ({
      name: 'Account Owner',
      phone: 'Linked',
      email: currentUser?.email || 'kadimpatimoshe@gmail.com',
      relationship: 'Primary Guardian',
      status: 'Verified Account • Auto-Synced',
    }),
    [currentUser?.email]
  );

  // ----------------------------------------------------
  // Auth Lifecycle
  // ----------------------------------------------------
  useEffect(() => {
    if (!auth) {
      setIsAuthLoading(false);
      return;
    }

    const unsubscribe = onAuthStateChanged(auth, (user: any) => {
      if (user) {
        const sessionUser = { uid: user.uid, email: user.email || '' };
        saveParentSession(sessionUser);
        setCurrentUser(sessionUser);
        setIsAuthenticated(true);
      } else {
        setCurrentUser(null);
        setIsAuthenticated(false);
      }
      setIsAuthLoading(false);
    });

    return () => unsubscribe();
  }, []);

  // ----------------------------------------------------
  // Parent Device & Live Telemetry Subscriptions
  // ----------------------------------------------------
  useEffect(() => {
    if (selectedRole !== 'parent' || !currentUser) return;
    const unsubscribe = subscribeToChildDevices(currentUser.uid, (list) =>
      setDevices(
        (list || []).filter(
          (d) =>
            d &&
            d.status !== 'deleted' &&
            d.status !== 'unpaired' &&
            d.isPaired !== false &&
            /^FG-/.test(String(d.pairingCode || '').trim().toUpperCase())
        )
      )
    );
    return () => unsubscribe();
  }, [selectedRole, currentUser?.uid]);

  useEffect(() => {
    if (selectedRole !== 'parent' || devices.length === 0) {
      setTelemetryByCode({});
      return;
    }

    const codes = Array.from(new Set(devices.map(normalizeDeviceCode).filter(Boolean)));

    const unsubs = codes.map((code) =>
      subscribeToChildDeviceTelemetry(code, (data) => {
        setTelemetryByCode((prev) => {
          if (!data) {
            if (!(code in prev)) return prev;
            const next = { ...prev };
            delete next[code];
            return next;
          }
          return { ...prev, [code]: data };
        });
      })
    );

    return () => unsubs.forEach((u) => u());
  }, [selectedRole, devices]);

  useEffect(() => {
    if (
      selectedRole === 'parent' &&
      isAuthenticated &&
      liveDevices.length === 0 &&
      !hasAutoOpenedAddModalRef.current
    ) {
      hasAutoOpenedAddModalRef.current = true;
      setIsAddChildModalOpen(true);
    }
  }, [selectedRole, isAuthenticated, liveDevices.length]);

  // ----------------------------------------------------
  // Child + Parent onDisconnect Presence & Heartbeat
  // ----------------------------------------------------
  useEffect(() => {
    if (selectedRole !== 'child' || !database || !pairingCode) return;

    const stopBeat = startHeartbeat(pairingCode);
    const devicePresenceRef = ref(database, `devices/${pairingCode}/presence/online`);
    set(devicePresenceRef, true).catch(() => {});
    onDisconnect(devicePresenceRef).set(false).catch(() => {});

    let parentPresenceRef: ReturnType<typeof ref> | null = null;
    let active = true;

    const bindParentPresence = async () => {
      try {
        const snap = await get(ref(database!, `devices/${pairingCode}`));
        const deviceData = snap.val();
        const targetParentUid = deviceData?.parentUid || currentUser?.uid;
        if (!active || !targetParentUid) return;

        let resolvedChildId = deviceData?.childId || childRecordId;
        const childrenSnap = await get(ref(database!, `parents/${targetParentUid}/children`));
        const childrenMap = childrenSnap.val() || {};

        const matchedEntry = Object.entries(childrenMap).find(([key, val]: [string, any]) => {
          const codeMatch = (val?.pairingCode || '').toUpperCase() === pairingCode.toUpperCase();
          const idMatch = key === resolvedChildId || val?.childId === resolvedChildId;
          return codeMatch || idMatch;
        });

        if (matchedEntry) {
          resolvedChildId = matchedEntry[0];
        }

        if (!active || !resolvedChildId) return;

        parentPresenceRef = ref(
          database!,
          `parents/${targetParentUid}/children/${resolvedChildId}/presence/online`
        );
        await set(parentPresenceRef, true);
        await onDisconnect(parentPresenceRef).set(false);
      } catch (err) {
        console.warn('[KidGuard] Parent presence binding skip:', err);
      }
    };

    bindParentPresence();

    return () => {
      active = false;
      stopBeat();
      set(devicePresenceRef, false).catch(() => {});
      if (parentPresenceRef) {
        set(parentPresenceRef, false).catch(() => {});
      }
    };
  }, [selectedRole, pairingCode, currentUser?.uid, childRecordId]);

  // ----------------------------------------------------
  // Event Sync (4s throttle) + Steady 20s Heartbeat via syncChildTelemetryRef
  // ----------------------------------------------------
  const syncChildTelemetry = useCallback(
    async (force = false) => {
      if (selectedRole !== 'child' || !database || !pairingCode) return;

      const now = Date.now();
      if (!force && now - lastTelemetryPushRef.current < 4000) return;
      lastTelemetryPushRef.current = now;

      try {
        const deviceRef = ref(database, `devices/${pairingCode}`);
        const snap = await get(deviceRef);
        const data = snap.val();

        if (!data || data.status === 'unpaired' || data.status === 'deleted' || !data.parentUid || data.isPaired === false) {
          return;
        }

        const nowTs = Date.now();
        const nowIso = new Date(nowTs).toISOString();
        const targetChildId = data.childId || childRecordId;

        const payload = sanitizeForRTDB({
          deviceId: childHardwareId,
          childId: targetChildId,
          deviceName,
          deviceModelName: deviceModel,
          pairingCode,
          status: 'active',
          platform: 'android',
          online: true,
          isOnline: true,
          ts: nowTs,
          lastHeartbeat: nowTs,
          lastSeen: nowIso,
          telemetry: {
            deviceModelName: deviceModel,
            platform: 'android',
            appState: document.visibilityState === 'visible' ? 'resumed' : 'background',
            batteryLevel,
            isCharging,
            batteryTemp,
            batteryVoltage,
            batteryHealth,
            updatedAt: nowTs,
          },
          location,
          presence: {
            online: true,
            heartbeatAt: nowTs,
            lastSeen: nowTs,
          },
          guardian,
        });

        await update(ref(database, `devices/${pairingCode}`), payload);
        await update(ref(database, `devices/${pairingCode}/telemetry/battery`), {
          level: batteryLevel,
          isCharging,
          temperature: batteryTemp,
          voltage: batteryVoltage,
          health: batteryHealth,
          updatedAt: nowTs,
        });
        await update(ref(database, `devices/${pairingCode}/location`), location);

        const parentUidToSync = data.parentUid || currentUser?.uid;
        if (parentUidToSync) {
          await update(ref(database, `parents/${parentUidToSync}/children/${targetChildId}`), {
            ...payload,
            childId: targetChildId,
            deviceId: childHardwareId,
            status: 'synced',
            isOnline: true,
            lastSeen: nowIso,
          });
        }
      } catch (e) {
        console.warn('[KidGuard] RTDB telemetry sync skip:', e);
      }
    },
    [
      selectedRole,
      pairingCode,
      childRecordId,
      childHardwareId,
      deviceName,
      deviceModel,
      batteryLevel,
      isCharging,
      batteryTemp,
      batteryVoltage,
      batteryHealth,
      location,
      guardian,
      currentUser?.uid,
    ]
  );

  const syncChildTelemetryRef = useRef<((force?: boolean) => Promise<void>) | null>(null);

  useEffect(() => {
    syncChildTelemetryRef.current = syncChildTelemetry;
  }, [syncChildTelemetry]);

  useEffect(() => {
    if (selectedRole !== 'child') return;
    void syncChildTelemetryRef.current?.(false);
  }, [selectedRole, batteryLevel, isCharging, location?.timestamp]);

  useEffect(() => {
    if (selectedRole !== 'child') return;

    void syncChildTelemetryRef.current?.(true);
    const heartbeatTimer = window.setInterval(() => {
      void syncChildTelemetryRef.current?.(true);
    }, 20000);

    return () => {
      window.clearInterval(heartbeatTimer);
    };
  }, [selectedRole]);

  const hasPushedActiveRef = useRef(false);

  useEffect(() => {
    if (selectedRole !== 'child' || !pairingCode || hasPushedActiveRef.current) return;
    hasPushedActiveRef.current = true;
    pushNotif(pairingCode, {
      appName: 'KidGuard',
      title: 'Protection Active',
      text: `${deviceModel} connected`,
      category: 'system',
    });
  }, [selectedRole, pairingCode, deviceModel]);

  // ----------------------------------------------------
  // Fast Camera Switch with replaceTrack & Error Rollback
  // ----------------------------------------------------
  const cleanupCameraHardware = useCallback(() => {
    if (childCameraStreamRef.current) {
      childCameraStreamRef.current.getTracks().forEach((track) => track.stop());
      childCameraStreamRef.current = null;
    }
    cameraVideoSenderRef.current = null;
    if (cameraPeerRef.current) {
      cameraPeerRef.current.close();
      cameraPeerRef.current = null;
    }
  }, []);

  const handleSwitchCameraFast = useCallback(
    async (targetFacing?: 'environment' | 'user') => {
      if (isSwitchingCameraRef.current) return;
      isSwitchingCameraRef.current = true;

      const previousFacing: 'environment' | 'user' = cameraFacing;
      const nextFacing: 'environment' | 'user' =
        targetFacing || (previousFacing === 'environment' ? 'user' : 'environment');

      setCameraFacing(nextFacing);
      setChildStreamStatus(`Switching to ${nextFacing === 'user' ? 'Front' : 'Back'} camera…`);

      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraFacing(previousFacing);
        showToast('Camera API unavailable');
        isSwitchingCameraRef.current = false;
        return;
      }

      try {
        const nextStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: nextFacing } },
          audio: false,
        });

        const nextVideoTrack = nextStream.getVideoTracks()[0];
        if (!nextVideoTrack) {
          nextStream.getTracks().forEach((t) => t.stop());
          throw new Error('No video track found on selected camera');
        }

        const existingAudioTracks = childCameraStreamRef.current?.getAudioTracks() || [];
        existingAudioTracks.forEach((audioTrack) => {
          nextStream.addTrack(audioTrack);
        });

        const videoSender =
          cameraVideoSenderRef.current ||
          cameraPeerRef.current?.getSenders().find((s) => s.track?.kind === 'video') ||
          null;

        if (videoSender) {
          await videoSender.replaceTrack(nextVideoTrack);
          cameraVideoSenderRef.current = videoSender;
        }

        if (childVideoPreviewRef.current) {
          childVideoPreviewRef.current.srcObject = nextStream;
        }

        if (childCameraStreamRef.current) {
          childCameraStreamRef.current.getVideoTracks().forEach((track) => track.stop());
        }
        childCameraStreamRef.current = nextStream;

        if (database && pairingCode) {
          await update(ref(database, `devices/${pairingCode}/stream`), {
            cameraFacing: nextFacing === 'user' ? 'front' : 'back',
            updatedAt: Date.now(),
          });
        }

        setChildStreamStatus(`Live (${nextFacing === 'user' ? 'Front Lens' : 'Back Lens'})`);
        showToast(`Switched to ${nextFacing === 'user' ? 'Front' : 'Back'} Camera`);
      } catch (err: any) {
        setCameraFacing(previousFacing);

        const friendly =
          err?.name === 'NotAllowedError'
            ? 'Camera access denied'
            : err?.name === 'OverconstrainedError'
            ? 'Requested lens not available on device'
            : err?.message || 'Switch failed';

        setChildStreamStatus(
          `Error: ${friendly} (Kept ${previousFacing === 'user' ? 'Front' : 'Back'} Lens)`
        );
        showToast(`Camera Switch Error: ${friendly}`);
      } finally {
        isSwitchingCameraRef.current = false;
      }
    },
    [cameraFacing, pairingCode, showToast]
  );

  // ----------------------------------------------------
  // Unified WebRTC Audio Stream Signaling (via startChildWebRTCSession)
  // ----------------------------------------------------
  const cleanupAudioWebRTC = useCallback(() => {
    if (audioPeerRef.current) {
      audioPeerRef.current.onicecandidate = null;
      audioPeerRef.current.onconnectionstatechange = null;
      audioPeerRef.current.close();
      audioPeerRef.current = null;
    }
    if (childAudioStreamRef.current) {
      childAudioStreamRef.current.getTracks().forEach((t) => t.stop());
      childAudioStreamRef.current = null;
    }
    setAudioSignalingStatus('');
  }, []);

  useEffect(() => {
    if (selectedRole !== 'child' || !audioStreamActive || !pairingCode) {
      cleanupAudioWebRTC();
      return;
    }

    let isMounted = true;
    let cleanupFn: (() => void) | null = null;

    startChildWebRTCSession(pairingCode, {
      mode: 'audio',
      onStream: (stream) => {
        childAudioStreamRef.current = stream;
      },
      onStatusChange: (status) => {
        if (isMounted) setAudioSignalingStatus(status);
      },
      onError: (err) => {
        if (!isMounted) return;
        const friendly = err.name === 'NotAllowedError' ? 'Microphone access denied' : err.message;
        setAudioSignalingStatus(`Error: ${friendly}`);
        showToast(`Audio Error: ${friendly}`);
        setAudioStreamActive(false);
        cleanupAudioWebRTC();
      },
    })
      .then((session) => {
        if (!isMounted) {
          session.cleanup();
          return;
        }
        cleanupFn = session.cleanup;
        audioPeerRef.current = session.peerConnection;
      })
      .catch((err: any) => {
        if (!isMounted) return;
        setAudioSignalingStatus(`Error: ${err.message}`);
        setAudioStreamActive(false);
        cleanupAudioWebRTC();
      });

    return () => {
      isMounted = false;
      cleanupFn?.();
      cleanupAudioWebRTC();
    };
  }, [selectedRole, audioStreamActive, pairingCode, cleanupAudioWebRTC, showToast]);

  // Remote Control Commands Listener (watchCmd + ackCmd)
  useEffect(() => {
    if (selectedRole !== 'child' || !pairingCode) return;

    const unsubscribe = watchCmd(pairingCode, async (val) => {
      const cmd = val.cmd || val.command;
      if (!cmd) return;

      if (cmd === 'startScreenShare') {
        setCameraStreamActive(false);
        setAudioStreamActive(false);
        setScreenMirrorActive(true);
        showToast('Parent started Screen Mirroring');
      } else if (cmd === 'stopScreenShare') {
        setScreenMirrorActive(false);
        await stopStreamNode(pairingCode).catch(() => {});
        showToast('Screen Mirroring stopped');
      } else if (cmd === 'startCamera' || cmd === 'startStream') {
        setAudioStreamActive(false);
        setScreenMirrorActive(false);
        setCameraStreamActive(true);
        showToast('Parent started Remote Camera stream');
      } else if (cmd === 'stopStream') {
        setCameraStreamActive(false);
        setAudioStreamActive(false);
        setScreenMirrorActive(false);
        await stopStreamNode(pairingCode).catch(() => {});
        showToast('Live stream stopped');
      } else if (cmd === 'startAudio') {
        setCameraStreamActive(false);
        setScreenMirrorActive(false);
        setAudioStreamActive(true);
        showToast('Parent started Live Audio stream');
      } else if (cmd === 'stopAudio') {
        setAudioStreamActive(false);
        await stopStreamNode(pairingCode).catch(() => {});
        showToast('Live Audio stream stopped');
      } else if (cmd === 'switchCamera') {
        const requestedFacing: 'environment' | 'user' | undefined =
          val.cameraFacing === 'front' || val.cameraFacing === 'user'
            ? 'user'
            : val.cameraFacing === 'back' || val.cameraFacing === 'environment'
            ? 'environment'
            : undefined;
        void handleSwitchCameraFast(requestedFacing);
      }

      await ackCmd(pairingCode).catch(() => {});
    });

    return () => unsubscribe();
  }, [pairingCode, selectedRole, handleSwitchCameraFast, showToast]);

  // Hardware Battery API
  useEffect(() => {
    if (selectedRole !== 'child' || !('getBattery' in navigator)) return;

    let batteryObj: any = null;
    const handleLevel = () => setBatteryLevel(Math.round(batteryObj.level * 100));
    const handleCharging = () => setIsCharging(Boolean(batteryObj.charging));

    (navigator as any)
      .getBattery()
      .then((bat: any) => {
        batteryObj = bat;
        setBatteryLevel(Math.round(bat.level * 100));
        setIsCharging(Boolean(bat.charging));
        bat.addEventListener('levelchange', handleLevel);
        bat.addEventListener('chargingchange', handleCharging);
      })
      .catch(() => {});

    return () => {
      if (batteryObj) {
        batteryObj.removeEventListener('levelchange', handleLevel);
        batteryObj.removeEventListener('chargingchange', handleCharging);
      }
    };
  }, [selectedRole]);

  // Child Camera WebRTC Session + Sender Binding
  useEffect(() => {
    if (selectedRole !== 'child' || !cameraStreamActive || !pairingCode) {
      cleanupCameraHardware();
      return;
    }

    let active = true;
    let cleanupFn: (() => void) | null = null;

    startChildWebRTCSession(pairingCode, {
      onStream: (stream) => {
        childCameraStreamRef.current = stream;
        if (active && childVideoPreviewRef.current) {
          childVideoPreviewRef.current.srcObject = stream;
        }
      },
      onStatusChange: (status) => {
        if (active) setChildStreamStatus(status);
      },
      onError: (err) => {
        if (!active) return;
        const friendly = err.name === 'NotAllowedError' ? 'Camera/Mic access denied' : err.message;
        setChildStreamStatus(`Error: ${friendly}`);
        showToast(`Camera Error: ${friendly}`);
        setCameraStreamActive(false);
        cleanupCameraHardware();
      },
    })
      .then((session: any) => {
        if (!active) {
          session?.cleanup?.();
          return;
        }
        cleanupFn = session?.cleanup || null;
        if (session?.peerConnection) {
          cameraPeerRef.current = session.peerConnection;
          const vSender = session.peerConnection.getSenders().find((s: RTCRtpSender) => s.track?.kind === 'video');
          if (vSender) cameraVideoSenderRef.current = vSender;
        }
      })
      .catch((err: any) => {
        if (!active) return;
        setChildStreamStatus(`Failed to start stream: ${err.message}`);
        setCameraStreamActive(false);
        cleanupCameraHardware();
      });

    return () => {
      active = false;
      cleanupFn?.();
      cleanupCameraHardware();
    };
  }, [selectedRole, cameraStreamActive, pairingCode, cleanupCameraHardware, showToast]);

  // Child Screen Share WebRTC Session
  useEffect(() => {
    if (selectedRole !== 'child' || !screenMirrorActive || !pairingCode) return;

    let active = true;
    let cleanupFn: (() => void) | null = null;

    startChildScreenShareSession(pairingCode, {
      onStream: (stream) => {
        if (active && childScreenPreviewRef.current) {
          childScreenPreviewRef.current.srcObject = stream;
        }
      },
      onStatusChange: (status) => {
        if (active) setChildScreenStatus(status);
      },
      onError: (err) => {
        if (!active) return;
        const friendly = err.name === 'NotAllowedError' ? 'Screen sharing denied' : err.message;
        setChildScreenStatus(`Error: ${friendly}`);
        showToast(`Screen Error: ${friendly}`);
        setScreenMirrorActive(false);
      },
    })
      .then((session) => {
        if (active) cleanupFn = session.cleanup;
        else session.cleanup();
      })
      .catch((err: any) => {
        if (!active) return;
        setChildScreenStatus(`Failed to start screen mirror: ${err.message}`);
        setScreenMirrorActive(false);
      });

    return () => {
      active = false;
      cleanupFn?.();
    };
  }, [selectedRole, screenMirrorActive, pairingCode, showToast]);

  // Hardware Geolocation Listener
  useEffect(() => {
    if (selectedRole !== 'child' || !('geolocation' in navigator)) return;

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const lat = Number(pos.coords.latitude.toFixed(6));
        const lon = Number(pos.coords.longitude.toFixed(6));
        const acc = Math.round(pos.coords.accuracy || 5);
        const spd = Number((pos.coords.speed ? pos.coords.speed * 3.6 : 0.0).toFixed(1));
        const ts = pos.timestamp || Date.now();
        const address = `Real GPS Fix: ${lat.toFixed(4)}°, ${lon.toFixed(4)}° (±${acc}m)`;

        setLocation((prev) =>
          prev.latitude === lat && prev.longitude === lon && prev.timestamp === ts
            ? prev
            : { latitude: lat, longitude: lon, accuracy: acc, speed: spd, address, timestamp: ts }
        );

        if (pairingCode) {
          pushData(pairingCode, 'location', {
            lat,
            lng: lon,
            acc,
            latitude: lat,
            longitude: lon,
            accuracy: acc,
            speed: spd,
            address,
            timestamp: ts,
          }).catch(() => {});
        }
      },
      (err) => console.warn('[KidGuard] Geolocation notice:', err.message),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 }
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, [selectedRole, pairingCode]);

  // ----------------------------------------------------
  // Handlers
  // ----------------------------------------------------
  const handleEmailAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!emailInput || !passwordInput) {
      setPasscodeError('Please enter both email and password.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailInput)) {
      setPasscodeError('Please enter a valid email address.');
      return;
    }

    setIsAuthSubmitting(true);
    setPasscodeError(null);
    try {
      if (isRegistering) {
        const user = await signUpWithEmail(emailInput, passwordInput);
        if (user) {
          await sendEmailVerification(user);
          await fbSignOut();
          setVerificationSent(true);
          showToast('Verification email sent!');
        }
      } else {
        const user = await signInWithEmail(emailInput, passwordInput);
        if (user) {
          if (!user.emailVerified) {
            await fbSignOut();
            setPasscodeError('Please verify your email address before signing in.');
            return;
          }
          setCurrentUser({ uid: user.uid, email: user.email || '' });
          setIsAuthenticated(true);
          showToast('Signed In Successfully');
        }
      }
    } catch (err: any) {
      const errorMap: Record<string, string> = {
        'auth/invalid-credential': 'Invalid email or password.',
        'auth/too-many-requests': 'Too many attempts. Please try again later.',
        'auth/user-not-found': 'No account found with this email.',
        'auth/email-already-in-use': 'This email is already registered.',
        'auth/weak-password': 'Password should be at least 6 characters.',
      };
      setPasscodeError(errorMap[err.code] || 'Authentication failed.');
    } finally {
      setIsAuthSubmitting(false);
    }
  };

  const handleSignOut = async () => {
    cleanupAudioWebRTC();
    cleanupCameraHardware();
    await fbSignOut();
    setCurrentUser(null);
    setIsAuthenticated(false);
    setSelectedRole(null);
    hasAutoOpenedAddModalRef.current = false;
    hasPushedActiveRef.current = false;
    showToast('Signed Out');
  };

  const handleSelectRole = (role: AppRole) => {
    setSelectedRole(role);
    if (rememberRole && role) {
      localStorage.setItem('kidguard_device_role', role);
    }
    showToast(role === 'parent' ? 'Parent Console Activated' : 'Child Protection Client Activated');
  };

  const handleSwitchRole = () => {
    cleanupAudioWebRTC();
    cleanupCameraHardware();
    setAudioStreamActive(false);
    setCameraStreamActive(false);
    setScreenMirrorActive(false);
    hasPushedActiveRef.current = false;
    localStorage.removeItem('kidguard_device_role');
    setSelectedRole(null);
  };

  const handleToggleScreenMirror = () => {
    const next = !screenMirrorActive;
    setScreenMirrorActive(next);
    showToast(next ? 'Screen Mirroring started' : 'Screen Mirroring stopped');
    if (database) {
      update(ref(database, `devices/${pairingCode}/screen`), {
        status: next ? 'streaming' : 'standby',
        isSharing: next,
        fps: screenFps,
        updatedAt: Date.now(),
      }).catch(() => {});
    }
  };

  const handleToggleCameraStream = () => {
    const next = !cameraStreamActive;
    setCameraStreamActive(next);
    showToast(next ? 'Remote Camera Stream active' : 'Remote Camera Stream stopped');
    if (database) {
      update(ref(database, `devices/${pairingCode}/stream`), {
        status: next ? 'active' : 'stopped',
        cameraFacing: cameraFacing === 'user' ? 'front' : 'back',
        updatedAt: Date.now(),
      }).catch(() => {});
    }
  };

  const handleToggleAudioStream = () => {
    const next = !audioStreamActive;
    setAudioStreamActive(next);
    showToast(next ? 'Starting WebRTC Audio Stream...' : 'Stopping WebRTC Audio Stream');
  };

  const handleCopyPairingCode = () => {
    navigator.clipboard?.writeText(pairingCode);
    setCopied(true);
    showToast(`Pairing code ${pairingCode} copied`);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleGenerateNewCode = async () => {
    if (!currentUser) {
      showToast('Please sign in first to regenerate code');
      return;
    }
    const newCode = generatePairingCode();
    const resolvedName = detectDeviceName() || deviceModel;
    setPairingCode(newCode);
    showToast(`Fresh binding code generated: ${newCode}`);

    if (database) {
      await update(ref(database), {
        [`user_pairing_codes/${currentUser.uid}`]: newCode,
        [`devices/${newCode}`]: {
          deviceId: childHardwareId,
          childId: childRecordId,
          pairingCode: newCode,
          deviceName: resolvedName,
          deviceModelName: resolvedName,
          status: 'pending',
          online: true,
          ts: Date.now(),
          updatedAt: Date.now(),
        },
      }).catch(() => {});
    }
  };

  const handlePairChild = async (code: string, modelName: string) => {
    if (!currentUser) throw new Error('Parent not authenticated');
    const newDevice = await pairChildDevice(currentUser.uid, code, modelName);
    showToast(`Paired device with code ${code}`);
    return newDevice;
  };

  const handleUnlinkDevice = async (device: ParentChildDevice) => {
    if (!currentUser) return;
    showToast(`Unlinking ${device.deviceModelName}...`);
    const ok = await deleteChildDevice(
      device.pairingCode || device.deviceId || '',
      device.childId,
      currentUser.uid
    );
    if (!ok) return showToast('Failed to unlink device. Check console logs.');
    const code = normalizeDeviceCode(device);
    setDevices((prev) =>
      prev.filter((d) => d.childId !== device.childId && d.deviceId !== device.deviceId)
    );
    if (code) {
      setTelemetryByCode((prev) => {
        const { [code]: _, ...rest } = prev;
        return rest;
      });
    }
    setSelectedChildIds((prev) => prev.filter((id) => id !== device.childId));
    showToast(`Unlinked ${device.deviceModelName}`);
  };

  // ----------------------------------------------------
  // Render States
  // ----------------------------------------------------
  if (isAuthLoading) {
    return (
      <div className="min-h-screen bg-[#F4F6F4] flex flex-col items-center justify-center p-4">
        <div className="w-16 h-16 rounded-2xl bg-[#0A9B70] text-white flex items-center justify-center shadow-lg animate-pulse mb-3">
          <Shield className="w-8 h-8" />
        </div>
        <h2 className="text-lg font-bold text-[#1D302B]">Secure Family Supervision</h2>
        <div className="flex items-center gap-2 text-xs text-[#71807B] font-medium mt-1">
          <Loader2 className="w-3.5 h-3.5 animate-spin text-[#0A9B70]" />
          Initializing secure session…
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-[#F4F6F4] flex flex-col items-center justify-center p-4">
        {toastMessage && (
          <div className="fixed top-5 z-50 bg-[#192723] text-white text-xs font-semibold px-4 py-2.5 rounded-full shadow-lg flex items-center gap-2 border border-emerald-500/30">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span>{toastMessage}</span>
          </div>
        )}

        <div className="w-full max-w-md bg-white rounded-3xl border border-[#E4E9E5] p-6 sm:p-8 shadow-xl">
          <div className="text-center mb-6">
            <div className="w-16 h-16 rounded-2xl bg-[#0A9B70] text-white flex items-center justify-center mx-auto mb-3 shadow-md shadow-emerald-700/20">
              <Shield className="w-8 h-8" />
            </div>
            <h1 className="text-2xl font-extrabold text-[#1D302B] tracking-tight">KidGuard Protection</h1>
            <p className="text-xs text-[#71807B] mt-1">
              {isRegistering ? 'Register to manage family devices' : 'Secure family supervision and child safety platform'}
            </p>
          </div>

          {verificationSent ? (
            <div className="text-center space-y-4">
              <div className="p-4 bg-emerald-50 text-emerald-700 rounded-xl border border-emerald-100 text-sm">
                <CheckCircle2 className="w-8 h-8 mx-auto mb-2 text-emerald-500" />
                <p className="font-bold">Verification Email Sent!</p>
                <p className="text-xs mt-1">Verify your inbox ({emailInput}) before signing in.</p>
              </div>
              <button
                onClick={() => {
                  setVerificationSent(false);
                  setIsRegistering(false);
                  setEmailInput('');
                  setPasswordInput('');
                }}
                className="text-xs font-bold text-[#0A9B70] hover:underline"
              >
                Back to Sign In
              </button>
            </div>
          ) : (
            <form onSubmit={handleEmailAuthSubmit} className="space-y-4">
              {passcodeError && (
                <div className="p-3 bg-rose-50 border border-rose-100 text-rose-600 text-xs rounded-xl flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{passcodeError}</span>
                </div>
              )}

              <div>
                <label className="block text-xs font-bold text-[#1D302B] mb-1">Email Address</label>
                <input
                  type="email"
                  value={emailInput}
                  onChange={(e) => setEmailInput(e.target.value)}
                  className="w-full h-10 px-3 text-xs bg-[#F9FAF9] border border-[#E4E9E5] rounded-xl focus:border-[#0A9B70] focus:ring-2 focus:ring-emerald-100 outline-none text-[#1D302B]"
                  placeholder="parent@example.com"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-[#1D302B] mb-1">Password</label>
                <input
                  type="password"
                  value={passwordInput}
                  onChange={(e) => setPasswordInput(e.target.value)}
                  className="w-full h-10 px-3 text-xs bg-[#F9FAF9] border border-[#E4E9E5] rounded-xl focus:border-[#0A9B70] focus:ring-2 focus:ring-emerald-100 outline-none text-[#1D302B]"
                  placeholder="••••••••"
                  required
                />
              </div>

              <button
                type="submit"
                disabled={isAuthSubmitting}
                className="w-full h-10 rounded-xl text-xs font-bold bg-[#0A9B70] hover:bg-[#087957] disabled:opacity-60 text-white transition-colors flex items-center justify-center gap-2"
              >
                {isAuthSubmitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>{isRegistering ? 'Create Account' : 'Sign In to KidGuard'}</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setIsRegistering((prev) => !prev);
                  setPasscodeError(null);
                }}
                className="w-full text-center text-xs text-[#0A9B70] hover:underline font-semibold"
              >
                {isRegistering ? 'Already have an account? Sign In' : 'New to KidGuard? Create account'}
              </button>
            </form>
          )}
        </div>
      </div>
    );
  }

  if (selectedRole === null) {
    return (
      <div className="min-h-screen bg-[#F4F6F4] flex flex-col items-center justify-center p-4">
        <div className="w-full max-w-xl bg-white rounded-3xl border border-[#E4E9E5] p-6 sm:p-8 shadow-xl">
          <div className="flex items-center justify-between pb-4 border-b border-[#E4E9E5] mb-6">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-[#0A9B70] text-white flex items-center justify-center">
                <Shield className="w-4 h-4" />
              </div>
              <span className="text-sm font-bold text-[#1D302B]">KidGuard Setup</span>
            </div>
            <button
              onClick={handleSignOut}
              className="text-xs text-[#71807B] hover:text-rose-600 flex items-center gap-1 font-semibold"
            >
              <LogOut className="w-3.5 h-3.5" />
              Sign Out
            </button>
          </div>

          <div className="text-center mb-6">
            <span className="px-3 py-1 rounded-full text-[10px] font-extrabold uppercase bg-emerald-50 text-[#0A9B70] border border-emerald-200">
              Step 2 of 2: Device Role
            </span>
            <h2 className="text-2xl font-extrabold text-[#1D302B] tracking-tight mt-2">
              Who is using this device?
            </h2>
            <p className="text-xs text-[#71807B] mt-1 max-w-md mx-auto">
              Select the role for this session. Switch roles anytime from the top bar.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <button
              onClick={() => handleSelectRole('parent')}
              className="p-5 rounded-2xl border-2 border-emerald-500 bg-[#F8FAF9] hover:bg-emerald-50/70 text-left transition-all hover:shadow-md group flex flex-col justify-between"
            >
              <div>
                <div className="w-12 h-12 rounded-xl bg-emerald-100 text-[#0A9B70] flex items-center justify-center mb-3">
                  <Users className="w-6 h-6" />
                </div>
                <h3 className="text-base font-extrabold text-[#1D302B]">I am a Parent</h3>
                <span className="text-[11px] font-bold text-[#0A9B70] block mt-0.5">Parent Monitoring Console</span>
                <p className="text-xs text-[#71807B] mt-2 leading-relaxed">
                  Pair via child binding code. Track live GPS, screen mirror, camera streams, calls, and app usage.
                </p>
              </div>
              <div className="mt-4 pt-3 border-t border-emerald-200/60 flex items-center justify-between text-xs font-bold text-[#0A9B70]">
                <span>Open Parent Dashboard</span>
                <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
              </div>
            </button>

            <button
              onClick={() => handleSelectRole('child')}
              className="p-5 rounded-2xl border-2 border-[#E4E9E5] hover:border-emerald-500 bg-[#F8FAF9] hover:bg-emerald-50/70 text-left transition-all hover:shadow-md group flex flex-col justify-between"
            >
              <div>
                <div className="w-12 h-12 rounded-xl bg-blue-100 text-blue-600 flex items-center justify-center mb-3">
                  <Smartphone className="w-6 h-6" />
                </div>
                <h3 className="text-base font-extrabold text-[#1D302B]">I am a Child</h3>
                <span className="text-[11px] font-bold text-blue-600 block mt-0.5">Child Protection Client</span>
                <p className="text-xs text-[#71807B] mt-2 leading-relaxed">
                  Generates a secure binding code and syncs battery, GPS, and active protection services.
                </p>
              </div>
              <div className="mt-4 pt-3 border-t border-neutral-200/60 flex items-center justify-between text-xs font-bold text-neutral-700 group-hover:text-[#0A9B70]">
                <span>Open Child Client</span>
                <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
              </div>
            </button>
          </div>

          <div className="mt-6 flex items-center text-xs text-[#71807B]">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={rememberRole}
                onChange={(e) => setRememberRole(e.target.checked)}
                className="rounded border-[#E4E9E5] text-[#0A9B70] focus:ring-[#0A9B70]"
              />
              <span>Remember role on this browser</span>
            </label>
          </div>
        </div>
      </div>
    );
  }

  if (selectedRole === 'child') {
    return (
      <div className="min-h-screen bg-[#F4F6F4] text-[#1D302B] flex flex-col items-center">
        {toastMessage && (
          <div className="fixed top-5 z-50 bg-[#192723] text-white text-xs font-semibold px-4 py-2.5 rounded-full shadow-lg flex items-center gap-2 border border-emerald-500/30">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span>{toastMessage}</span>
          </div>
        )}

        <div className="w-full bg-[#192723] text-white px-4 py-2 border-b border-emerald-950 flex items-center justify-between text-xs">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="font-bold">
              Device Mode: <span className="text-[#34D399]">Child Protection Client</span>
            </span>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={handleSwitchRole}
              className="text-xs bg-white/10 hover:bg-white/20 px-2.5 py-1 rounded-md text-emerald-300 font-bold transition-colors"
            >
              ⇄ Switch to Parent Console
            </button>
            <button onClick={handleSignOut} className="text-neutral-400 hover:text-white" title="Sign Out">
              <LogOut className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        <header className="w-full bg-white border-b border-[#E4E9E5] sticky top-0 z-30">
          <div className="max-w-2xl mx-auto px-4 sm:px-6 py-3.5 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-[#0A9B70] flex items-center justify-center text-white shadow-xs">
                <Shield className="w-4 h-4" />
              </div>
              <div>
                <h1 className="text-sm font-bold text-[#1D302B] leading-none">KidGuard Protection</h1>
                <span className="text-[10px] text-[#71807B] leading-tight block mt-0.5">
                  Continuous Foreground Service Active
                </span>
              </div>
            </div>

            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#ECFDF5] border border-[#A7F3D0] text-[11px] font-bold text-[#065F46]">
              <span className="w-2 h-2 rounded-full bg-[#10B981] animate-pulse" />
              Live Synced • {batteryLevel}%{isCharging ? ' ⚡' : ''}
            </div>
          </div>
        </header>

        <main className="w-full max-w-2xl px-4 sm:px-6 py-6 space-y-4 flex-1">
          <div className="rounded-2xl p-6 bg-gradient-to-br from-[#192723] to-[#263D36] text-white shadow-md relative overflow-hidden">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-400" />
                <span className="text-[10px] font-extrabold tracking-wider uppercase text-[#91D5AD]">ACTIVE DEVICE</span>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={handleGenerateNewCode}
                  className="bg-white/10 hover:bg-white/20 text-white px-2.5 py-1 rounded-lg text-xs flex items-center gap-1"
                >
                  <RefreshCw className="w-3 h-3" />
                  <span>Regenerate</span>
                </button>

                <button
                  onClick={handleCopyPairingCode}
                  className="inline-flex items-center gap-1.5 bg-white/10 hover:bg-white/20 active:scale-95 transition-all text-white px-3 py-1 rounded-lg border border-white/15 text-xs font-mono"
                >
                  <span className="text-[11px] text-white/70">Pairing Code:</span>
                  <span className="font-extrabold text-[#34D399] tracking-wider">{pairingCode}</span>
                  {copied ? (
                    <Check className="w-3.5 h-3.5 text-emerald-300" />
                  ) : (
                    <Copy className="w-3.5 h-3.5 text-white/70" />
                  )}
                </button>
              </div>
            </div>

            <div className="mt-4">
              <h2 className="text-2xl font-extrabold text-white tracking-tight">{deviceName}</h2>
              <p className="text-xs text-[#9EB5AB] mt-0.5">{deviceModel}</p>
            </div>

            <div className="mt-5 pt-4 border-t border-white/10 flex flex-wrap items-center justify-between gap-2 text-[11px]">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-white/10 text-white/90">
                <Wifi className="w-3 h-3 text-emerald-400" />
                Firebase RTDB: /devices/{pairingCode}
              </span>
              <span className="text-white/70">{location.address}</span>
            </div>
          </div>

          <div className="bg-white rounded-3xl p-6 sm:p-8 border border-[#E4E9E5] shadow-xl text-center space-y-5">
            <div className="w-20 h-20 rounded-full bg-emerald-50 text-[#0A9B70] flex items-center justify-center mx-auto border-4 border-emerald-100/50">
              <Shield className="w-10 h-10" />
            </div>

            <div>
              <h3 className="text-xl font-black text-[#1D302B] tracking-tight">Device Protected</h3>
              <p className="text-sm text-[#71807B] mt-1.5">
                Supervision services and telemetry synchronization are running for this device.
              </p>
            </div>

            <div className="pt-3 border-t border-[#F1F5F2] flex flex-col gap-2.5">
              <div className="flex items-center justify-between text-xs font-bold text-[#71807B] bg-[#F8FAF9] p-3 rounded-2xl border border-[#E8ECE9]">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  <span>Background Monitoring</span>
                </div>
                <span className="text-[#0A9B70]">ACTIVE</span>
              </div>

              <div className="flex items-center justify-between text-xs font-bold text-[#71807B] bg-[#F8FAF9] p-3 rounded-2xl border border-[#E8ECE9]">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
                  <span>Safe GPS Tracking</span>
                </div>
                <span className="text-blue-600">ACTIVE</span>
              </div>

              {childStreamStatus.toLowerCase().includes('denied') && (
                <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-800 text-xs text-left">
                  <p className="font-bold mb-1">Access Denied</p>
                  <p>Reset browser site permissions via the address bar icon and refresh.</p>
                </div>
              )}

              <button
                onClick={async () => {
                  try {
                    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
                    stream.getTracks().forEach((t) => t.stop());
                    setChildStreamStatus('Access active');
                    showToast('Camera & Mic permissions granted!');
                  } catch (err: any) {
                    const friendly = err.name === 'NotAllowedError' ? 'Permission denied' : err.message;
                    setChildStreamStatus(`Error: ${friendly}`);
                    showToast(`Error: ${friendly}`);
                  }
                }}
                className="w-full py-3 rounded-2xl bg-[#0A9B70] text-white text-xs font-bold hover:bg-[#087957] transition-colors shadow-sm"
              >
                Grant Camera & Mic Access
              </button>
            </div>
          </div>

          <div className="bg-white rounded-3xl p-6 border border-[#E4E9E5] shadow-xs">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xs font-black text-[#1D302B] tracking-widest uppercase">LATEST SYSTEM ALERTS</h3>
              <Bell className="w-4 h-4 text-[#71807B]" />
            </div>

            <div className="space-y-3">
              <div className="p-3 rounded-2xl bg-emerald-50/50 border border-emerald-100 flex items-start gap-3">
                <div className="w-8 h-8 rounded-xl bg-white flex items-center justify-center shadow-xs shrink-0">
                  <Shield className="w-4 h-4 text-[#0A9B70]" />
                </div>
                <div>
                  <p className="text-[11px] font-bold text-[#1D302B]">Security Sync Active</p>
                  <p className="text-[10px] text-[#71807B]">Battery: {batteryLevel}% • Voltage: {batteryVoltage}V</p>
                </div>
              </div>
              <div className="p-3 rounded-2xl bg-indigo-50/50 border border-indigo-100 flex items-start gap-3">
                <div className="w-8 h-8 rounded-xl bg-white flex items-center justify-center shadow-xs shrink-0">
                  <Radio className="w-4 h-4 text-indigo-600" />
                </div>
                <div>
                  <p className="text-[11px] font-bold text-[#1D302B]">Background Service Running</p>
                  <p className="text-[10px] text-[#71807B]">Continuous protection active for {pairingCode}</p>
                </div>
              </div>
            </div>
          </div>

          {/* Active Background Services */}
          <div className="space-y-2.5 pt-2">
            <div className="flex items-center justify-between px-1">
              <h3 className="text-xs font-extrabold text-[#71807B] tracking-wider uppercase">
                ACTIVE BACKGROUND SERVICES
              </h3>
              <span className="text-[10px] text-[#71807B]">Android 14 Foreground Types</span>
            </div>

            {/* Screen Mirror */}
            <div className={`bg-white rounded-2xl p-4 border transition-all ${screenMirrorActive ? 'border-[#0A9B70] shadow-sm' : 'border-[#E4E9E5]'}`}>
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${screenMirrorActive ? 'bg-indigo-100 text-indigo-700' : 'bg-neutral-100 text-neutral-500'}`}>
                    <ScreenShare className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h4 className="text-sm font-bold text-[#1D302B]">Screen Mirroring Service</h4>
                      <span className={`px-2 py-0.5 rounded-md text-[9px] font-extrabold uppercase ${screenMirrorActive ? 'bg-[#ECFDF5] border border-[#A7F3D0] text-[#065F46] animate-pulse' : 'bg-neutral-100 text-neutral-500'}`}>
                        {screenMirrorActive ? 'STREAMING' : 'STANDBY'}
                      </span>
                    </div>
                    <p className="text-[11px] text-[#71807B] mt-0.5">
                      MediaProjection foreground capture to /devices/{pairingCode}/screen
                    </p>
                    {screenMirrorActive && (
                      <div className="mt-3 relative rounded-xl overflow-hidden bg-black aspect-video border border-indigo-500/30">
                        <video ref={childScreenPreviewRef} autoPlay playsInline muted className="w-full h-full object-cover" />
                        {childScreenStatus && (
                          <div className="absolute bottom-0 inset-x-0 bg-black/60 p-1.5 text-[9px] text-white text-center">
                            {childScreenStatus}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                <button
                  type="button"
                  role="switch"
                  aria-checked={screenMirrorActive}
                  onClick={handleToggleScreenMirror}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${screenMirrorActive ? 'bg-[#0A9B70]' : 'bg-neutral-300'}`}
                >
                  <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-md transition ${screenMirrorActive ? 'translate-x-5' : 'translate-x-0'}`} />
                </button>
              </div>
            </div>

            {/* Camera Stream */}
            <div className={`bg-white rounded-2xl p-4 border transition-all ${cameraStreamActive ? 'border-[#0A9B70] shadow-sm' : 'border-[#E4E9E5]'}`}>
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${cameraStreamActive ? 'bg-emerald-100 text-[#0A9B70]' : 'bg-neutral-100 text-neutral-500'}`}>
                    <Video className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <h4 className="text-sm font-bold text-[#1D302B]">Remote Camera Stream</h4>
                      <span className="px-2 py-0.5 rounded-md bg-neutral-100 border border-neutral-200 text-neutral-700 text-[9px] font-extrabold uppercase">
                        {cameraFacing === 'user' ? 'FRONT LENS' : 'BACK LENS'}
                      </span>
                      <button
                        type="button"
                        onClick={() => void handleSwitchCameraFast()}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-50 hover:bg-emerald-100 text-[#0A9B70] text-[10px] font-bold transition-colors"
                      >
                        <SwitchCamera className="w-3 h-3" />
                        <span>Flip Lens</span>
                      </button>
                    </div>
                    <p className="text-[11px] text-[#71807B] mt-0.5">
                      Live WebRTC camera stream linked to /devices/{pairingCode}/stream
                    </p>
                    {cameraStreamActive && (
                      <div className="mt-3 relative rounded-xl overflow-hidden bg-black aspect-video border border-emerald-500/30">
                        <video ref={childVideoPreviewRef} autoPlay playsInline muted className="w-full h-full object-cover" />
                        {childStreamStatus && (
                          <div className="absolute bottom-0 inset-x-0 bg-black/60 p-1.5 text-[9px] text-white text-center">
                            {childStreamStatus}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                <button
                  type="button"
                  role="switch"
                  aria-checked={cameraStreamActive}
                  onClick={handleToggleCameraStream}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${cameraStreamActive ? 'bg-[#0A9B70]' : 'bg-neutral-300'}`}
                >
                  <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-md transition ${cameraStreamActive ? 'translate-x-5' : 'translate-x-0'}`} />
                </button>
              </div>
            </div>

            {/* WebRTC Audio Stream */}
            <div className={`bg-white rounded-2xl p-4 border transition-all ${audioStreamActive ? 'border-[#0A9B70] shadow-sm' : 'border-[#E4E9E5]'}`}>
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${audioStreamActive ? 'bg-pink-100 text-pink-600' : 'bg-neutral-100 text-neutral-500'}`}>
                    <Mic className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h4 className="text-sm font-bold text-[#1D302B]">One-Way Audio Stream</h4>
                      <span className={`px-2 py-0.5 rounded-md text-[9px] font-extrabold uppercase ${audioStreamActive ? 'bg-[#FDF2F8] border border-[#FBCFE8] text-[#BE185D] animate-pulse' : 'bg-neutral-100 text-neutral-500'}`}>
                        {audioStreamActive ? 'WEBRTC LIVE' : 'STANDBY'}
                      </span>
                    </div>
                    <p className="text-[11px] text-[#71807B] mt-0.5">
                      WebRTC audio signaling via /devices/{pairingCode}/audio
                    </p>
                    {audioSignalingStatus && (
                      <p className="text-[10px] font-semibold text-[#0A9B70] mt-1">{audioSignalingStatus}</p>
                    )}
                  </div>
                </div>

                <button
                  type="button"
                  role="switch"
                  aria-checked={audioStreamActive}
                  onClick={handleToggleAudioStream}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${audioStreamActive ? 'bg-[#0A9B70]' : 'bg-neutral-300'}`}
                >
                  <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-md transition ${audioStreamActive ? 'translate-x-5' : 'translate-x-0'}`} />
                </button>
              </div>
            </div>
          </div>

          {/* Guardian Info */}
          <div className="bg-white rounded-2xl p-5 border border-[#E4E9E5] shadow-xs">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-extrabold text-[#71807B] uppercase tracking-wider">
                PRIMARY GUARDIAN CONTACT
              </span>
              <span className="px-2.5 py-0.5 rounded-full bg-[#ECFDF5] text-[#065F46] text-[10px] font-bold">
                Verified & Synced
              </span>
            </div>
            <div className="mt-3.5 flex items-center gap-3">
              <div className="w-11 h-11 rounded-full bg-[#0A9B70]/15 text-[#0A9B70] flex items-center justify-center font-extrabold text-sm">
                SM
              </div>
              <div>
                <h4 className="text-sm font-bold text-[#1D302B]">{guardian.name}</h4>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[#71807B] mt-0.5">
                  <span className="flex items-center gap-1">
                    <Phone className="w-3 h-3 text-[#0A9B70]" />
                    {guardian.phone}
                  </span>
                  <span className="flex items-center gap-1">
                    <Mail className="w-3 h-3 text-neutral-400" />
                    {guardian.email}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </main>
      </div>
    );
  }

  // ----------------------------------------------------
  // Parent Console View
  // ----------------------------------------------------
  const onlineCount = liveDevices.filter((d) => d.isOnline).length;
  const cameraModalDevice = activeStreamingDevice || (currentSection === 'camera' ? selectedDevice : null);

  return (
    <div className="min-h-screen bg-[#F4F6F4] flex flex-col">
      {toastMessage && (
        <div className="fixed top-5 z-50 right-5 bg-[#192723] text-white text-xs font-semibold px-4 py-2.5 rounded-full shadow-lg flex items-center gap-2 border border-emerald-500/30">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span>{toastMessage}</span>
        </div>
      )}

      <div className="w-full bg-[#192723] text-white px-4 sm:px-6 py-2 border-b border-emerald-950 flex items-center justify-between text-xs z-40">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className="font-bold">
            Device Mode: <span className="text-[#34D399]">Parent Console</span>
          </span>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={handleSwitchRole}
            className="text-xs bg-white/10 hover:bg-white/20 px-2.5 py-1 rounded-md text-emerald-300 font-bold transition-colors"
          >
            ⇄ Switch to Child Client
          </button>
          <button onClick={handleSignOut} className="text-neutral-400 hover:text-white" title="Sign Out">
            <LogOut className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div className="flex flex-1">
        <Sidebar
          currentSection={currentSection}
          onSelectSection={setCurrentSection}
          onlineCount={onlineCount}
          onResetAll={handleClearAllDevices}
        />

        <div className="flex-1 p-6 md:p-8 max-w-7xl mx-auto w-full space-y-6">
          <Header
            currentSection={currentSection}
            parentEmail={currentUser?.email || 'parent@kidguard.family'}
            onSignOut={handleSignOut}
            onOpenAuth={() => setIsAuthModalOpen(true)}
            onOpenAddChild={() => setIsAddChildModalOpen(true)}
            deviceCount={liveDevices.length}
          />

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-white rounded-2xl p-4 border border-[#E4E9E5] flex items-center justify-between">
              <div>
                <span className="text-[11px] font-bold text-[#71807B] uppercase">Paired Devices</span>
                <p className="text-2xl font-extrabold text-[#1D302B] mt-0.5">{liveDevices.length}</p>
              </div>
              <Smartphone className="w-6 h-6 text-[#0A9B70]" />
            </div>
            <div className="bg-white rounded-2xl p-4 border border-[#E4E9E5] flex items-center justify-between">
              <div>
                <span className="text-[11px] font-bold text-[#71807B] uppercase">Online Now</span>
                <p className="text-2xl font-extrabold text-emerald-600 mt-0.5">{onlineCount}</p>
              </div>
              <Activity className="w-6 h-6 text-emerald-600" />
            </div>
            <div className="bg-white rounded-2xl p-4 border border-[#E4E9E5] flex items-center justify-between">
              <div>
                <span className="text-[11px] font-bold text-[#71807B] uppercase">Active Target</span>
                <p className="text-sm font-extrabold text-[#1D302B] mt-1 truncate max-w-[170px]">
                  {selectedDevice?.deviceModelName || 'None Selected'}
                </p>
              </div>
              <Shield className="w-6 h-6 text-indigo-600" />
            </div>
          </div>

          {currentSection === 'devices' && (
            <div className="space-y-4">
              {liveDevices.length === 0 ? (
                <div className="text-center py-16 bg-white rounded-2xl border border-[#E4E9E5] p-8">
                  <div className="w-14 h-14 rounded-full bg-emerald-50 text-[#0A9B70] flex items-center justify-center mx-auto mb-4">
                    <Smartphone className="w-7 h-7" />
                  </div>
                  <h3 className="text-lg font-extrabold text-[#1D302B]">Enter binding code to connect device</h3>
                  <p className="text-xs text-[#71807B] max-w-sm mx-auto mt-1 mb-5">
                    No active child devices linked yet. Open the Child Protection Client to get a pairing code.
                  </p>
                  <button
                    onClick={() => setIsAddChildModalOpen(true)}
                    className="px-4 py-2.5 rounded-xl text-xs font-bold bg-[#0A9B70] text-white hover:bg-[#087957] transition-colors"
                  >
                    Pair Device with Code
                  </button>
                </div>
              ) : (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-3 bg-white px-4 py-3 rounded-xl border border-[#E4E9E5]">
                    <div className="flex items-center gap-3">
                      <button
                        onClick={handleSelectAll}
                        className="flex items-center gap-2 text-xs font-bold text-[#1D302B] hover:text-[#0A9B70]"
                      >
                        <div
                          className={`w-4 h-4 rounded border flex items-center justify-center ${
                            selectedChildIds.length === filteredDevices.length && filteredDevices.length > 0
                              ? 'bg-[#0A9B70] border-[#0A9B70] text-white'
                              : 'bg-white border-neutral-300'
                          }`}
                        >
                          {selectedChildIds.length === filteredDevices.length && filteredDevices.length > 0 && (
                            <Check className="w-2.5 h-2.5" />
                          )}
                        </div>
                        <span>Select All ({filteredDevices.length})</span>
                      </button>

                      {selectedChildIds.length > 0 && (
                        <button
                          onClick={handleBulkDelete}
                          disabled={isBulkDeleting}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-50 hover:bg-red-100 text-red-600 text-xs font-bold disabled:opacity-50"
                        >
                          {isBulkDeleting ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Delete className="w-3.5 h-3.5" />
                          )}
                          <span>Delete Selected ({selectedChildIds.length})</span>
                        </button>
                      )}
                    </div>

                    <div className="relative w-full sm:w-60">
                      <Search className="w-3.5 h-3.5 text-[#71807B] absolute left-3 top-1/2 -translate-y-1/2" />
                      <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Search model or pairing code..."
                        className="w-full h-8 pl-8 pr-3 text-xs bg-[#F9FAF9] border border-[#E4E9E5] rounded-lg focus:border-[#0A9B70] outline-none"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                    {filteredDevices.map((device) => (
                      <DeviceCard
                        key={device.childId}
                        device={device}
                        isSelected={selectedChildIds.includes(device.childId)}
                        onToggleSelection={toggleDeviceSelection}
                        onOpenLiveStream={(dev) => {
                          setSelectedDevice(dev);
                          setActiveStreamingDevice(dev);
                        }}
                        onOpenLocation={(dev) => {
                          setSelectedDevice(dev);
                          setCurrentSection('location');
                        }}
                        onUnlink={handleUnlinkDevice}
                      />
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          {currentSection === 'location' && (
            <LiveLocationView
              devices={liveDevices}
              selectedDevice={selectedDevice}
              onSelectDevice={setSelectedDevice}
            />
          )}

          {currentSection === 'mirroring' && (
            <ScreenMirrorView
              devices={liveDevices}
              selectedDevice={selectedDevice}
              onSelectDevice={setSelectedDevice}
              parentUid={currentUser?.uid || 'parent_console'}
            />
          )}

          {currentSection === 'notifications' && (
            <NotificationsView
              devices={liveDevices}
              selectedDevice={selectedDevice}
              onSelectDevice={setSelectedDevice}
            />
          )}

          {currentSection === 'calls' && (
            <CallLogsView
              devices={liveDevices}
              selectedDevice={selectedDevice}
              onSelectDevice={setSelectedDevice}
            />
          )}

          {currentSection === 'usage' && (
            <AppUsageView
              devices={liveDevices}
              selectedDevice={selectedDevice}
              onSelectDevice={setSelectedDevice}
            />
          )}
        </div>
      </div>

      {isAddChildModalOpen && (
        <AddChildModal onClose={() => setIsAddChildModalOpen(false)} onPair={handlePairChild} />
      )}

      {cameraModalDevice && (
        <LiveCameraModal
          device={cameraModalDevice}
          parentUid={currentUser?.uid || 'parent_console'}
          onClose={() => {
            setActiveStreamingDevice(null);
            if (currentSection === 'camera') setCurrentSection('devices');
          }}
        />
      )}

      {isAuthModalOpen && (
        <AuthModal
          onClose={() => setIsAuthModalOpen(false)}
          onSuccess={(u) => {
            setCurrentUser(u);
            setIsAuthenticated(true);
            setIsAuthModalOpen(false);
          }}
        />
      )}
    </div>
  );
};

export const App: React.FC = () => (
  <ConsoleErrorBoundary>
    <AppContent />
  </ConsoleErrorBoundary>
);

export default App;
