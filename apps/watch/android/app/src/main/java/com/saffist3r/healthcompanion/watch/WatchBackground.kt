package com.saffist3r.healthcompanion.watch

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.livedata.observeAsState
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import kotlinx.coroutines.delay
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.sin

private val Lavender = Color(0xFFB39DDB)

@Composable
fun WatchBackground(
    modifier: Modifier = Modifier,
    statusColor: Int = 0xFF80CBC4.toInt()
) {
    val settings by BackgroundSettingsHolder.settings.observeAsState(BackgroundSettings())
    val context = LocalContext.current

    var slideshowTick by remember { mutableIntStateOf(0) }
    val imageIds = settings.effectiveImageIds()
    LaunchedEffect(imageIds, settings.slideshowIntervalSec) {
        if (imageIds.size <= 1) return@LaunchedEffect
        while (true) {
            delay(settings.slideshowIntervalSec.coerceIn(5, 300) * 1000L)
            slideshowTick++
        }
    }

    when (settings.type) {
        BackgroundType.IMAGE -> {
            val activeId = remember(slideshowTick, settings) { settings.slideshowImageId() }
            val bmp = BackgroundSettingsHolder.resolveImageBitmap(
                context,
                activeId,
                context.resources.displayMetrics.widthPixels,
                context.resources.displayMetrics.heightPixels
            )
            if (bmp != null) {
                Image(
                    bitmap = bmp.asImageBitmap(),
                    contentDescription = null,
                    modifier = modifier.fillMaxSize(),
                    contentScale = ContentScale.Crop
                )
                Canvas(modifier.fillMaxSize()) {
                    drawRect(Color.Black.copy(alpha = 0.4f))
                    if (settings.statusTint) drawStatusTint(size.width, size.height, statusColor, 0.7f)
                }
                return
            }
        }
        else -> Unit
    }

    val infiniteTransition = rememberInfiniteTransition(label = "background")
    val phase1 by infiniteTransition.animateFloat(
        initialValue = 0f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(animation = tween(8000, easing = LinearEasing), repeatMode = RepeatMode.Restart),
        label = "phase1"
    )
    val phase2 by infiniteTransition.animateFloat(
        initialValue = 0f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(animation = tween(6000, easing = LinearEasing), repeatMode = RepeatMode.Restart),
        label = "phase2"
    )
    val pulse by infiniteTransition.animateFloat(
        initialValue = 0.7f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(animation = tween(3000, easing = LinearEasing), repeatMode = RepeatMode.Reverse),
        label = "pulse"
    )

    Canvas(modifier = modifier.fillMaxSize()) {
        val width = size.width
        val height = size.height
        val centerX = width / 2
        val centerY = height / 2

        when (settings.type) {
            BackgroundType.SOLID -> drawRect(Color(BackgroundPresets.solidColorFor(settings.solidColor)))
            BackgroundType.GRADIENT -> {
                val preset = BackgroundPresets.gradientFor(settings.gradientId)
                drawRect(
                    brush = Brush.linearGradient(
                        colors = preset.colors.map { Color(it) },
                        start = Offset(0f, 0f),
                        end = Offset(width, height)
                    )
                )
            }
            BackgroundType.ANIMATED -> {
                val t = System.currentTimeMillis() / 1000f
                val pulse = 0.78f + 0.22f * sin(t * 1.4f)

                drawRect(
                    brush = Brush.linearGradient(
                        colors = listOf(Color(0xFF0A1628), Color(0xFF152A4A)),
                        start = Offset(0f, 0f),
                        end = Offset(width, height)
                    )
                )

                val orbColors = listOf(
                    Color(0xFF4DD0E1).copy(alpha = 0.32f * pulse),
                    Color(0xFFB39DDB).copy(alpha = 0.28f * pulse),
                    Color(0xFF81C784).copy(alpha = 0.26f * pulse),
                    Color(0xFFFFAB91).copy(alpha = 0.3f * pulse)
                )
                for (i in 0..3) {
                    val px = centerX + width * 0.38f * cos(t * (0.38f + i * 0.09f) + i * 1.4f).toFloat()
                    val py = centerY + height * 0.34f * sin(t * (0.32f + i * 0.07f) + i * 0.85f).toFloat()
                    val r = width * (0.1f + (i % 2) * 0.03f)
                    drawCircle(orbColors[i], r, Offset(px, py))
                }
            }
            else -> drawRect(Color(0xFF0D1117))
        }

        if (settings.statusTint && settings.type != BackgroundType.ANIMATED) {
            drawStatusTint(width, height, statusColor, pulse)
        } else if (settings.statusTint && settings.type == BackgroundType.ANIMATED) {
            val gradientCenter = Offset(
                centerX + (width * 0.3f * cos(phase1 * 2 * PI).toFloat()),
                centerY + (height * 0.3f * sin(phase1 * 2 * PI).toFloat())
            )
            drawRect(
                brush = Brush.radialGradient(
                    colors = listOf(Color(statusColor).copy(alpha = 0.15f * pulse), Color.Transparent),
                    center = gradientCenter,
                    radius = width.coerceAtLeast(height)
                )
            )
            val gradientCenter2 = Offset(
                centerX + (width * 0.25f * cos(phase2 * 2 * PI + PI / 2).toFloat()),
                centerY + (height * 0.25f * sin(phase2 * 2 * PI + PI / 2).toFloat())
            )
            drawRect(
                brush = Brush.radialGradient(
                    colors = listOf(Lavender.copy(alpha = 0.08f * pulse), Color.Transparent),
                    center = gradientCenter2,
                    radius = width * 0.8f
                )
            )
        }
    }
}

private fun androidx.compose.ui.graphics.drawscope.DrawScope.drawStatusTint(
    width: Float,
    height: Float,
    statusColor: Int,
    alpha: Float
) {
    drawRect(
        brush = Brush.radialGradient(
            colors = listOf(Color(statusColor).copy(alpha = 0.2f * alpha), Color.Transparent),
            center = Offset(width / 2, height / 2),
            radius = width.coerceAtLeast(height)
        )
    )
}
