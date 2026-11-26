package com.kidguard.child.service

import android.app.Notification
import android.content.*
import android.provider.Settings
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import com.google.firebase.database.FirebaseDatabase
import java.util.UUID

open class KidGuardNotifListener : NotificationListenerService() {

    companion object {
        const val ACTION_NEW_NOTIFICATION = "com.kidguard.child.ACTION_NEW_NOTIFICATION"
        private const val RTDB_URL = "https://kidguard-3b499-default-rtdb.asia-southeast1.firebasedatabase.app"
        private val KEYWORD_REGEX = listOf(
            "suicide", "kill myself", "drugs", "weed", "cocaine", "heroin",
            "porn", "sex", "nude", "weapon", "gun", "knife", "meet me",
            "don't tell", "secret", "alone", "hate you", "die"
        ).map { Regex("\\b${Regex.escape(it)}\\b", RegexOption.IGNORE_CASE) }

        fun isNotificationServiceEnabled(ctx: Context): Boolean =
            Settings.Secure.getString(ctx.contentResolver, "enabled_notification_listeners")
                ?.split(":")?.any { ComponentName.unflattenFromString(it)?.packageName == ctx.packageName } == true

        fun openNotificationListenerSettings(ctx: Context) =
            ctx.startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }

    override fun onNotificationPosted(sbn: StatusBarNotification?) {
        val pkg = sbn?.packageName ?: return
        if (pkg == packageName || pkg.contains("kidguard", true)) return

        val ex = sbn.notification?.extras ?: return
        val title = ex.getCharSequence(Notification.EXTRA_TITLE)?.toString()?.trim().orEmpty()
        val text = listOf(Notification.EXTRA_TEXT, Notification.EXTRA_BIG_TEXT, Notification.EXTRA_SUB_TEXT, Notification.EXTRA_INFO_TEXT)
            .firstNotNullOfOrNull { ex.getCharSequence(it)?.toString()?.trim()?.takeIf(String::isNotEmpty) }.orEmpty()
        if (title.isEmpty() && text.isEmpty()) return

        val appName = runCatching { packageManager.getApplicationLabel(packageManager.getApplicationInfo(pkg, 0)).toString() }
            .getOrElse { pkg.substringAfterLast('.').replaceFirstChar(Char::uppercase) }
        val cat = resolveCategory(pkg, sbn.notification?.category)
        val ts = if (sbn.postTime > 0) sbn.postTime else System.currentTimeMillis()
        val id = "notif_${ts}_${UUID.randomUUID().toString().take(6)}"

        sendBroadcast(Intent(ACTION_NEW_NOTIFICATION).setPackage(packageName).apply {
            putExtra("id", id); putExtra("packageName", pkg); putExtra("package_name", pkg)
            putExtra("appName", appName); putExtra("app_name", appName); putExtra("title", title)
            putExtra("text", text); putExtra("category", cat); putExtra("timestamp", ts)
        })

        val code = (getSharedPreferences("kidguard_prefs", MODE_PRIVATE).getString("pairing_code", null)
            ?: getSharedPreferences("FlutterSharedPreferences", MODE_PRIVATE).getString("flutter.pairing_code", null))
            ?.trim()?.uppercase().orEmpty()
        if (code.isBlank()) return

        val root = FirebaseDatabase.getInstance(RTDB_URL).getReference("devices/$code")
        val notifRef = root.child("notifications")
        notifRef.child(id).setValue(mapOf(
            "id" to id, "appName" to appName, "packageName" to pkg,
            "title" to title, "text" to text, "category" to cat, "timestamp" to ts
        )).addOnSuccessListener {
            notifRef.get().addOnSuccessListener { snap ->
                snap.children
                    .sortedByDescending { it.child("timestamp").getValue(Long::class.java) ?: 0L }
                    .drop(30)
                    .forEach { it.ref.removeValue() }
            }
        }

        val hit = KEYWORD_REGEX.firstOrNull { it.containsMatchIn("$title $text") }?.pattern?.removeSurrounding("\\b") ?: return
        val alertId = "alert_${ts}_${UUID.randomUUID().toString().take(4)}"
        root.child("alerts/$alertId").setValue(mapOf(
            "id" to alertId, "type" to "keyword_matched", "appName" to appName, "packageName" to pkg,
            "matchedWord" to hit, "title" to title, "message" to text, "timestamp" to ts, "severity" to "high"
        ))
    }

    private fun resolveCategory(pkg: String, cat: String?): String {
        val p = pkg.lowercase()
        return when {
            cat == Notification.CATEGORY_MESSAGE || listOf("whatsapp", "telegram", "signal", "viber", "wechat", "line", "kakao", "skype", "messaging", "mms", "sms", "discord").any(p::contains) -> "messaging"
            cat == Notification.CATEGORY_SOCIAL || listOf("instagram", "tiktok", "facebook", "twitter", "snapchat", "reddit", "linkedin", "youtube", "pinterest", "threads").any(p::contains) -> "social"
            listOf("duolingo", "khan", "coursera", "quizlet", "classroom", "canvas", "photomath", "edx").any(p::contains) -> "education"
            cat == Notification.CATEGORY_PROGRESS || listOf("game", "roblox", "minecraft", "pubg", "brawlstars", "subwaysurf", "clash", "candycrush", "supercell", "ea.gp", "epicgames").any(p::contains) -> "game"
            else -> "system"
        }
    }
}
