package com.kidguard.child.service

import android.accessibilityservice.AccessibilityService
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import com.google.firebase.database.*
import com.kidguard.child.geofence.GeofenceManager
import com.kidguard.child.security.DeviceControlManager
import com.kidguard.child.usage.UsageStatsCollector
import java.util.Calendar

class KidGuardAccessibilityService : AccessibilityService() {

    private val db: DatabaseReference =
        FirebaseDatabase.getInstance("https://kidguard-3b499-default-rtdb.asia-southeast1.firebasedatabase.app").reference

    private lateinit var usageStatsCollector: UsageStatsCollector
    private lateinit var geofenceManager: GeofenceManager

    private var isAppLockEnabled = false
    private var isWebFilterEnabled = false
    private var isBedtimeEnabled = false
    private var dailyScreenTimeLimitMs = 0L
    private var bedtimeStartHour = 22
    private var bedtimeEndHour = 6
    private var blockedAppsList: Set<String> = emptySet()
    private var blockedDomains: Set<String> = setOf("adultsite.com", "badcontent.com", "phishing.net")
    private var policyListener: ValueEventListener? = null
    private var controlListener: ValueEventListener? = null
    private val alertTimestamps = mutableMapOf<String, Long>()

    companion object {
        private const val TAG = "KidGuardAccessibility"
        const val ACTION_APP_BLOCKED = "com.kidguard.child.ACTION_APP_BLOCKED"
        const val EXTRA_BLOCKED_PACKAGE = "blocked_package"
        private const val PREFS_NAME = "kidguard_prefs"
        private const val KEY_PAIRING_CODE = "pairing_code"
        private const val COOLDOWN_MS = 15_000L
    }

    override fun onCreate() {
        super.onCreate()
        usageStatsCollector = UsageStatsCollector(this)
        geofenceManager = GeofenceManager(this)
    }

    override fun onServiceConnected() {
        super.onServiceConnected()
        loadLocalPolicyCache()
        startListeningToPolicy()
    }

    private fun loadLocalPolicyCache() = runCatching {
        val p = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        isAppLockEnabled = p.getBoolean("app_lock_enabled", false)
        isWebFilterEnabled = p.getBoolean("web_filter_enabled", false)
        isBedtimeEnabled = p.getBoolean("bedtime_enabled", false)
        dailyScreenTimeLimitMs = p.getLong("screen_time_limit", 0L)
        bedtimeStartHour = p.getInt("bedtime_start", 22)
        bedtimeEndHour = p.getInt("bedtime_end", 6)
        blockedAppsList = p.getStringSet("blocked_packages", emptySet()).orEmpty()
        blockedDomains = p.getStringSet("blocked_domains", blockedDomains) ?: blockedDomains
    }.onFailure { Log.e(TAG, "Cache load error: ${it.message}") }

    private fun startListeningToPolicy() {
        val code = getDeviceCode()
        if (code.isBlank()) return

        policyListener = object : ValueEventListener {
            override fun onDataChange(snap: DataSnapshot) = runCatching {
                isAppLockEnabled = snap.child("appLockEnabled").getValue(Boolean::class.java) ?: false
                isWebFilterEnabled = snap.child("webFilterEnabled").getValue(Boolean::class.java) ?: false
                isBedtimeEnabled = snap.child("bedtimeEnabled").getValue(Boolean::class.java) ?: false
                dailyScreenTimeLimitMs = snap.child("dailyScreenTimeLimitMs").getValue(Long::class.java) ?: 0L
                bedtimeStartHour = snap.child("bedtimeStartHour").getValue(Int::class.java) ?: 22
                bedtimeEndHour = snap.child("bedtimeEndHour").getValue(Int::class.java) ?: 6
                blockedAppsList = parseSet(snap.child("blockedApps"))
                if (snap.child("blockedDomains").exists()) blockedDomains = parseSet(snap.child("blockedDomains"))

                val keywords = parseSet(snap.child("watchKeywords")).ifEmpty {
                    setOf("suicide", "drugs", "porn", "weapon", "meet me")
                }

                getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit()
                    .putBoolean("app_lock_enabled", isAppLockEnabled)
                    .putBoolean("web_filter_enabled", isWebFilterEnabled)
                    .putBoolean("bedtime_enabled", isBedtimeEnabled)
                    .putLong("screen_time_limit", dailyScreenTimeLimitMs)
                    .putBoolean("keyword_alerts_enabled", snap.child("keywordAlertsEnabled").getValue(Boolean::class.java) ?: true)
                    .putStringSet("watch_keywords", keywords)
                    .putInt("bedtime_start", bedtimeStartHour)
                    .putInt("bedtime_end", bedtimeEndHour)
                    .putStringSet("blocked_packages", blockedAppsList)
                    .putStringSet("blocked_domains", blockedDomains)
                    .apply()

                if (snap.child("safeZones").exists()) syncGeofences(snap.child("safeZones"))
            }.onFailure { Log.e(TAG, "Policy parse error: ${it.message}") }.let {}

            override fun onCancelled(error: DatabaseError) = Log.e(TAG, "Policy cancelled: ${error.message}")
        }

        db.child("devices/$code/policy").addValueEventListener(policyListener!!)

        val presence = db.child("devices/$code/presence")
        presence.child("online").setValue(true)
        presence.child("online").onDisconnect().setValue(false)
        presence.child("lastSeen").setValue(ServerValue.TIMESTAMP)
        presence.child("lastSeen").onDisconnect().setValue(ServerValue.TIMESTAMP)

        startListeningToControlCommands(code)
    }

