import {
  database,
  norm,
  sendCmd,
  startStreamNode,
  sendSDP,
  watchSDP,
  addIce,
  watchIce,
  stopStreamNode,
  sanitizeForRTDB,
} from './firebase';
import { ref, update, onValue, off, get } from 'firebase/database';

export const peerConfiguration: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
  bundlePolicy: 'max-bundle',
  rtcpMuxPolicy: 'require',
  iceCandidatePoolSize: 2,
};

const normalizeCode = (raw: string) =>
  norm(raw).replace(/^DEV_|^CHILD_/i, '');

export type WebRTCStreamMode = 'camera' | 'audio' | 'screen';

export interface PairingCodeValidationResult {
  isValid: boolean;
  isRegenerated: boolean;
  newPairingCode?: string;
  previousPairingCode?: string;
  message?: string;
}

export const checkChildPairingCodeValidity = async (
  pairingCode: string,
  deviceId?: string
): Promise<PairingCodeValidationResult> => {
  const cleanCode = normalizeCode(pairingCode);
  if (!cleanCode) {
    return { isValid: false, isRegenerated: false, message: 'Missing pairing code' };
  }

  try {
    const regCode =
      localStorage.getItem(`kidguard_regenerated_code_${cleanCode}`) ||
      (deviceId ? localStorage.getItem(`kidguard_regenerated_code_${deviceId}`) : null);
    if (regCode && regCode !== cleanCode) {
      return {
        isValid: false,
        isRegenerated: true,
        newPairingCode: regCode,
        previousPairingCode: cleanCode,
        message: `Child device regenerated pairing code. Please re-link using code ${regCode}`,
      };
    }
  } catch {
    // ignore storage errors
  }

  if (!database) return { isValid: true, isRegenerated: false };

  try {
    const devSnap = await get(ref(database, `devices/${cleanCode}`));
    if (devSnap.exists()) {
      const data = devSnap.val();
      if (data?.newPairingCode && norm(String(data.newPairingCode)) !== cleanCode) {
        const newCode = norm(String(data.newPairingCode));
        return {
          isValid: false,
          isRegenerated: true,
          newPairingCode: newCode,
          previousPairingCode: cleanCode,
          message: `Child device regenerated pairing code. Please re-link using code ${newCode}`,
        };
      }
      if (data?.status === 'regenerated' || data?.status === 'expired') {
        const newCode = data?.newPairingCode ? norm(String(data.newPairingCode)) : undefined;
        return {
          isValid: false,
          isRegenerated: !!newCode,
          newPairingCode: newCode,
          previousPairingCode: cleanCode,
          message: newCode
            ? `Child device regenerated pairing code. Please re-link using code ${newCode}`
            : 'Child pairing code is no longer valid',
        };
      }
    }
    return { isValid: true, isRegenerated: false };
  } catch (e) {
    console.warn('Error checking child pairing code validity:', e);
    return { isValid: true, isRegenerated: false };
  }
};

export const subscribeToChildPairingCodeValidity = (
  pairingCode: string,
  deviceId: string | undefined,
  _childId: string | undefined,
  onStatusChange: (result: PairingCodeValidationResult) => void
): (() => void) => {
  const cleanCode = normalizeCode(pairingCode);
  let isSubscribed = true;
  const unsubs: (() => void)[] = [];

  const notifyNewCode = (newCode: string) => {
    if (!isSubscribed) return;
    const formatted = norm(newCode);
    if (formatted && formatted !== cleanCode) {
      onStatusChange({
        isValid: false,
        isRegenerated: true,
        newPairingCode: formatted,
        previousPairingCode: cleanCode,
        message: `Child device regenerated pairing code. Please re-link using code ${formatted}`,
      });
    }
  };

  checkChildPairingCodeValidity(cleanCode, deviceId).then((res) => {
    if (isSubscribed && !res.isValid) onStatusChange(res);
  });

  if (database && cleanCode) {
    const devRef = ref(database, `devices/${cleanCode}`);
    const unsubDev = onValue(devRef, (snap) => {
      if (!isSubscribed || !snap.exists()) return;
      const data = snap.val();
      if (data?.newPairingCode && norm(String(data.newPairingCode)) !== cleanCode) {
        notifyNewCode(String(data.newPairingCode));
      } else if (data?.status === 'regenerated' || data?.status === 'expired') {
        const newCode = data?.newPairingCode ? norm(String(data.newPairingCode)) : undefined;
        onStatusChange({
          isValid: false,
          isRegenerated: !!newCode,
          newPairingCode: newCode,
          previousPairingCode: cleanCode,
          message: newCode
            ? `Child device regenerated pairing code. Please re-link using code ${newCode}`
            : 'Child pairing code is no longer valid',
        });
      }
    });
    unsubs.push(() => off(devRef, 'value', unsubDev));
  }

  return () => {
    isSubscribed = false;
    unsubs.forEach((u) => {
      try {
        u();
      } catch {
        // ignore
      }
    });
  };
};

