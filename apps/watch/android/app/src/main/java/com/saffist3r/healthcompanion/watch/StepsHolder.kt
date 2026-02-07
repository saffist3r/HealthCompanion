package com.saffist3r.healthcompanion.watch

import androidx.lifecycle.LiveData
import androidx.lifecycle.MutableLiveData

object StepsHolder {
    private val _steps = MutableLiveData<Int?>(null)
    val steps: LiveData<Int?> = _steps

    fun update(steps: Int) {
        _steps.postValue(steps)
    }

    fun getStepsForRender(): Int? = _steps.value
}
