package com.saffist3r.healthcompanion.watch

import android.Manifest
import android.content.pm.PackageManager
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.getValue
import androidx.compose.runtime.livedata.observeAsState
import androidx.compose.ui.Modifier
import androidx.core.content.ContextCompat
import androidx.lifecycle.viewmodel.compose.viewModel

/** The glucose readout lives on the watch face; the app itself is just its settings. */
class MainActivity : ComponentActivity() {

    private val requestPermission = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { /* result not required for watch face to work */ }

    override fun onCreate(savedInstanceState: Bundle?) {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.BODY_SENSORS) != PackageManager.PERMISSION_GRANTED) {
            requestPermission.launch(Manifest.permission.BODY_SENSORS)
        }
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACTIVITY_RECOGNITION) != PackageManager.PERMISSION_GRANTED) {
            requestPermission.launch(Manifest.permission.ACTIVITY_RECOGNITION)
        }
        super.onCreate(savedInstanceState)
        GlycemiaHolder.init(applicationContext)
        BackgroundSettingsHolder.init(applicationContext)
        setContent {
            // Still pulls the latest reading from the phone while the app is open
            val viewModel: MainViewModel = viewModel(factory = MainViewModelFactory(application))
            val statusColor by viewModel.statusColor.observeAsState(0xFF80CBC4.toInt())

            Box(modifier = Modifier.fillMaxSize()) {
                WatchBackground(statusColor = statusColor)
                SettingsScreen()
            }
        }
    }
}