export interface StartWebRTCOptions {
  mode?: WebRTCStreamMode;
  cameraFacing?: 'front' | 'back' | 'user' | 'environment';
  onStream?: (stream: MediaStream) => void;
  onLocalStream?: (stream: MediaStream) => void;
  onRemoteStream?: (stream: MediaStream) => void;
  onStatusChange?: (status: string) => void;
  onError?: (err: Error) => void;
  onConnectionStateChange?: (state: RTCPeerConnectionState) => void;
}

export interface ManagedWebRTCSession {
  peerConnection: RTCPeerConnection | null;
  cleanup: () => void;
}

/**
 * Unified WebRTC peer helper using RTDB `/devices/{code}/stream`.
 * - Child (`isChild = true`): initializes stream node, captures media, creates Offer, watches Answer, queues ICE.
 * - Parent (`isChild = false`): watches Offer, sets remote description, flushes ICE queue, creates Answer.
 */
export const startWebRTC = async (
  code: string,
  isChild: boolean,
  options: StartWebRTCOptions
): Promise<ManagedWebRTCSession> => {
  const cleanCode = normalizeCode(code);
  const mode: WebRTCStreamMode = options.mode || 'camera';
  let pc: RTCPeerConnection | null = null;
  let localStream: MediaStream | null = null;
  let streamCleanups: (() => void)[] = [];
  let isCleanedUp = false;

  const cleanup = () => {
    if (isCleanedUp) return;
    isCleanedUp = true;
    streamCleanups.forEach((fn) => {
      try {
        fn();
      } catch {
        // ignore
      }
    });
    streamCleanups = [];
    if (pc) {
      try {
        pc.onicecandidate = null;
        pc.ontrack = null;
        pc.onconnectionstatechange = null;
        pc.close();
      } catch {
        // ignore
      }
      pc = null;
    }
    if (localStream) {
      localStream.getTracks().forEach((t) => t.stop());
      localStream = null;
    }
  };

  if (!cleanCode) {
    const err = new Error('Missing device pairing code');
    options.onError?.(err);
    return { peerConnection: null, cleanup };
  }

  try {
    const peer = new RTCPeerConnection(peerConfiguration);
    pc = peer;
    const iceQueue: RTCIceCandidateInit[] = [];

    peer.onicecandidate = (e) => {
      if (e.candidate && !isCleanedUp) {
        addIce(cleanCode, isChild ? 'childCandidates' : 'parentCandidates', e.candidate).catch(() => {});
      }
    };

    peer.ontrack = (e) => {
      if (isCleanedUp || isChild) return;
      const remoteStream = e.streams && e.streams[0] ? e.streams[0] : e.track ? new MediaStream([e.track]) : null;
      if (!remoteStream) return;
      options.onRemoteStream?.(remoteStream);
      options.onStream?.(remoteStream);
    };

    peer.onconnectionstatechange = () => {
      if (isCleanedUp) return;
      options.onConnectionStateChange?.(peer.connectionState);
      if (peer.connectionState === 'connected') {
        options.onStatusChange?.(
          mode === 'audio'
            ? 'Live audio connected'
            : mode === 'screen'
            ? 'Live screen connected'
            : 'Live camera connected'
        );
      } else if (peer.connectionState === 'failed' || peer.connectionState === 'disconnected') {
        options.onStatusChange?.(`WebRTC ${peer.connectionState}`);
      }
    };

    streamCleanups.push(
      watchIce(cleanCode, isChild ? 'parentCandidates' : 'childCandidates', async (c) => {
        if (isCleanedUp) return;
        if (peer.remoteDescription) {
          await peer.addIceCandidate(new RTCIceCandidate(c)).catch(() => {});
        } else {
          iceQueue.push(c);
        }
      })
    );

    if (isChild) {
      await startStreamNode(cleanCode, mode);

      if (mode === 'screen') {
        options.onStatusChange?.('Requesting screen capture permissions…');
        if (!navigator.mediaDevices?.getDisplayMedia) {
          const err = new Error('Screen sharing is not supported in this browser.');
          options.onError?.(err);
          throw err;
        }
        try {
          localStream = await navigator.mediaDevices.getDisplayMedia({
            video: { displaySurface: 'monitor', logicalSurface: true, cursor: 'always' } as any,
            audio: false,
          });
        } catch (screenErr: any) {
          const msg = screenErr?.message?.includes('Permission') || screenErr?.name === 'NotAllowedError'
            ? 'Permission denied'
            : (screenErr?.message || 'Screen sharing is not supported in this browser.');
          const err = new Error(msg);
          options.onError?.(err);
          throw err;
        }
      } else {
        options.onStatusChange?.(
          mode === 'audio' ? 'Requesting microphone access…' : 'Requesting camera & mic access…'
        );
        const facingIdeal =
          options.cameraFacing === 'front' || options.cameraFacing === 'user'
            ? 'user'
            : 'environment';
        try {
          localStream = await navigator.mediaDevices.getUserMedia({
            video: mode === 'camera' ? { facingMode: { ideal: facingIdeal } } : false,
            audio: true,
          });
        } catch (mediaErr: any) {
          const msg = mediaErr?.message?.includes('Permission') || mediaErr?.name === 'NotAllowedError'
            ? 'Permission denied'
            : (mediaErr?.message || 'Camera or microphone permission denied.');
          const err = new Error(msg);
          options.onError?.(err);
          throw err;
        }
      }

      if (isCleanedUp) {
        localStream.getTracks().forEach((t) => t.stop());
        localStream = null;
        return { peerConnection: null, cleanup };
      }

      options.onLocalStream?.(localStream);
      if (!options.onLocalStream) {
        options.onStream?.(localStream);
      }
      localStream.getTracks().forEach((t) => peer.addTrack(t, localStream!));

      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      await sendSDP(cleanCode, 'offer', offer);
      options.onStatusChange?.('Offer sent • Waiting for parent answer…');

      streamCleanups.push(
        watchSDP(cleanCode, 'answer', async (ans) => {
          if (isCleanedUp || peer.currentRemoteDescription) return;
          try {
            await peer.setRemoteDescription(new RTCSessionDescription(ans));
            while (iceQueue.length) {
              await peer.addIceCandidate(new RTCIceCandidate(iceQueue.shift()!)).catch(() => {});
            }
            options.onStatusChange?.(
              mode === 'audio'
                ? 'Live Audio Connected'
                : mode === 'screen'
                ? 'Live Screen Connected'
                : 'Live Camera Connected'
            );
          } catch (err) {
            console.warn('Error applying parent answer:', err);
          }
        })
      );
    } else {
      options.onStatusChange?.('Listening for child WebRTC offer…');
      streamCleanups.push(
        watchSDP(cleanCode, 'offer', async (offSdp) => {
          if (isCleanedUp || peer.currentRemoteDescription) return;
          try {
            options.onStatusChange?.('Offer received • Establishing P2P connection…');
            await peer.setRemoteDescription(new RTCSessionDescription(offSdp));
            while (iceQueue.length) {
              await peer.addIceCandidate(new RTCIceCandidate(iceQueue.shift()!)).catch(() => {});
            }
            const ans = await peer.createAnswer();
            await peer.setLocalDescription(ans);
            await sendSDP(cleanCode, 'answer', ans);
            options.onStatusChange?.('Answer sent • Connecting media stream…');
          } catch (err) {
            console.warn('Error answering child offer:', err);
          }
        })
      );
    }
  } catch (err: any) {
    console.error('WebRTC session error:', err);
    cleanup();
    options.onError?.(err);
  }

  return {
    get peerConnection() {
      return pc;
    },
    cleanup,
  };
};

