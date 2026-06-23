package com.saffist3r.healthcompanion.watch

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.livedata.observeAsState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.wear.compose.material.Text

@Composable
fun SettingsScreen() {
    val settings by BackgroundSettingsHolder.settings.observeAsState(BackgroundSettings())
    val scroll = rememberScrollState()
    val selectedImages = settings.effectiveImageIds()

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(scroll)
            .padding(horizontal = 10.dp, vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        Text("Background", fontSize = 16.sp, fontWeight = FontWeight.Bold, color = Color.White)

        SettingRow("Style") {
            Text(
                text = settings.type.wire.replaceFirstChar { it.uppercase() },
                fontSize = 13.sp,
                color = Color(0xFF4DD0E1),
                modifier = Modifier.clickable {
                    BackgroundSettingsHolder.updateLocal { current ->
                        val next = BackgroundType.entries[(current.type.ordinal + 1) % BackgroundType.entries.size]
                        current.copy(type = next)
                    }
                }
            )
        }

        SettingRow("Status tint") {
            Text(
                text = if (settings.statusTint) "On" else "Off",
                fontSize = 13.sp,
                color = Color(0xFF4DD0E1),
                modifier = Modifier.clickable {
                    BackgroundSettingsHolder.updateLocal { it.copy(statusTint = !it.statusTint) }
                }
            )
        }

        Text("Text color", fontSize = 12.sp, color = Color.White.copy(0.7f))
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            BackgroundPresets.textColors.forEach { (_, color) ->
                val hex = String.format("#%06X", 0xFFFFFF and color)
                val selected = settings.textColor.equals(hex, ignoreCase = true)
                Box(
                    modifier = Modifier
                        .size(22.dp)
                        .clip(CircleShape)
                        .background(Color(color))
                        .clickable {
                            BackgroundSettingsHolder.updateLocal { it.copy(textColor = hex) }
                        }
                        .then(if (selected) Modifier.background(Color.White.copy(0.3f), CircleShape) else Modifier)
                )
            }
        }

        if (settings.type == BackgroundType.SOLID) {
            Text("Color", fontSize = 12.sp, color = Color.White.copy(0.7f))
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                BackgroundPresets.solidColors.forEach { (_, color) ->
                    val hex = String.format("#%06X", 0xFFFFFF and color)
                    val selected = settings.solidColor.equals(hex, ignoreCase = true)
                    Box(
                        modifier = Modifier
                            .size(22.dp)
                            .clip(CircleShape)
                            .background(Color(color))
                            .clickable {
                                BackgroundSettingsHolder.updateLocal {
                                    it.copy(solidColor = hex)
                                }
                            }
                            .then(if (selected) Modifier.background(Color.White.copy(0.3f), CircleShape) else Modifier)
                    )
                }
            }
        }

        if (settings.type == BackgroundType.GRADIENT) {
            Text("Gradient", fontSize = 12.sp, color = Color.White.copy(0.7f))
            BackgroundPresets.gradients.forEach { preset ->
                val selected = preset.id == settings.gradientId
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(CircleShape)
                        .background(
                            Brush.horizontalGradient(preset.colors.map { Color(it) })
                        )
                        .clickable {
                            BackgroundSettingsHolder.updateLocal { it.copy(gradientId = preset.id) }
                        }
                        .padding(vertical = 6.dp, horizontal = 10.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        preset.id.replaceFirstChar { it.uppercase() },
                        fontSize = 12.sp,
                        color = Color.White,
                        fontWeight = if (selected) FontWeight.Bold else FontWeight.Normal
                    )
                }
            }
        }

        if (settings.type == BackgroundType.IMAGE) {
            Text("Images (tap to toggle)", fontSize = 12.sp, color = Color.White.copy(0.7f))
            if (selectedImages.size > 1) {
                Text(
                    "Slideshow: ${settings.slideshowIntervalSec}s",
                    fontSize = 11.sp,
                    color = Color(0xFF4DD0E1),
                    modifier = Modifier.clickable {
                        BackgroundSettingsHolder.updateLocal { current ->
                            val next = when (current.slideshowIntervalSec) {
                                15 -> 30
                                30 -> 60
                                60 -> 120
                                else -> 15
                            }
                            current.copy(slideshowIntervalSec = next)
                        }
                    }
                )
            }
            BackgroundPresets.imagePresetDrawables.keys.forEach { id ->
                SettingRow(id.replaceFirstChar { it.uppercase() }) {
                    Text(
                        if (selectedImages.contains(id)) "✓" else "—",
                        fontSize = 12.sp,
                        color = Color(0xFF4DD0E1),
                        modifier = Modifier.clickable {
                            BackgroundSettingsHolder.toggleImageId(id)
                        }
                    )
                }
            }
            val customCount = BackgroundSettingsHolder.customBitmapCount()
            if (customCount > 0) {
                for (i in 0 until customCount) {
                    val slotId = "custom:$i"
                    SettingRow("Custom ${i + 1}") {
                        Text(
                            if (selectedImages.contains(slotId)) "✓" else "—",
                            fontSize = 12.sp,
                            color = Color(0xFF4DD0E1),
                            modifier = Modifier.clickable {
                                BackgroundSettingsHolder.toggleImageId(slotId)
                            }
                        )
                    }
                }
            }
        }

        Text(
            "Sync from phone for custom photos",
            fontSize = 10.sp,
            color = Color.White.copy(0.5f),
            modifier = Modifier.padding(top = 4.dp)
        )
    }
}

@Composable
private fun SettingRow(label: String, content: @Composable () -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(label, fontSize = 13.sp, color = Color.White.copy(0.9f))
        content()
    }
}
