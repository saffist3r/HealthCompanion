package com.saffist3r.healthcompanion.watch

import android.graphics.Color

enum class BackgroundType(val wire: String) {
    ANIMATED("animated"),
    SOLID("solid"),
    GRADIENT("gradient"),
    IMAGE("image");

    companion object {
        fun fromWire(value: String?): BackgroundType =
            entries.firstOrNull { it.wire == value } ?: ANIMATED
    }
}

data class BackgroundSettings(
    val type: BackgroundType = BackgroundType.ANIMATED,
    val solidColor: String = "#0D1117",
    val gradientId: String = "mint",
    val imageId: String = "teal",
    val imageIds: List<String> = listOf("teal"),
    val statusTint: Boolean = true,
    val textColor: String = "#FFFFFF",
    val slideshowIntervalSec: Int = 30,
    val faceStyle: FaceStyle = FaceStyle.HUD,
    val updatedAt: Long = 0L
) {
    fun effectiveImageIds(): List<String> =
        imageIds.filter { it.isNotBlank() }.ifEmpty { listOf(imageId.ifBlank { "teal" }) }

    fun slideshowImageId(): String {
        val ids = effectiveImageIds()
        if (ids.size <= 1) return ids.first()
        val intervalMs = slideshowIntervalSec.coerceIn(5, 300) * 1000L
        val index = ((System.currentTimeMillis() / intervalMs) % ids.size).toInt()
        return ids[index]
    }
}

data class GradientPreset(val id: String, val colors: IntArray)

object BackgroundPresets {
    val solidColors: List<Pair<String, Int>> = listOf(
        "dark" to Color.parseColor("#0D1117"),
        "black" to Color.BLACK,
        "navy" to Color.parseColor("#0A1628"),
        "charcoal" to Color.parseColor("#1C1C1E"),
        "forest" to Color.parseColor("#0B1F12"),
        "wine" to Color.parseColor("#1A0A10")
    )

    val gradients: List<GradientPreset> = listOf(
        GradientPreset("mint", intArrayOf(Color.parseColor("#0D1117"), Color.parseColor("#00897B"), Color.parseColor("#4DD0E1"))),
        GradientPreset("sunset", intArrayOf(Color.parseColor("#1A0A0A"), Color.parseColor("#FF6B35"), Color.parseColor("#FFB74D"))),
        GradientPreset("lavender", intArrayOf(Color.parseColor("#0D1117"), Color.parseColor("#5E35B1"), Color.parseColor("#B39DDB"))),
        GradientPreset("ocean", intArrayOf(Color.parseColor("#0A1628"), Color.parseColor("#1565C0"), Color.parseColor("#4DD0E1"))),
        GradientPreset("midnight", intArrayOf(Color.BLACK, Color.parseColor("#1A237E"), Color.parseColor("#311B92")))
    )

    val imagePresetDrawables: Map<String, Int> = mapOf(
        "teal" to R.drawable.bg_preset_teal,
        "sunset" to R.drawable.bg_preset_sunset,
        "night" to R.drawable.bg_preset_night,
        "ocean" to R.drawable.bg_preset_ocean
    )

    fun gradientFor(id: String): GradientPreset =
        gradients.firstOrNull { it.id == id } ?: gradients.first()

    fun solidColorFor(hex: String): Int = try {
        Color.parseColor(hex)
    } catch (_: Exception) {
        Color.parseColor("#0D1117")
    }

    val textColors: List<Pair<String, Int>> = listOf(
        "white" to Color.WHITE,
        "soft" to Color.parseColor("#E0E0E0"),
        "mint" to Color.parseColor("#80CBC4"),
        "cyan" to Color.parseColor("#4DD0E1"),
        "gold" to Color.parseColor("#FFD54F"),
        "coral" to Color.parseColor("#FFAB91")
    )
}