export interface WebRTCSignalingOptions {
  mode?: 'camera' | 'audio';
  cameraFacing?: 'front' | 'back';
  pairingCode?: string;
  onStream: (stream: MediaStream) => void;
  onStatusChange?: (status: string) => void;
  onError?: (err: Error) => void;
  onConnectionStateChange?: (state: RTCPeerConnectionState) => void;
  onPairingCodeInvalidated?: (newPairingCode?: string) => void;
}

export interface WebRTCSignalingSession {
  peerConnection: RTCPeerConnection | null;
  reconnect: () => Promise<void>;
  cleanup: () => void;
  switchCamera: (facing: 'front' | 'back') => Promise<void>;
  checkCodeValidity?: () => Promise<PairingCodeValidationResult>;
}

/**
 * Parent-side WebRTC camera/audio session: starts receiver first, then dispatches `startCamera` or `startAudio`.
 */
export const startParentWebRTCSession = async (
  deviceId: string,
  parentUid: string,
  childId: string,
  options: WebRTCSignalingOptions
): Promise<WebRTCSignalingSession> => {
  const activePairingCode = normalizeCode(options.pairingCode || deviceId);
  const mode = options.mode || 'camera';
  let currentFacing = options.cameraFacing || 'back';
  let activeSession: ManagedWebRTCSession | null = null;
  let validityUnsub: (() => void) | null = null;
  let isCleanedUp = false;

  if (activePairingCode) {
    validityUnsub = subscribeToChildPairingCodeValidity(
      activePairingCode,
      deviceId,
      childId,
      (result) => {
        if (!result.isValid && result.isRegenerated && result.newPairingCode) {
          const msg = `Child device regenerated pairing code. Please re-link using code ${result.newPairingCode}`;
          options.onStatusChange?.(msg);
          options.onPairingCodeInvalidated?.(result.newPairingCode);
        }
      }
    );
  }

  const initConnection = async () => {
    activeSession?.cleanup();
    activeSession = null;
    if (isCleanedUp) return;

    await stopStreamNode(activePairingCode).catch(() => {});
    if (isCleanedUp) return;

    activeSession = await startWebRTC(activePairingCode, false, {
      mode,
      cameraFacing: currentFacing,
      onRemoteStream: options.onStream,
      onStatusChange: options.onStatusChange,
      onError: options.onError,
      onConnectionStateChange: options.onConnectionStateChange,
    });

    const cmd = mode === 'audio' ? 'startAudio' : 'startCamera';
    await sendCmd(activePairingCode, cmd, {
      command: mode === 'audio' ? 'startAudio' : 'startStream',
      parentUid,
      childId,
      cameraFacing: currentFacing,
    });
    options.onStatusChange?.(
      mode === 'audio'
        ? 'Live audio requested • Waiting for child device…'
        : 'Live camera requested • Waiting for child device…'
    );
  };

  await initConnection();

  return {
    get peerConnection() {
      return activeSession?.peerConnection || null;
    },
    reconnect: async () => {
      options.onStatusChange?.('Reconnecting WebRTC session…');
      await initConnection();
    },
    switchCamera: async (facing: 'front' | 'back') => {
      currentFacing = facing;
      await sendCmd(activePairingCode, 'switchCamera', {
        parentUid,
        childId,
        cameraFacing: facing,
      });
    },
    checkCodeValidity: async () => checkChildPairingCodeValidity(activePairingCode, deviceId),
    cleanup: () => {
      if (isCleanedUp) return;
      isCleanedUp = true;
      if (validityUnsub) {
        validityUnsub();
        validityUnsub = null;
      }
      activeSession?.cleanup();
      activeSession = null;
      sendCmd(activePairingCode, 'stopStream', { parentUid, childId }).catch(() => {});
      stopStreamNode(activePairingCode).catch(() => {});
    },
  };
};

