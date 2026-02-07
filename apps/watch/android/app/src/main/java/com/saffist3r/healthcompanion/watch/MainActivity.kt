package com.saffist3r.healthcompanion.watch

import android.Manifest
import android.content.pm.PackageManager
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.activity.compose.setContent
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.livedata.observeAsState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.wear.compose.material.Text

@OptIn(ExperimentalFoundationApi::class)
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
        setContent {
            val viewModel: MainViewModel = viewModel(
                factory = MainViewModelFactory(application)
            )
            val time by viewModel.currentTime.observeAsState("--:--")
            val glycemia by viewModel.glycemia.observeAsState("--")
            val timeAgo by viewModel.timeAgo.observeAsState("")
            val statusColor by viewModel.statusColor.observeAsState(0xFF80CBC4.toInt())
            val statusLabel by viewModel.statusLabel.observeAsState("")

            val pagerState = rememberPagerState(pageCount = { 2 })

            Box(modifier = Modifier.fillMaxSize()) {
                AnimatedBackground(statusColor = statusColor)

                HorizontalPager(
                    state = pagerState,
                    modifier = Modifier.fillMaxSize(),
                    userScrollEnabled = true,
                    beyondViewportPageCount = 1
                ) { page ->
                        when (page) {
                            0 -> MainScreen(
                                time = time,
                                glycemia = glycemia,
                                timeAgo = timeAgo,
                                statusColor = statusColor,
                                onTap = { viewModel.refresh() }
                            )
                            1 -> DetailsScreen(
                                glycemia = glycemia,
                                statusLabel = statusLabel,
                                timeAgo = timeAgo,
                                statusColor = statusColor,
                                onTap = { viewModel.refresh() }
                            )
                        }
                }
            }
        }
    }
}

@Composable
private fun MainScreen(
    time: String,
    glycemia: String,
    timeAgo: String,
    statusColor: Int,
    onTap: () -> Unit
) {
    val scale by animateFloatAsState(
        targetValue = 1f,
        animationSpec = tween(300),
        label = "glycemiaScale"
    )

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(12.dp)
            .clickable { onTap() },
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        Text(
            text = time,
            fontSize = 28.sp,
            fontWeight = FontWeight.SemiBold,
            color = Color.White
        )
        AnimatedContent(
            targetState = glycemia,
            transitionSpec = {
                fadeIn(animationSpec = tween(300)) togetherWith fadeOut(animationSpec = tween(300))
            },
            label = "glycemia"
        ) { value ->
            Text(
                text = value,
                fontSize = 48.sp,
                fontWeight = FontWeight.Bold,
                color = Color(statusColor),
                modifier = Modifier
                    .padding(top = 8.dp)
                    .scale(scale)
            )
        }
        if (timeAgo.isNotEmpty()) {
            Text(
                text = timeAgo,
                fontSize = 16.sp,
                fontWeight = FontWeight.Medium,
                color = Color.White.copy(alpha = 0.9f),
                modifier = Modifier.padding(top = 4.dp)
            )
        }
        if (glycemia == "--") {
            Text(
                text = "Swipe down to sync",
                fontSize = 12.sp,
                color = Color.White.copy(alpha = 0.7f),
                modifier = Modifier.padding(top = 12.dp)
            )
        }
    }
}

@Composable
private fun DetailsScreen(
    glycemia: String,
    statusLabel: String,
    timeAgo: String,
    statusColor: Int,
    onTap: () -> Unit
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(12.dp)
            .clickable { onTap() },
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        if (statusLabel.isNotEmpty()) {
            Text(
                text = statusLabel,
                fontSize = 24.sp,
                fontWeight = FontWeight.SemiBold,
                color = Color(statusColor)
            )
        }
        Text(
            text = glycemia,
            fontSize = 32.sp,
            fontWeight = FontWeight.Medium,
            color = Color.White.copy(alpha = 0.9f),
            modifier = Modifier.padding(top = 8.dp)
        )
        if (timeAgo.isNotEmpty()) {
            Text(
                text = timeAgo,
                fontSize = 14.sp,
                color = Color.White.copy(alpha = 0.7f),
                modifier = Modifier.padding(top = 4.dp)
            )
        }
    }
}
