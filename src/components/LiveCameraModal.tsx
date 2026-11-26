import React, { useEffect, useRef, useState } from 'react';
import { Video, Mic, Volume2, VolumeX, RefreshCw } from 'lucide-react';
import { startParentWebRTCSession, WebRTCSignalingSession } from '../services/webrtc';
import { sendCmd, stopStreamNode } from '../services/firebase';

interface Props {
  device: any;
  parentUid: string;
  onClose: () => void;
}

export const LiveCameraModal: React.FC<Props> = ({ device, parentUid, onClose }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [mode, setMode] = useState<'camera' | 'audio'>('camera');
  const [facing, setFacing] = useState<'front' | 'back'>('back');
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [status, setStatus] = useState('Connecting to child stream...');
  const peerSessionRef = useRef<WebRTCSignalingSession | null>(null);

  const targetCode = device.pairingCode || device.deviceId;

  useEffect(() => {
    let isMounted = true;
    setStatus(mode === 'audio' ? 'Connecting to child microphone...' : 'Connecting to child camera...');

    startParentWebRTCSession(device.deviceId, parentUid, device.childId, {
      pairingCode: device.pairingCode,
      mode,
      cameraFacing: facing,
      onStream: (stream) => {
        if (isMounted && videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(() => {});
          setStatus(mode === 'audio' ? 'Live Audio Active' : 'Live Camera Active');
        }
      },
      onStatusChange: (msg) => {
        if (isMounted) setStatus(msg);
      },
      onError: (err) => {
        if (isMounted) setStatus(`Stream Error: ${err.message}`);
      },
    }).then((session) => {
      if (isMounted) {
        peerSessionRef.current = session;
      } else {
        session.cleanup();
      }
    });

    return () => {
      isMounted = false;
      if (peerSessionRef.current) {
        peerSessionRef.current.cleanup();
        peerSessionRef.current = null;
      }
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
    };
  }, [device.deviceId, device.pairingCode, parentUid, device.childId, mode]);

  const handleSwitchLens = async () => {
    const nextFacing = facing === 'front' ? 'back' : 'front';
    setFacing(nextFacing);
    setStatus(`Switching to ${nextFacing} camera...`);

    if (peerSessionRef.current) {
      await peerSessionRef.current.switchCamera(nextFacing);
    } else {
      await sendCmd(targetCode, 'switchCamera', {
        cameraFacing: nextFacing,
        parentUid,
        childId: device.childId,
      });
    }
  };

  const handleClose = async () => {
    if (peerSessionRef.current) {
      peerSessionRef.current.cleanup();
      peerSessionRef.current = null;
    }
    await sendCmd(targetCode, 'stopStream', {
      parentUid,
      childId: device.childId,
    }).catch(() => {});
    await stopStreamNode(targetCode).catch(() => {});
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/90 flex flex-col items-center justify-center z-50 p-4">
      {/* Status Badge */}
      <div className="absolute top-6 px-4 py-1.5 bg-emerald-500/20 border border-emerald-500/50 rounded-full text-emerald-300 text-xs font-bold flex items-center gap-2">
        <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
        <span>{status}</span>
      </div>

      {/* Video / Audio Viewport */}
      <div className="relative w-full max-w-3xl aspect-video bg-neutral-900 rounded-2xl overflow-hidden shadow-2xl border border-white/10 flex items-center justify-center">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={isMuted}
          className={`w-full h-full object-contain ${mode === 'audio' ? 'opacity-0 absolute inset-0' : ''}`}
        />
        {mode === 'audio' && (
          <div className="flex flex-col items-center gap-3 text-center px-6">
            <div className="w-20 h-20 rounded-full bg-emerald-500/15 border border-emerald-500/40 flex items-center justify-center text-emerald-400 animate-pulse">
              <Mic className="w-9 h-9" />
            </div>
            <p className="text-white font-bold text-sm">Live Audio Monitoring</p>
            <p className="text-neutral-400 text-xs">{device.deviceModelName || targetCode}</p>
          </div>
        )}
      </div>

      {/* Control Bar */}
      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        <button
          onClick={() => setMode('camera')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold border transition-all ${
            mode === 'camera'
              ? 'bg-emerald-600 border-emerald-500 text-white'
              : 'bg-white/10 hover:bg-white/20 text-white border-white/10'
          }`}
        >
          <Video className="w-4 h-4" />
          <span>Live Camera</span>
        </button>

        <button
          onClick={() => setMode('audio')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold border transition-all ${
            mode === 'audio'
              ? 'bg-emerald-600 border-emerald-500 text-white'
              : 'bg-white/10 hover:bg-white/20 text-white border-white/10'
          }`}
        >
          <Mic className="w-4 h-4" />
          <span>Live Mic</span>
        </button>

        {mode === 'camera' && (
          <button
            onClick={handleSwitchLens}
            className="flex items-center gap-2 px-4 py-2.5 bg-white/10 hover:bg-white/20 text-white rounded-xl transition-all text-xs font-bold border border-white/10"
          >
            <RefreshCw className="w-4 h-4" />
            <span>Switch Lens ({facing})</span>
          </button>
        )}

        <button
          onClick={() => setIsMuted((m) => !m)}
          className="flex items-center gap-2 px-4 py-2.5 bg-white/10 hover:bg-white/20 text-white rounded-xl transition-all text-xs font-bold border border-white/10"
        >
          {isMuted ? <VolumeX className="w-4 h-4 text-rose-400" /> : <Volume2 className="w-4 h-4 text-emerald-400" />}
          <span>{isMuted ? 'Unmute' : 'Mute'}</span>
        </button>

        <button
          onClick={handleClose}
          className="px-6 py-2.5 bg-rose-600 hover:bg-rose-700 text-white rounded-xl transition-all text-xs font-bold shadow-lg shadow-rose-900/20"
        >
          Stop Stream
        </button>
      </div>
    </div>
  );
};