export interface ScreenFrameData {
  frame?: string;
  activeApp?: string;
  timestamp?: number;
  fps?: number;
  orientation?: 'portrait' | 'landscape';
  battery?: number;
  status?: 'streaming' | 'paused' | 'standby' | 'mirroring' | 'stopped';
  deviceModel?: string;
  source?: 'rtdb_frame' | 'webrtc_stream' | 'simulated';
  isSharing?: boolean;
  command?: string;
  commandId?: string;
  commandAcknowledged?: boolean;
}

export const subscribeToDeviceScreen = (
  pairingCodeOrDeviceId: string,
  onScreenFrame: (screenData: ScreenFrameData) => void,
  onError?: (err: Error) => void
): (() => void) => {
  if (!database) return () => {};
  const cleanKey = normalizeCode(pairingCodeOrDeviceId);
  if (!cleanKey) return () => {};

  let isSubscribed = true;
  const screenRef = ref(database, `devices/${cleanKey}/screen`);

  const handleValue = (snapshot: any) => {
    if (!isSubscribed) return;
    try {
      if (snapshot.exists()) {
        const val = snapshot.val();
        if (val && typeof val === 'object') {
          onScreenFrame({ ...val, source: 'rtdb_frame' });
        }
      }
    } catch (err: any) {
      console.warn(`Error parsing screen data for ${cleanKey}:`, err);
      onError?.(err);
    }
  };

  onValue(screenRef, handleValue, (err) => {
    console.warn(`Screen frame listener error for /devices/${cleanKey}/screen:`, err);
    onError?.(err);
  });

  return () => {
    isSubscribed = false;
    off(screenRef, 'value', handleValue);
  };
};

