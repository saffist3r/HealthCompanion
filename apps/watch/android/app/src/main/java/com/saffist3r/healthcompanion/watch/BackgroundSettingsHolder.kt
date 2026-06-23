package com.saffist3r.healthcompanion.watch

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.drawable.BitmapDrawable
import androidx.core.content.ContextCompat
import androidx.lifecycle.LiveData
import androidx.lifecycle.MutableLiveData
import org.json.JSONArray
import java.io.File

object BackgroundSettingsHolder {
    private const val PREFS = "health_companion_background"
    private const val KEY_TYPE = "type"
    private const val KEY_SOLID = "solidColor"
    private const val KEY_GRADIENT = "gradientId"
    private const val KEY_IMAGE = "imageId"
    private const val KEY_IMAGE_IDS = "imageIdsJson"
    private const val KEY_STATUS_TINT = "statusTint"
    private const val KEY_TEXT_COLOR = "textColor"
    private const val KEY_SLIDESHOW = "slideshowIntervalSec"
    private const val KEY_UPDATED = "updatedAt"
    private const val MAX_CUSTOM_IMAGES = 10

    private val _settings = MutableLiveData(BackgroundSettings())
    val settings: LiveData<BackgroundSettings> = _settings

    private var appContext: Context? = null
    private val customBitmaps = mutableMapOf<Int, Bitmap>()

    fun init(context: Context) {
        appContext = context.applicationContext
        loadFromPrefs()
    }

    fun current(): BackgroundSettings = _settings.value ?: BackgroundSettings()

    fun update(settings: BackgroundSettings, fromSync: Boolean = false) {
        val ctx = appContext ?: return
        if (!fromSync && settings.updatedAt > 0 && settings.updatedAt <= current().updatedAt) return
        val normalized = settings.copy(
            imageId = settings.effectiveImageIds().first(),
            imageIds = settings.effectiveImageIds()
        )
        _settings.postValue(normalized)
        saveToPrefs(normalized)
        if (normalized.type == BackgroundType.IMAGE) {
            loadAllCustomBitmaps(ctx)
        } else {
            customBitmaps.clear()
        }
    }

    fun updateLocal(mutator: (BackgroundSettings) -> BackgroundSettings) {
        val next = mutator(current()).copy(updatedAt = System.currentTimeMillis())
        update(next, fromSync = true)
    }

    fun toggleImageId(id: String) {
        updateLocal { current ->
            val ids = current.effectiveImageIds().toMutableList()
            if (ids.contains(id)) {
                if (ids.size > 1) ids.remove(id) else return@updateLocal current
            } else {
                ids.add(id)
            }
            current.copy(imageIds = ids, imageId = ids.first(), type = BackgroundType.IMAGE)
        }
    }

    fun customBitmap(slot: Int = 0): Bitmap? = customBitmaps[slot]

    fun customBitmapCount(): Int = customBitmaps.size

    fun saveCustomImages(images: List<ByteArray>) {
        val ctx = appContext ?: return
        customBitmaps.clear()
        images.take(MAX_CUSTOM_IMAGES).forEachIndexed { index, bytes ->
            val file = customImageFile(ctx, index)
            file.parentFile?.mkdirs()
            file.writeBytes(bytes)
            decodeScaled(bytes)?.let { customBitmaps[index] = it }
        }
        val customIds = images.indices.map { customSlotId(it) }
        updateLocal { current ->
            val presets = current.effectiveImageIds().filter { !it.startsWith("custom:") }
            current.copy(
                type = BackgroundType.IMAGE,
                imageIds = presets + customIds,
                imageId = (presets + customIds).firstOrNull() ?: "custom:0"
            )
        }
    }

    @Deprecated("Use saveCustomImages")
    fun saveCustomImage(bytes: ByteArray) = saveCustomImages(listOf(bytes))

    @Deprecated("Use customBitmap(slot)")
    fun customBitmap(): Bitmap? = customBitmap(0)

    fun resolveImageBitmap(context: Context, imageId: String, width: Int, height: Int): Bitmap? {
        if (imageId.startsWith("custom:")) {
            val slot = imageId.removePrefix("custom:").toIntOrNull() ?: 0
            return customBitmaps[slot]
        }
        return drawableBitmap(context, imageId, width, height)
    }

