package com.planilla.backend.model.tas;

import org.junit.jupiter.api.Test;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class TasSessionIncompleteTest {

    private static TasSession lone(TasFlag... flags) {
        TasSession s = new TasSession();
        s.setDate(LocalDate.of(2026, 10, 1));
        s.setNeedsResolution(true);
        s.setScans(new ArrayList<>(List.of(LocalDateTime.of(2026, 10, 1, 7, 2))));
        s.setFlags(new ArrayList<>(List.of(flags)));
        return s;
    }

    @Test
    void aLoneScanOfADayWorkerIsIncompleteAndDoesNotBlockSending() {
        for (TasSession s : List.of(lone(TasFlag.MISSING_EXIT), lone(TasFlag.MISSING_ENTRY),
                lone(TasFlag.BEST_FIT_SHIFT, TasFlag.MISSING_EXIT), lone(TasFlag.SHIFT_MISMATCH, TasFlag.MISSING_EXIT))) {
            assertThat(s.isIncomplete()).as("%s", s.getFlags()).isTrue();
            assertThat(TasSession.blocksSubmit(s)).as("%s", s.getFlags()).isFalse();
        }
    }

    @Test
    void aNightWorkersEveningScanStartsItsOwnNightSoItMayStayEmpty() {
        TasSession entry = lone(TasFlag.SHIFT_MISMATCH, TasFlag.MISSING_EXIT);
        entry.getScans().set(0, LocalDateTime.of(2026, 10, 8, 18, 5));
        entry.setAssignedShiftCrossMidnight(true);
        assertThat(entry.isIncomplete()).isTrue();
        assertThat(TasSession.blocksSubmit(entry)).isFalse();

        TasSession unassigned = lone(TasFlag.BEST_FIT_SHIFT, TasFlag.MISSING_EXIT);
        unassigned.getScans().set(0, LocalDateTime.of(2026, 10, 2, 17, 2));
        unassigned.setCrossMidnight(true);
        assertThat(TasSession.blocksSubmit(unassigned)).isFalse();

        TasSession noon = lone(TasFlag.MISSING_EXIT);
        noon.getScans().set(0, LocalDateTime.of(2026, 10, 2, 12, 0));
        noon.setAssignedShiftCrossMidnight(true);
        assertThat(noon.isIncomplete()).isTrue();

        for (LocalDateTime morning : List.of(LocalDateTime.of(2026, 10, 3, 0, 30), LocalDateTime.of(2026, 10, 3, 11, 59))) {
            TasSession s = lone(TasFlag.MISSING_ENTRY);
            s.getScans().set(0, morning);
            s.setAssignedShiftCrossMidnight(true);
            assertThat(TasSession.blocksSubmit(s)).as("%s", morning).isTrue();
        }
    }

    @Test
    void aNightWorkersLoneScanMayBeOnTheWrongDateSoItStillBlocks() {
        TasSession s = lone(TasFlag.MISSING_EXIT);
        s.setAssignedShiftCrossMidnight(true);
        assertThat(s.isIncomplete()).isFalse();
        assertThat(TasSession.blocksSubmit(s)).isTrue();
    }

    @Test
    void withNoShiftAssigned_aLoneScanMatchedToANightStillBlocks() {
        TasSession s = lone(TasFlag.MISSING_EXIT);
        s.setCrossMidnight(true);
        assertThat(TasSession.blocksSubmit(s)).isTrue();
        s.setAssignedShiftId("manana");
        assertThat(TasSession.blocksSubmit(s)).isFalse();
    }

    @Test
    void aLoneScanAtTheFilesEdgeStillBlocks() {
        assertThat(TasSession.blocksSubmit(lone(TasFlag.MISSING_EXIT, TasFlag.START_CUTOFF))).isTrue();
        assertThat(TasSession.blocksSubmit(lone(TasFlag.MISSING_ENTRY, TasFlag.END_CUTOFF))).isTrue();
    }

    @Test
    void anUndecidedDoubleBlocksButIsSkippableOnceDecided() {
        TasSession s = lone(TasFlag.SAME_DAY_DOUBLE, TasFlag.MISSING_EXIT);
        assertThat(s.isIncomplete()).isTrue();
        assertThat(TasSession.blocksSubmit(s)).isTrue();
        s.getFlags().remove(TasFlag.SAME_DAY_DOUBLE);
        assertThat(TasSession.blocksSubmit(s)).isFalse();
    }

    @Test
    void onlyALoneUnresolvedScanWithAMissingSideIsIncomplete() {
        TasSession twoScans = lone(TasFlag.MISSING_EXIT);
        twoScans.getScans().add(LocalDateTime.of(2026, 10, 1, 9, 0));
        TasSession noMissingSide = lone(TasFlag.SHIFT_MISMATCH);
        TasSession resolved = lone(TasFlag.MISSING_EXIT);
        resolved.setNeedsResolution(false);
        TasSession noScans = lone(TasFlag.MISSING_EXIT);
        noScans.setScans(null);
        TasSession noFlags = lone();
        noFlags.setFlags(null);
        for (TasSession s : List.of(twoScans, noMissingSide, noScans, noFlags)) {
            assertThat(s.isIncomplete()).isFalse();
            assertThat(TasSession.blocksSubmit(s)).isTrue();
        }
        assertThat(resolved.isIncomplete()).isFalse();
        assertThat(TasSession.blocksSubmit(resolved)).isFalse();
    }
}
