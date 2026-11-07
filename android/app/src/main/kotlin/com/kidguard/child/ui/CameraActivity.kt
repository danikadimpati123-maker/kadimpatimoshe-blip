package com.kidguard.child.ui

import android.os.Bundle
import android.widget.ImageButton
import androidx.appcompat.app.AppCompatActivity
import com.kidguard.child.R

/**
 * CameraActivity
 * Native implementation for local camera preview with lens switching capabilities.
 */
class CameraActivity : AppCompatActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        android.util.Log.d("KidGuardCamera", "CameraActivity created")
        setContentView(R.layout.activity_camera)

        val btnSwitch = findViewById<ImageButton>(R.id.btn_switch_camera)
        
        btnSwitch.setOnClickListener {
            // Logic to switch camera lens
            switchCamera()
        }
    }

    private fun switchCamera() {
        android.util.Log.d("KidGuardCamera", "Switching camera triggered")
        // Logic to trigger camera lens switch in WebRTCSignalingService
        android.widget.Toast.makeText(this, "Switching camera...", android.widget.Toast.LENGTH_SHORT).show()
    }
}
