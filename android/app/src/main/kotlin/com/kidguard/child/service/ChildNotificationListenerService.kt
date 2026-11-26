package com.kidguard.child.service

import android.app.Notification
import android.content.Context
import android.content.Intent
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import android.util.Log

/**
 * ChildNotificationListenerService
 * Extends KidGuardNotifListener to provide full Firebase RTDB synchronization,
 * category resolution, and safety keyword analysis while maintaining backward compatibility.
 */
class ChildNotificationListenerService : KidGuardNotifListener()