export const updateDeviceScreen = async (
  pairingCodeOrDeviceId: string,
  screenData: Partial<ScreenFrameData>
): Promise<void> => {
  if (!database) return;
  const cleanKey = normalizeCode(pairingCodeOrDeviceId);
  if (!cleanKey) return;

  await update(ref(database, `devices/${cleanKey}/screen`), {
    ...sanitizeForRTDB(screenData),
    timestamp: Date.now(),
  });
};

export interface ScreenSignalingOptions {
  onStream: (stream: MediaStream) => void;
  onFrameData?: (data: ScreenFrameData) => void;
  onStatusChange?: (status: string) => void;
  onError?: (err: Error) => void;
  onConnectionStateChange?: (state: RTCPeerConnectionState) => void;
}

/**
 * Parent-side WebRTC screen mirroring session using unified `startWebRTC`.
 */
export const startParentScreenShareSession = async (
  deviceId: string,
  parentUid: string,
  childId: string,
  options: ScreenSignalingOptions
): Promise<WebRTCSignalingSession> => {
  const activePairingCode = normalizeCode(deviceId);
  let activeSession: ManagedWebRTCSession | null = null;
  let isCleanedUp = false;

  const initConnection = async () => {
    activeSession?.cleanup();
    activeSession = null;
    if (isCleanedUp) return;

    await stopStreamNode(activePairingCode).catch(() => {});
    if (isCleanedUp) return;

    activeSession = await startWebRTC(activePairingCode, false, {
      mode: 'screen',
      onRemoteStream: options.onStream,
      onStatusChange: options.onStatusChange,
      onError: options.onError,
      onConnectionStateChange: options.onConnectionStateChange,
    });

    await sendCmd(activePairingCode, 'startScreenShare', {
      parentUid,
      childId,
    });
    options.onStatusChange?.('Screen mirror requested • Waiting for child device…');
  };

  await initConnection();

  return {
    get peerConnection() {
      return activeSession?.peerConnection || null;
    },
    reconnect: async () => {
      options.onStatusChange?.('Reconnecting WebRTC screen mirror…');
      await initConnection();
    },
    switchCamera: async () => {},
    cleanup: () => {
      if (isCleanedUp) return;
      isCleanedUp = true;
      activeSession?.cleanup();
      activeSession = null;
      sendCmd(activePairingCode, 'stopScreenShare', { parentUid, childId }).catch(() => {});
      stopStreamNode(activePairingCode).catch(() => {});
    },
  };
};

/**
 * Child-side WebRTC camera or audio broadcaster (Offerer) using unified `startWebRTC`.
 */
export const startChildWebRTCSession = async (
  pairingCode: string,
  options: {
    mode?: 'camera' | 'audio';
    cameraFacing?: 'front' | 'back' | 'user' | 'environment';
    onStream: (stream: MediaStream) => void;
    onStatusChange?: (status: string) => void;
    onError?: (err: Error) => void;
    onConnectionStateChange?: (state: RTCPeerConnectionState) => void;
  }
): Promise<ManagedWebRTCSession> => {
  return startWebRTC(pairingCode, true, {
    mode: options.mode || 'camera',
    cameraFacing: options.cameraFacing,
    onLocalStream: options.onStream,
    onStatusChange: options.onStatusChange,
    onError: options.onError,
    onConnectionStateChange: options.onConnectionStateChange,
  });
};

/**
 * Child-side WebRTC screen share broadcaster (Offerer) using unified `startWebRTC`.
 */
export const startChildScreenShareSession = async (
  pairingCode: string,
  options: {
    onStream: (stream: MediaStream) => void;
    onStatusChange?: (status: string) => void;
    onError?: (err: Error) => void;
    onConnectionStateChange?: (state: RTCPeerConnectionState) => void;
  }
): Promise<ManagedWebRTCSession> => {
  return startWebRTC(pairingCode, true, {
    mode: 'screen',
    onLocalStream: options.onStream,
    onStatusChange: options.onStatusChange,
    onError: options.onError,
    onConnectionStateChange: options.onConnectionStateChange,
  });
};