    private fun startListeningToControlCommands(code: String) {
        controlListener = object : ValueEventListener {
            override fun onDataChange(snap: DataSnapshot) {
                val cmd = snap.child("command").getValue(String::class.java) ?: return
                if (snap.child("acknowledged").getValue(Boolean::class.java) == true) return

                when (cmd) {
                    "startStream" -> startWebRTCService("camera", snap.child("cameraFacing").getValue(String::class.java) ?: "back")
                    "startScreenShare" -> startWebRTCService("screen")
                    "stopStream", "stopScreenShare" -> stopWebRTCService()
                    "lockDevice" -> DeviceControlManager(this@KidGuardAccessibilityService).lockDevice()
                }
                db.child("devices/$code/control/acknowledged").setValue(true)
            }

            override fun onCancelled(error: DatabaseError) = Log.e(TAG, "Control cancelled: ${error.message}")
        }
        db.child("devices/$code/control").addValueEventListener(controlListener!!)
    }

    private fun startWebRTCService(type: String, facing: String = "back") {
        val intent = Intent(this, WebRTCSignalingService::class.java).apply {
            action = WebRTCSignalingService.ACTION_START
            putExtra(WebRTCSignalingService.EXTRA_TYPE, type)
            putExtra(WebRTCSignalingService.EXTRA_FACING, facing)
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) startForegroundService(intent) else startService(intent)
    }

    private fun stopWebRTCService() {
        startService(Intent(this, WebRTCSignalingService::class.java).apply { action = WebRTCSignalingService.ACTION_STOP })
    }

    private fun parseSet(snap: DataSnapshot): Set<String> = when (val v = snap.value) {
        is Map<*, *> -> v.keys.map { it.toString() }.toSet()
        is List<*> -> v.mapNotNull { it?.toString() }.toSet()
        else -> emptySet()
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        val pkg = event?.packageName?.toString() ?: return
        val type = event.eventType

        if (type == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) handleAppBlocking(pkg)

        if (isWebFilterEnabled && type in listOf(
                AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED,
                AccessibilityEvent.TYPE_VIEW_TEXT_CHANGED,
                AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED
            ) && listOf("com.android.chrome", "org.mozilla.firefox", "com.microsoft.emmx", "com.opera.browser").any(pkg::startsWith)
        ) {
            scanNodes(rootInActiveWindow) { text ->
                if (blockedDomains.any { text.contains(it.lowercase()) }) {
                    launchHomeScreen()
                    broadcastBlockedEvent("browser", "web_filter")
                    true
                } else false
            }
        }

        val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        if (prefs.getBoolean("keyword_alerts_enabled", true) && type in listOf(
                AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED,
                AccessibilityEvent.TYPE_VIEW_TEXT_CHANGED
            )
        ) {
            val words = prefs.getStringSet("watch_keywords", emptySet()).orEmpty()
            if (words.isNotEmpty()) {
                scanNodes(rootInActiveWindow) { text ->
                    val now = System.currentTimeMillis()
                    if (alertTimestamps.size > 100) alertTimestamps.clear()
                    words.forEach { raw ->
                        val w = raw.trim()
                        val key = w.lowercase()
                        if (w.isNotEmpty() &&
                            now - (alertTimestamps[key] ?: 0L) >= COOLDOWN_MS &&
                            Regex("\\b${Regex.escape(w)}\\b", RegexOption.IGNORE_CASE).containsMatchIn(text)
                        ) {
                            alertTimestamps[key] = now
                            reportKeywordMatch(w, text)
                        }
                    }
                    false
                }
            }
        }
    }

