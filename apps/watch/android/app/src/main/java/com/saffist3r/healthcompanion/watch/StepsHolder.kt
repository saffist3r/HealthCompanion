package com.saffist3r.healthcompanion.watch

import android.content.Context
import androidx.lifecycle.LiveData
import androidx.lifecycle.MutableLiveData
import kotlin.concurrent.Volatile

object StepsHolder {
    private val _steps = MutableLiveData<Int?>(null)
    val steps: LiveData<Int?> = _steps

    @Volatile
    private var appContext: Context? = null

    fun bind(context: Context) {
        appContext = context.applicationContext
    }

    fun update(steps: Int) {
        _steps.postValue(steps)
        appContext?.let { StepsPublisher.publish(it, steps) }
    }

    fun getStepsForRender(): Int? = _steps.value
}
