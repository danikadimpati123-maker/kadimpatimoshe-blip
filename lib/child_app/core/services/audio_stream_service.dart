import 'package:flutter_webrtc/flutter_webrtc.dart';
import 'package:firebase_database/firebase_database.dart';
import 'rtdb_client_service.dart';
import 'foreground_task_service.dart';

/// Real Hardware Microphone Audio Streaming Service for Child Device
/// Captures physical microphone input using `flutter_webrtc` and streams over peer connection.
class AudioStreamService {
  final RtdbClientService _rtdbClient;
  final ForegroundTaskService _foregroundService;

  MediaStream? _audioStream;
  RTCPeerConnection? _peerConnection;
  StreamSubscription<DatabaseEvent>? _signalingSubscription;
  StreamSubscription<DatabaseEvent>? _iceSubscription;

  bool _isTransmitting = false;
  int _sampleRate = 44100;
  String _currentPairingCode = '';
  String? _lastError;

  void Function(bool isTransmitting)? onStateChanged;
  void Function(String error)? onError;

  AudioStreamService({
    RtdbClientService? rtdbClient,
    ForegroundTaskService? foregroundService,
  })  : _rtdbClient = rtdbClient ?? RtdbClientService(),
        _foregroundService = foregroundService ?? ForegroundTaskService();

  bool get isTransmitting => _isTransmitting;
  int get sampleRate => _sampleRate;
  String? get lastError => _lastError;

  /// Starts real hardware microphone audio transmission
  Future<bool> startAudioStream({required String pairingCode}) async {
    _currentPairingCode = pairingCode.trim();

    try {
      await stopAudioStream(_currentPairingCode);

      // 1. Capture real physical microphone stream
      final mediaConstraints = <String, dynamic>{
        'audio': {
          'sampleRate': _sampleRate,
          'echoCancellation': true,
          'noiseSuppression': true,
          'autoGainControl': true,
        },
        'video': false,
      };

      _audioStream = await navigator.mediaDevices.getUserMedia(mediaConstraints);

      // 2. Initialize real WebRTC PeerConnection for Audio Relay
      final rtcConfig = <String, dynamic>{
        'iceServers': [
          {'urls': 'stun:stun.l.google.com:19302'},
        ],
        'sdpSemantics': 'unified-plan',
      };

      _peerConnection = await createPeerConnection(rtcConfig);

      for (final track in _audioStream!.getAudioTracks()) {
        await _peerConnection!.addTrack(track, _audioStream!);
      }

      _isTransmitting = true;

      // 3. Update RTDB status
      await _rtdbClient.updatePath(
        'devices/$_currentPairingCode/audio',
        {
          'status': 'transmitting',
          'isTransmitting': true,
          'sampleRate': _sampleRate,
          'codec': 'opus',
          'source': 'hardware_mic',
          'startedAt': DateTime.now().millisecondsSinceEpoch,
        },
      );

      // 4. Update Android 14 Foreground Service Notification
      await _foregroundService.updateNotification(
        title: 'KidGuard Audio Active',
        text: 'One-way background microphone relay active',
      );

      _startAudioSignaling(_currentPairingCode);
      onStateChanged?.call(true);
      return true;
    } catch (e) {
      _isTransmitting = false;
      _lastError = 'Audio streaming failed: $e';
      onError?.call(_lastError!);
      return false;
    }
  }

  StreamSubscription<DatabaseEvent>? _signalingSubscription;
  StreamSubscription<DatabaseEvent>? _iceSubscription;

  void _startAudioSignaling(String pairingCode) {
    _signalingSubscription?.cancel();
    _iceSubscription?.cancel();

    final db = FirebaseDatabase.instance;
    final audioRef = db.ref('devices/$pairingCode/audio');

    // 1. Listen for SDP Offers/Answers
    _signalingSubscription = audioRef.onValue.listen((event) async {
      if (!_isTransmitting || _peerConnection == null) return;

      final data = event.snapshot.value;
      if (data is Map) {
        final offer = data['offer'];
        final answer = data['answer'];

        // Child side: If there is an offer from parent and we haven't answered yet
        if (offer != null && answer == null) {
          final sdp = offer['sdp'] as String?;
          final type = offer['type'] as String? ?? 'offer';
          
          if (sdp != null && _peerConnection?.signalingState == RTCSignalingState.RTCSignalingStateStable) {
            try {
              await _peerConnection!.setRemoteDescription(RTCSessionDescription(sdp, type));
              final createdAnswer = await _peerConnection!.createAnswer();
              await _peerConnection!.setLocalDescription(createdAnswer);

              await audioRef.update({
                'answer': {
                  'type': createdAnswer.type,
                  'sdp': createdAnswer.sdp,
                  'answeredAt': ServerValue.timestamp,
                }
              });
            } catch (e) {
              debugPrint('WebRTC Answer Error: $e');
            }
          }
        }
      }
    });

    // 2. Listen for Parent ICE Candidates
    _iceSubscription = db.ref('devices/$pairingCode/audio/parentCandidates').onChildAdded.listen((event) async {
      final candidateData = event.snapshot.value;
      if (candidateData is Map && _peerConnection != null) {
        try {
          await _peerConnection!.addCandidate(RTCIceCandidate(
            candidateData['candidate'],
            candidateData['sdpMid'],
            candidateData['sdpMLineIndex'],
          ));
        } catch (e) {
          debugPrint('Error adding ICE candidate: $e');
        }
      }
    });

    // 3. Generate and push Child ICE Candidates
    _peerConnection!.onIceCandidate = (candidate) async {
      if (candidate.candidate != null) {
        await db.ref('devices/$pairingCode/audio/childCandidates').push().set({
          'candidate': candidate.candidate,
          'sdpMid': candidate.sdpMid,
          'sdpMLineIndex': candidate.sdpMLineIndex,
          'timestamp': ServerValue.timestamp,
        });
      }
    };
  }

  /// Stops physical microphone streaming
  Future<bool> stopAudioStream(String pairingCode) async {
    _isTransmitting = false;
    _signalingSubscription?.cancel();
    _iceSubscription?.cancel();

    try {
      if (_audioStream != null) {
        for (final track in _audioStream!.getTracks()) {
          track.stop();
        }
        await _audioStream!.dispose();
        _audioStream = null;
      }

      if (_peerConnection != null) {
        await _peerConnection!.close();
        await _peerConnection!.dispose();
        _peerConnection = null;
      }

      if (pairingCode.isNotEmpty) {
        await _rtdbClient.updatePath(
          'devices/$pairingCode/audio',
          {
            'status': 'standby',
            'isTransmitting': false,
            'stoppedAt': DateTime.now().millisecondsSinceEpoch,
          },
        );
      }

      onStateChanged?.call(false);
      return true;
    } catch (e) {
      return false;
    }
  }

  Future<bool> toggleAudioStream(String pairingCode) async {
    if (_isTransmitting) {
      return await stopAudioStream(pairingCode);
    } else {
      return await startAudioStream(pairingCode: pairingCode);
    }
  }

  void dispose() {
    stopAudioStream(_currentPairingCode);
  }
}