    private fun scanNodes(node: AccessibilityNodeInfo?, stopOnMatch: (String) -> Boolean) {
        if (node == null) return
        runCatching {
            val text = (node.text?.toString() ?: node.contentDescription?.toString() ?: "").lowercase()
            if (text.isNotBlank() && stopOnMatch(text)) return
            for (i in 0 until node.childCount) scanNodes(node.getChild(i), stopOnMatch)
        }
    }

    private fun reportKeywordMatch(keyword: String, contextText: String) {
        val code = getDeviceCode()
        if (code.isBlank()) return
        db.child("devices/$code/alerts").push().setValue(
            mapOf("type" to "keyword_alert", "keyword" to keyword, "context" to contextText, "timestamp" to ServerValue.TIMESTAMP)
        )
    }

    private fun syncGeofences(snap: DataSnapshot) {
        for (z in snap.children) {
            val id = z.key ?: continue
            val lat = z.child("lat").getValue(Double::class.java) ?: continue
            val lon = z.child("lon").getValue(Double::class.java) ?: continue
            val radius = z.child("radiusMeters").getValue(Float::class.java) ?: 200f
            geofenceManager.registerZone(id, lat, lon, radius)
        }
    }

    private fun handleAppBlocking(pkg: String) {
        if (pkg.isBlank() || pkg == packageName || pkg.contains("launcher", true) || pkg.contains("systemui", true) ||
            pkg in setOf("android", "com.google.android.packageinstaller", "com.android.settings")
        ) return

        when {
            isAppLockEnabled && blockedAppsList.contains(pkg) -> {
                launchHomeScreen(); broadcastBlockedEvent(pkg, "app_lock")
            }
            dailyScreenTimeLimitMs > 0 && usageStatsCollector.isDailyLimitExceeded(dailyScreenTimeLimitMs) -> {
                launchHomeScreen(); broadcastBlockedEvent(pkg, "screen_time_limit")
            }
            isBedtimeEnabled && isBedtimeActive() -> {
                launchHomeScreen(); broadcastBlockedEvent(pkg, "bedtime")
            }
        }
    }

    private fun isBedtimeActive(): Boolean {
        val cal = Calendar.getInstance()
        val now = cal.get(Calendar.HOUR_OF_DAY) * 60 + cal.get(Calendar.MINUTE)
        val start = bedtimeStartHour * 60
        val end = bedtimeEndHour * 60
        return if (start > end) now >= start || now <= end else now in start..end
    }

    private fun broadcastBlockedEvent(pkg: String, reason: String) = runCatching {
        sendBroadcast(Intent(ACTION_APP_BLOCKED).setPackage(packageName).putExtra(EXTRA_BLOCKED_PACKAGE, pkg).putExtra("reason", reason))
    }.onFailure { Log.e(TAG, "Broadcast error: ${it.message}") }.let {}

    override fun onInterrupt() = Log.d(TAG, "Accessibility service interrupted.")

    override fun onDestroy() {
        super.onDestroy()
        val code = getDeviceCode()
        if (code.isNotBlank()) {
            policyListener?.let { db.child("devices/$code/policy").removeEventListener(it) }
            controlListener?.let { db.child("devices/$code/control").removeEventListener(it) }
        }
    }

    private fun launchHomeScreen() = runCatching {
        startActivity(Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME).setFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP))
    }.onFailure { Log.e(TAG, "Home launch error: ${it.message}") }.let {}

    private fun getDeviceCode(): String {
        val raw = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).getString(KEY_PAIRING_CODE, null)
            ?: getSharedPreferences("FlutterSharedPreferences", Context.MODE_PRIVATE).getString("flutter.pairing_code", null)
        return raw?.trim()?.uppercase().orEmpty()
    }
}
