package com.saffist3r.healthcompanion.watch

import androidx.lifecycle.LiveData
import androidx.lifecycle.MutableLiveData

object HeartRateHolder {
    private val _bpm = MutableLiveData<Int?>(null)
    val bpm: LiveData<Int?> = _bpm

    fun update(bpm: Int) {
        _bpm.postValue(bpm)
    }

    fun getBpmForRender(): Int? = _bpm.value
}
