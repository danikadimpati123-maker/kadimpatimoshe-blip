import '../../child_app/data/models/telemetry_payload.dart';

/// Real-Time Child Device Telemetry Model for Parent Console
/// Bound directly to Firebase Realtime Database node: `/devices/{pairingCode}`
class ChildDevice {
  final String childId;
  final String deviceId;
  final String pairingCode;
  final String deviceModelName;
  final String platform;
  final String status;
  final bool isOnline;
  final int? lastSeen;
  final int? heartbeatAt;

  // Real-Time Battery Telemetry (/devices/{pairingCode}/telemetry/battery)
  final int batteryLevel;
  final bool isCharging;
  final String batteryState; // 'charging', 'discharging', 'full', 'unknown'
  final double batteryVoltage;
  final double batteryTemp;
  final String batteryHealth;
  final bool powerSaveMode;
  final int? batteryUpdatedAt;

  // Real-Time Live Location (/devices/{pairingCode}/location)
  final double latitude;
  final double longitude;
  final double accuracy;
  final double speed;
  final String address;
  final int? locationTimestamp;
  final bool hasValidGps;

  // Real WebRTC & Media Streaming States
  final bool isScreenMirroring;
  final bool isCameraStreaming;
  final bool isAudioStreaming;
  final String screenActiveApp;
  final int screenFps;
  final String cameraFacing;
  final String? screenFrameBase64;

  // Real Activity Lists from RTDB
  final List<NotificationPayload> notifications;
  final List<CallLogPayload> callLogs;
  final List<AppUsagePayload> appUsage;
  final List<Map<String, dynamic>> keywordAlerts;

  ChildDevice({
    required this.childId,
    required this.deviceId,
    required this.pairingCode,
    required this.deviceModelName,
    this.platform = 'android',
    this.status = 'paired',
    this.isOnline = true,
    this.lastSeen,
    this.heartbeatAt,
    this.batteryLevel = 100,
    this.isCharging = false,
    this.batteryState = 'unknown',
    this.batteryVoltage = 4.1,
    this.batteryTemp = 28.0,
    this.batteryHealth = 'Good (Li-ion)',
    this.powerSaveMode = false,
    this.batteryUpdatedAt,
    this.latitude = 0.0,
    this.longitude = 0.0,
    this.accuracy = 0.0,
    this.speed = 0.0,
    this.address = '',
    this.locationTimestamp,
    this.hasValidGps = false,
    this.isScreenMirroring = false,
    this.isCameraStreaming = false,
    this.isAudioStreaming = false,
    this.screenActiveApp = 'HomeScreen',
    this.screenFps = 12,
    this.cameraFacing = 'back',
    this.screenFrameBase64,
    this.notifications = const [],
    this.callLogs = const [],
    this.appUsage = const [],
    this.keywordAlerts = const [],
  });

  /// Factory constructor to parse real Firebase RTDB snapshot at `/devices/{key}`
  factory ChildDevice.fromMap(String key, Map<String, dynamic> data) {
    // ... [existing fields extraction]
    
    // ... [existing parsing logic]

    // 6. Dynamic Activity Lists
    final notifsList = _parseNotifications(data['notifications']);
    final callsList = _parseCallLogs(data['callLogs']);
    final usageList = _parseAppUsage(data['appUsage']);
    final keywordAlertsList = _parseKeywordAlerts(data['keywordAlerts']);

    final code = data['pairingCode']?.toString() ?? key;
    final model = data['deviceModelName']?.toString() ??
        data['deviceName']?.toString() ??
        telemetry['deviceModelName']?.toString() ??
        "Child's Device";

    return ChildDevice(
      childId: data['deviceId']?.toString() ?? key,
      deviceId: data['deviceId']?.toString() ?? key,
      pairingCode: code,
      deviceModelName: model,
      platform: data['platform']?.toString() ?? 'android',
      status: data['status']?.toString() ?? 'paired',
      isOnline: online,
      lastSeen: lastSeenMs,
      heartbeatAt: heartbeatMs,
      batteryLevel: level >= 0 ? level : 0,
      isCharging: charging,
      batteryState: stateStr,
      batteryVoltage: voltage,
      batteryTemp: temp,
      batteryHealth: health,
      powerSaveMode: powerSave,
      batteryUpdatedAt: batUpdated,
      latitude: lat,
      longitude: lng,
      accuracy: acc,
      speed: spd,
      address: addr,
      locationTimestamp: locTimestamp,
      hasValidGps: validGps,
      isScreenMirroring: screenSharing,
      isCameraStreaming: camStreaming,
      isAudioStreaming: audioStreaming,
      screenActiveApp: screenApp,
      screenFps: screenFpsVal,
      cameraFacing: camFacing,
      screenFrameBase64: screenFrame,
      notifications: notifsList,
      callLogs: callsList,
      appUsage: usageList,
      keywordAlerts: keywordAlertsList,
    );
  }

  static List<Map<String, dynamic>> _parseKeywordAlerts(dynamic raw) {
    if (raw == null) return const [];
    final list = <Map<String, dynamic>>[];
    if (raw is List) {
      for (final item in raw) {
        if (item is Map) {
          list.add(Map<String, dynamic>.from(item));
        }
      }
    } else if (raw is Map) {
      for (final item in raw.values) {
        if (item is Map) {
          list.add(Map<String, dynamic>.from(item));
        }
      }
    }
    // Sort newest first
    list.sort((a, b) => (b['timestamp'] as int? ?? 0).compareTo(a['timestamp'] as int? ?? 0));
    return list;
  }
// ... [existing _parseMethods]

  static List<NotificationPayload> _parseNotifications(dynamic raw) {
    if (raw == null) return const [];
    final list = <NotificationPayload>[];
    if (raw is List) {
      for (final item in raw) {
        if (item is Map) {
          list.add(NotificationPayload.fromJson(Map<String, dynamic>.from(item)));
        }
      }
    } else if (raw is Map) {
      for (final item in raw.values) {
        if (item is Map) {
          list.add(NotificationPayload.fromJson(Map<String, dynamic>.from(item)));
        }
      }
    }
    // Sort newest first
    list.sort((a, b) => b.timestamp.compareTo(a.timestamp));
    return list;
  }

  static List<CallLogPayload> _parseCallLogs(dynamic raw) {
    if (raw == null) return const [];
    final list = <CallLogPayload>[];
    if (raw is List) {
      for (final item in raw) {
        if (item is Map) {
          list.add(CallLogPayload.fromJson(Map<String, dynamic>.from(item)));
        }
      }
    } else if (raw is Map) {
      for (final item in raw.values) {
        if (item is Map) {
          list.add(CallLogPayload.fromJson(Map<String, dynamic>.from(item)));
        }
      }
    }
    list.sort((a, b) => b.timestamp.compareTo(a.timestamp));
    return list;
  }

  static List<AppUsagePayload> _parseAppUsage(dynamic raw) {
    if (raw == null) return const [];
    final list = <AppUsagePayload>[];
    if (raw is List) {
      for (final item in raw) {
        if (item is Map) {
          list.add(AppUsagePayload.fromJson(Map<String, dynamic>.from(item)));
        }
      }
    } else if (raw is Map) {
      for (final item in raw.values) {
        if (item is Map) {
          list.add(AppUsagePayload.fromJson(Map<String, dynamic>.from(item)));
        }
      }
    }
    list.sort((a, b) => b.hoursUsed.compareTo(a.hoursUsed));
    return list;
  }
}