    private fun customSlotId(index: Int) = "custom:$index"

    private fun loadAllCustomBitmaps(context: Context) {
        customBitmaps.clear()
        for (i in 0 until MAX_CUSTOM_IMAGES) {
            val file = customImageFile(context, i)
            if (!file.exists()) break
            decodeScaled(file.readBytes())?.let { customBitmaps[i] = it }
        }
    }

    private fun customImageFile(context: Context, index: Int): File =
        File(context.filesDir, if (index == 0) "background_custom.jpg" else "background_custom_$index.jpg")

    private fun decodeScaled(bytes: ByteArray): Bitmap? {
        val opts = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, opts)
        val sample = maxOf(1, (opts.outWidth / 512).coerceAtLeast(opts.outHeight / 512))
        return BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply {
            inSampleSize = sample
        })
    }

    fun presetBitmap(context: Context, imageId: String): Bitmap? {
        val resId = BackgroundPresets.imagePresetDrawables[imageId] ?: return null
        val drawable = ContextCompat.getDrawable(context, resId) as? BitmapDrawable
        if (drawable != null) return drawable.bitmap
        return null
    }

    fun drawableBitmap(context: Context, imageId: String, width: Int, height: Int): Bitmap? {
        val resId = BackgroundPresets.imagePresetDrawables[imageId] ?: return null
        val drawable = ContextCompat.getDrawable(context, resId) ?: return null
        val bmp = Bitmap.createBitmap(width.coerceAtLeast(1), height.coerceAtLeast(1), Bitmap.Config.ARGB_8888)
        val canvas = android.graphics.Canvas(bmp)
        drawable.setBounds(0, 0, width, height)
        drawable.draw(canvas)
        return bmp
    }

    private fun loadFromPrefs() {
        val ctx = appContext ?: return
        val prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val imageIds = parseImageIdsJson(prefs.getString(KEY_IMAGE_IDS, null))
        val legacyImageId = prefs.getString(KEY_IMAGE, "teal") ?: "teal"
        val loaded = BackgroundSettings(
            type = BackgroundType.fromWire(prefs.getString(KEY_TYPE, null)),
            solidColor = prefs.getString(KEY_SOLID, "#0D1117") ?: "#0D1117",
            gradientId = prefs.getString(KEY_GRADIENT, "mint") ?: "mint",
            imageId = imageIds.firstOrNull() ?: legacyImageId,
            imageIds = imageIds.ifEmpty { listOf(legacyImageId) },
            statusTint = prefs.getBoolean(KEY_STATUS_TINT, true),
            textColor = prefs.getString(KEY_TEXT_COLOR, "#FFFFFF") ?: "#FFFFFF",
            slideshowIntervalSec = prefs.getInt(KEY_SLIDESHOW, 30),
            updatedAt = prefs.getLong(KEY_UPDATED, 0L)
        )
        _settings.postValue(loaded)
        if (loaded.type == BackgroundType.IMAGE) {
            loadAllCustomBitmaps(ctx)
        }
    }

    private fun saveToPrefs(settings: BackgroundSettings) {
        val ctx = appContext ?: return
        val ids = settings.effectiveImageIds()
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putString(KEY_TYPE, settings.type.wire)
            .putString(KEY_SOLID, settings.solidColor)
            .putString(KEY_GRADIENT, settings.gradientId)
            .putString(KEY_IMAGE, ids.firstOrNull() ?: settings.imageId)
            .putString(KEY_IMAGE_IDS, JSONArray(ids).toString())
            .putBoolean(KEY_STATUS_TINT, settings.statusTint)
            .putString(KEY_TEXT_COLOR, settings.textColor)
            .putInt(KEY_SLIDESHOW, settings.slideshowIntervalSec)
            .putLong(KEY_UPDATED, settings.updatedAt)
            .apply()
    }

    private fun parseImageIdsJson(json: String?): List<String> {
        if (json.isNullOrBlank()) return emptyList()
        return try {
            val arr = JSONArray(json)
            buildList {
                for (i in 0 until arr.length()) {
                    val id = arr.optString(i)
                    if (id.isNotBlank()) add(id)
                }
            }
        } catch (_: Exception) {
            emptyList()
        }
    }
}
