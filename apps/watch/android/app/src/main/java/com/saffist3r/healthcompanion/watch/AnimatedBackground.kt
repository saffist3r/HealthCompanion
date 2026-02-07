package com.saffist3r.healthcompanion.watch

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.DrawScope
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.sin

private val TealLight = Color(0xFF4DD0E1)
private val TealDark = Color(0xFF00897B)
private val Mint = Color(0xFF80CBC4)
private val Coral = Color(0xFFFFAB91)
private val Lavender = Color(0xFFB39DDB)

@Composable
fun AnimatedBackground(
    modifier: Modifier = Modifier,
    statusColor: Int = 0xFF80CBC4.toInt()
) {
    val infiniteTransition = rememberInfiniteTransition(label = "background")

    val phase1 by infiniteTransition.animateFloat(
        initialValue = 0f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(
            animation = tween(8000, easing = LinearEasing),
            repeatMode = RepeatMode.Restart
        ),
        label = "phase1"
    )
    val phase2 by infiniteTransition.animateFloat(
        initialValue = 0f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(
            animation = tween(6000, easing = LinearEasing),
            repeatMode = RepeatMode.Restart
        ),
        label = "phase2"
    )
    val pulse by infiniteTransition.animateFloat(
        initialValue = 0.7f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(
            animation = tween(3000, easing = LinearEasing),
            repeatMode = RepeatMode.Reverse
        ),
        label = "pulse"
    )

    Canvas(modifier = modifier.fillMaxSize()) {
        val width = size.width
        val height = size.height
        val centerX = width / 2
        val centerY = height / 2

        // Solid dark base for maximum text readability
        drawRect(
            color = Color(0xFF0D1117),
            size = size
        )

        // Subtle animated gradient overlay (reduced for readability)
        val gradientCenter = Offset(
            centerX + (width * 0.3f * cos(phase1 * 2 * PI).toFloat()),
            centerY + (height * 0.3f * sin(phase1 * 2 * PI).toFloat())
        )
        val accentColor = Color(statusColor)
        drawRect(
            brush = Brush.radialGradient(
                colors = listOf(
                    accentColor.copy(alpha = 0.15f * pulse),
                    Color.Transparent
                ),
                center = gradientCenter,
                radius = width.coerceAtLeast(height)
            ),
            size = size
        )

        // Secondary gradient layer (offset phase)
        val gradientCenter2 = Offset(
            centerX + (width * 0.25f * cos(phase2 * 2 * PI + PI / 2).toFloat()),
            centerY + (height * 0.25f * sin(phase2 * 2 * PI + PI / 2).toFloat())
        )
        drawRect(
            brush = Brush.radialGradient(
                colors = listOf(
                    Lavender.copy(alpha = 0.08f * pulse),
                    Color.Transparent
                ),
                center = gradientCenter2,
                radius = width * 0.8f
            ),
            size = size
        )
    }
}

private fun DrawScope.drawFloatingOrbs(
    width: Float,
    height: Float,
    phase1: Float,
    phase2: Float,
    pulse: Float
) {
    val centerX = width / 2
    val centerY = height / 2

    val orb1X = centerX + (width * 0.35f * cos(phase1 * 2 * PI).toFloat())
    val orb1Y = centerY + (height * 0.2f * sin(phase1 * 2 * PI).toFloat())
    drawCircle(
        color = TealLight.copy(alpha = 0.35f * pulse),
        radius = width * 0.12f,
        center = Offset(orb1X, orb1Y)
    )

    val orb2X = centerX + (width * 0.3f * cos(phase2 * 2 * PI + PI / 3).toFloat())
    val orb2Y = centerY + (height * 0.25f * sin(phase2 * 2 * PI + PI / 3).toFloat())
    drawCircle(
        color = Coral.copy(alpha = 0.25f * pulse),
        radius = width * 0.08f,
        center = Offset(orb2X, orb2Y)
    )

    val orb3X = centerX + (width * 0.25f * cos(phase1 * 2 * PI + PI).toFloat())
    val orb3Y = centerY + (height * 0.3f * sin(phase1 * 2 * PI + PI).toFloat())
    drawCircle(
        color = Lavender.copy(alpha = 0.2f * pulse),
        radius = width * 0.06f,
        center = Offset(orb3X, orb3Y)
    )
}
