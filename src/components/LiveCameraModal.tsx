import React, { useEffect, useRef, useState } from 'react';
import { startParentWebRTCSession } from '../services/webrtc';
import { sendRemoteCommand } from '../services/firebase';

interface Props {
  device: any;
  parentUid: string;
  onClose: () => void;
}

export const LiveCameraModal: React.FC<Props> = ({ device, parentUid, onClose }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [facing, setFacing] = useState<'front' | 'back'>('back');
  const [status, setStatus] = useState('Connecting to child camera...');
  const peerSessionRef = useRef<any>(null);

  useEffect(() => {
    let isMounted = true;

    // WebRTC సెషన్‌ను ప్రారంభించడం
    startParentWebRTCSession(device.deviceId, parentUid, device.childId, {
      onStream: (stream) => {
        if (isMounted && videoRef.current) {
          videoRef.current.srcObject = stream;
          setStatus('Live Stream Active');
        }
      },
      onStatusChange: (msg) => {
        if (isMounted) setStatus(msg);
      }
    }).then(session => {
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
      }
    };
  }, [device.deviceId, parentUid, device.childId]);

  // కెమెరా లెన్స్ మార్చే ఫంక్షన్
  const handleSwitchLens = async () => {
    const nextFacing = facing === 'front' ? 'back' : 'front';
    setFacing(nextFacing);
    setStatus(`Switching to ${nextFacing} camera...`);
    
    await sendRemoteCommand(device.deviceId, parentUid, device.childId, 'switchCamera', {
      cameraFacing: nextFacing
    });
  };

  // స్ట్రీమ్‌ను పూర్తిగా ఆపివేసే ఫంక్షన్
  const handleClose = async () => {
    if (peerSessionRef.current) {
      peerSessionRef.current.cleanup();
    }
    await sendRemoteCommand(device.deviceId, parentUid, device.childId, 'stopStream');
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/90 flex flex-col items-center justify-center z-50 p-4">
      {/* Status Badge */}
      <div className="absolute top-6 px-4 py-1 bg-emerald-500/20 border border-emerald-500/50 rounded-full text-emerald-400 text-xs font-bold animate-pulse">
        {status}
      </div>

      {/* Video Viewport */}
      <div className="relative w-full max-w-3xl aspect-video bg-neutral-900 rounded-2xl overflow-hidden shadow-2xl border border-white/10">
        <video 
          ref={videoRef} 
          autoPlay 
          playsInline 
          muted 
          className="w-full h-full object-contain"
        />
      </div>

      {/* Control Bar */}
      <div className="mt-8 flex gap-6">
        <button 
          onClick={handleSwitchLens}
          className="flex items-center gap-2 px-6 py-3 bg-white/10 hover:bg-white/20 text-white rounded-xl transition-all font-bold border border-white/10"
        >
          <span>Switch Lens</span>
          <span className="opacity-60 text-xs uppercase">({facing})</span>
        </button>
        
        <button 
          onClick={handleClose}
          className="px-8 py-3 bg-rose-600 hover:bg-rose-700 text-white rounded-xl transition-all font-bold shadow-lg shadow-rose-900/20"
        >
          Close Stream
        </button>
      </div>
    </div>
  );
};
