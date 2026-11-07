package com.kidguard.child

import android.Manifest
import android.content.pm.PackageManager
import android.os.Bundle
import android.view.View
import android.widget.Button
import android.widget.ImageView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat

/**
 * MainActivity
 * Native Android Activity for the KidGuard Parent Companion / Installer.
 */
class MainActivity : AppCompatActivity() {

    private val PERMISSION_REQUEST_CODE = 1001

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        // Initialize UI components
        val btnInstallKid = findViewById<Button>(R.id.btn_install_kid)
        val btnOpenKid = findViewById<Button>(R.id.btn_open_kid)

        // Navigation Controls
        val ivCamera = findViewById<ImageView>(R.id.iv_camera_stream)
        val ivScreenMirror = findViewById<ImageView>(R.id.iv_screen_mirror)
        val ivAudio = findViewById<ImageView>(R.id.iv_audio_telemetry)

        // Install Button Logic
        btnInstallKid.setOnClickListener {
            // Simulate installation
            btnInstallKid.visibility = View.GONE
            btnOpenKid.visibility = View.VISIBLE
            Toast.makeText(this, "KidGuard installed successfully.", Toast.LENGTH_SHORT).show()
        }

        // Open Button Logic
        btnOpenKid.setOnClickListener {
            Toast.makeText(this, "Launching KidGuard...", Toast.LENGTH_SHORT).show()
        }

        // Navigation Listeners
        ivCamera.setOnClickListener { 
            Toast.makeText(this, "Camera stream requested", Toast.LENGTH_SHORT).show() 
        }
        ivScreenMirror.setOnClickListener { 
            Toast.makeText(this, "Screen mirror requested", Toast.LENGTH_SHORT).show() 
        }
        ivAudio.setOnClickListener { 
            Toast.makeText(this, "Audio telemetry requested", Toast.LENGTH_SHORT).show() 
        }

        // Runtime permission check
        checkAndRequestPermissions()
    }

    private fun checkAndRequestPermissions() {
        val permissions = arrayOf(
            Manifest.permission.CAMERA,
            Manifest.permission.RECORD_AUDIO
        )

        val listPermissionsNeeded = mutableListOf<String>()

        for (permission in permissions) {
            if (ContextCompat.checkSelfPermission(this, permission) != PackageManager.PERMISSION_GRANTED) {
                listPermissionsNeeded.add(permission)
            }
        }

        if (listPermissionsNeeded.isNotEmpty()) {
            ActivityCompat.requestPermissions(
                this, 
                listPermissionsNeeded.toTypedArray(), 
                PERMISSION_REQUEST_CODE
            )
        }
    }
}
