package com.planilla.backend.model.tas;

public enum TasFlag {
    MISSING_ENTRY,
    MISSING_EXIT,
    SHIFT_MISMATCH,
    SAME_DAY_DOUBLE,
    START_CUTOFF,
    END_CUTOFF,
    AMBIGUOUS_SHIFT
}
