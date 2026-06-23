package com.saffist3r.healthcompanion.watch

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.livedata.observeAsState
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.unit.dp

@Composable
fun SparklineChart(
    modifier: Modifier = Modifier,
    lineColor: Color = Color(0xFF81C784)
) {
    val revision by GlycemiaHolder.historyRevision.observeAsState(0)
    val points = remember(revision) { GlycemiaHolder.getSparklinePoints12h() }
    if (points.size < 2) return

    Canvas(
        modifier = modifier
            .fillMaxWidth()
            .height(36.dp)
    ) {
        val windowMs = 12L * 60 * 60 * 1000
        val yMin = 50.0
        val yMax = 300.0
        val now = System.currentTimeMillis()
        val windowStart = now - windowMs
        val left = 4f
        val right = size.width - 4f
        val top = 2f
        val bottom = size.height - 2f
        val plotW = right - left
        val plotH = bottom - top

        fun yFor(mgDl: Double): Float {
            val norm = ((mgDl - yMin) / (yMax - yMin)).toFloat().coerceIn(0f, 1f)
            return bottom - norm * plotH
        }

        val y70 = yFor(70.0)
        val y180 = yFor(180.0)
        drawLine(
            Color(0xFF81C784).copy(alpha = 0.35f),
            Offset(left, y70),
            Offset(right, y70),
            strokeWidth = 1f
        )
        drawLine(
            Color(0xFF81C784).copy(alpha = 0.35f),
            Offset(left, y180),
            Offset(right, y180),
            strokeWidth = 1f
        )

        val path = Path()
        var started = false
        for ((v, ts) in points) {
            val xFrac = ((ts - windowStart).toFloat() / windowMs).coerceIn(0f, 1f)
            val x = left + xFrac * plotW
            val y = yFor(v)
            if (!started) {
                path.moveTo(x, y)
                started = true
            } else {
                path.lineTo(x, y)
            }
        }
        drawPath(path, lineColor.copy(alpha = 0.9f), style = Stroke(width = 2.5f))
    }
}
