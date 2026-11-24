package com.saffist3r.healthcompanion.car

import android.content.Intent
import android.content.pm.ApplicationInfo
import androidx.car.app.CarAppService
import androidx.car.app.Screen
import androidx.car.app.Session
import androidx.car.app.validation.HostValidator

/** Entry point Android Auto binds to; it shows one screen with the live glucose. */
class GlucoseCarAppService : CarAppService() {
    override fun createHostValidator(): HostValidator =
        if (applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0) {
            HostValidator.ALLOW_ALL_HOSTS_VALIDATOR
        } else {
            HostValidator.Builder(applicationContext)
                .addAllowedHosts(androidx.car.app.R.array.hosts_allowlist_sample)
                .build()
        }

    override fun onCreateSession(): Session = GlucoseCarSession()
}

class GlucoseCarSession : Session() {
    override fun onCreateScreen(intent: Intent): Screen {
        CarGlucoseAlerts.markProjected()
        CarGlucoseAlerts.watchConnection(carContext)
        return GlucoseCarScreen(carContext)
    }
}
