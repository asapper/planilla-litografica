package com.planilla.backend.service;

import com.planilla.backend.model.EmployeeRow;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockMultipartFile;

import java.nio.charset.Charset;
import java.util.List;

import static org.assertj.core.api.Assertions.*;

/**
 * Unit tests for CsvParserService.
 *
 * Requirements verified:
 * - Employee header block (Empleado, código, nombre) precedes each summary row
 * - Summary row identified by: col[0] is DD/MM/YYYY date AND col[8] == "Ausencias"
 * - diasNoLaborados read from col[18] as integer
 * - horasExtrasSimples read from col[27] as HH:MM:SS → rounded integer hours
 * - horasExtrasDobles  read from col[28] as HH:MM:SS → rounded integer hours
 * - mes and anio derived from the summary-row date (DD/MM/YYYY)
 * - distinctMonths built from summary rows only, sorted chronologically
 * - multiMonth=true when more than one distinct month is present
 * - Empty file (no valid rows) throws exception
 * - Summary row without a preceding Empleado block is warned and skipped
 */
class CsvParserServiceTest {

    private CsvParserService service;

    @BeforeEach
    void setUp() {
        service = new CsvParserService();
    }

    // -----------------------------------------------------------------
    // CSV builder helpers
    // -----------------------------------------------------------------

    /** Builds a minimal CSV with one employee block + one summary row. */
    private String singleEmployee(String code, String name, String date,
                                   String dias, String simples, String dobles) {
        // col indices: 0=tag, 1=code, 2=name
        String employeeLine = "Empleado," + code + "," + name + "\n";

        // summary row: col[0]=date, col[8]="Ausencias", col[18]=dias,
        //              col[27]=simples, col[28]=dobles
        return employeeLine + summaryLine(date, dias, simples, dobles);
    }

    /** Returns one summary CSV line with the required column positions. */
    private String summaryLine(String date, String dias, String simples, String dobles) {
        // Build 29 columns (indices 0-28)
        String[] cols = new String[29];
        for (int i = 0; i < cols.length; i++) cols[i] = "";
        cols[0]  = date;
        cols[8]  = "Ausencias";
        cols[18] = dias;
        cols[27] = simples;
        cols[28] = dobles;
        return String.join(",", cols) + "\n";
    }

    private MockMultipartFile toFile(String csv) {
        byte[] bytes = csv.getBytes(Charset.forName("ISO-8859-1"));
        return new MockMultipartFile("file", "planilla.csv", "text/csv", bytes);
    }

    // -----------------------------------------------------------------
    // Happy-path parsing
    // -----------------------------------------------------------------

    @Test
    void parsesBasicEmployeeRow() throws Exception {
        String csv = singleEmployee("42", "Juan Pérez", "10/12/2024", "2", "3:30:00", "1:45:00");
        CsvParserService.ParseResult result = service.parse(toFile(csv));

        assertThat(result.rows).hasSize(1);
        EmployeeRow row = result.rows.get(0);
        assertThat(row.getCodigoEmpleado()).isEqualTo("42");
        assertThat(row.getNombreEmpleado()).isEqualTo("Juan Pérez");
        assertThat(row.getDiasNoLaborados()).isEqualTo(2);
        assertThat(row.getMes()).isEqualTo(12);
        assertThat(row.getAnio()).isEqualTo(2024);
    }

    @Test
    void convertsHorasExtrasSimplesToRoundedHours() throws Exception {
        // 3:30:00 = 3.5 hours → rounds to 4
        String csv = singleEmployee("1", "A", "01/01/2024", "0", "3:30:00", "0:00:00");
        EmployeeRow row = service.parse(toFile(csv)).rows.get(0);
        assertThat(row.getHorasExtrasSimples()).isEqualTo(4);
    }

    @Test
    void convertsHorasExtrasDoblesTruncated() throws Exception {
        // 2:15:00 = 2.25 hours → rounds to 2
        String csv = singleEmployee("1", "A", "01/01/2024", "0", "0:00:00", "2:15:00");
        EmployeeRow row = service.parse(toFile(csv)).rows.get(0);
        assertThat(row.getHorasExtrasDobles()).isEqualTo(2);
    }

    @Test
    void horasExtrasBlankDefaultsToZero() throws Exception {
        String csv = singleEmployee("1", "A", "01/01/2024", "0", "", "");
        EmployeeRow row = service.parse(toFile(csv)).rows.get(0);
        assertThat(row.getHorasExtrasSimples()).isZero();
        assertThat(row.getHorasExtrasDobles()).isZero();
    }

    @Test
    void diasNoLaboradosBlankDefaultsToZero() throws Exception {
        String csv = singleEmployee("1", "A", "01/01/2024", "", "0", "0");
        EmployeeRow row = service.parse(toFile(csv)).rows.get(0);
        assertThat(row.getDiasNoLaborados()).isZero();
    }

    @Test
    void extractsMesAndAnioFromDate() throws Exception {
        String csv = singleEmployee("5", "B", "15/07/2023", "1", "0", "0");
        EmployeeRow row = service.parse(toFile(csv)).rows.get(0);
        assertThat(row.getMes()).isEqualTo(7);
        assertThat(row.getAnio()).isEqualTo(2023);
    }

    // -----------------------------------------------------------------
    // Multi-employee file
    // -----------------------------------------------------------------

    @Test
    void parsesMultipleEmployees() throws Exception {
        String csv = singleEmployee("10", "Ana", "10/12/2024", "0", "1:00:00", "0")
                   + singleEmployee("20", "Luis", "10/12/2024", "3", "0", "2:00:00");
        CsvParserService.ParseResult result = service.parse(toFile(csv));
        assertThat(result.rows).hasSize(2);
        assertThat(result.rows.get(0).getCodigoEmpleado()).isEqualTo("10");
        assertThat(result.rows.get(1).getCodigoEmpleado()).isEqualTo("20");
    }

    // -----------------------------------------------------------------
    // distinctMonths
    // -----------------------------------------------------------------

    @Test
    void singleMonthFileReturnsSingleDistinctMonth() throws Exception {
        String csv = singleEmployee("1", "A", "10/12/2024", "0", "0", "0")
                   + singleEmployee("2", "B", "10/12/2024", "0", "0", "0");
        CsvParserService.ParseResult result = service.parse(toFile(csv));
        assertThat(result.distinctMonths).hasSize(1);
        assertThat(result.distinctMonths.get(0)).containsExactly(12, 2024);
    }

    @Test
    void multiMonthFileReturnsSortedDistinctMonths() throws Exception {
        String csv = singleEmployee("1", "A", "10/12/2024", "0", "0", "0")
                   + singleEmployee("2", "B", "10/11/2024", "0", "0", "0");
        CsvParserService.ParseResult result = service.parse(toFile(csv));
        assertThat(result.distinctMonths).hasSize(2);
        // sorted chronologically: Nov before Dec
        assertThat(result.distinctMonths.get(0)).containsExactly(11, 2024);
        assertThat(result.distinctMonths.get(1)).containsExactly(12, 2024);
    }

    // -----------------------------------------------------------------
    // Warnings and edge cases
    // -----------------------------------------------------------------

    @Test
    void warningIssuedWhenSummaryRowHasNoPrecedingEmployeeBlock() throws Exception {
        // A valid employee block first, then an orphan summary row
        String csv = singleEmployee("1", "A", "10/12/2024", "0", "0", "0")
                   + summaryLine("10/12/2024", "0", "0", "0"); // no Empleado header
        CsvParserService.ParseResult result = service.parse(toFile(csv));
        assertThat(result.rows).hasSize(1);   // orphan row not added
        assertThat(result.warnings).isNotEmpty();
    }

    @Test
    void nonSummaryRowsAreIgnored() throws Exception {
        // Rows that don't match the date + "Ausencias" pattern are silently ignored
        String csv = "Empleado,99,Carlos\n"
                   + "SomeOtherTag,data,data,data,data,data,data,data,NotAusencias\n"
                   + summaryLine("01/01/2024", "1", "0", "0");
        CsvParserService.ParseResult result = service.parse(toFile(csv));
        assertThat(result.rows).hasSize(1);
        assertThat(result.rows.get(0).getCodigoEmpleado()).isEqualTo("99");
    }

    @Test
    void emptyFileThrowsException() {
        MockMultipartFile empty = toFile("");
        assertThatThrownBy(() -> service.parse(empty))
            .isInstanceOf(Exception.class)
            .hasMessageContaining("No se encontraron registros");
    }

    @Test
    void fileWithNoValidSummaryRowsThrowsException() {
        MockMultipartFile file = toFile("Empleado,1,Test\nsome,random,data\n");
        assertThatThrownBy(() -> service.parse(file))
            .isInstanceOf(Exception.class)
            .hasMessageContaining("No se encontraron registros");
    }

    // -----------------------------------------------------------------
    // Time conversion edge cases
    // -----------------------------------------------------------------

    @Test
    void timeConversionHandlesHHMMFormat() throws Exception {
        // HH:MM without seconds
        String csv = singleEmployee("1", "A", "01/01/2024", "0", "2:30", "0");
        EmployeeRow row = service.parse(toFile(csv)).rows.get(0);
        assertThat(row.getHorasExtrasSimples()).isEqualTo(3); // 2.5 → 3
    }

    @Test
    void timeConversionHandlesWholeHours() throws Exception {
        String csv = singleEmployee("1", "A", "01/01/2024", "0", "5:00:00", "0");
        EmployeeRow row = service.parse(toFile(csv)).rows.get(0);
        assertThat(row.getHorasExtrasSimples()).isEqualTo(5);
    }

    // -----------------------------------------------------------------
    // Branch coverage: get() safe accessor (index >= size returns "")
    // -----------------------------------------------------------------

    @Test
    void recordWithFewerColumnsThanExpectedDoesNotThrow() throws Exception {
        // Summary row with only 9 columns — columns 18, 27, 28 are absent → all default to 0
        String[] cols = new String[9];
        for (int i = 0; i < cols.length; i++) cols[i] = "";
        cols[0] = "10/12/2024";
        cols[8] = "Ausencias";
        String shortLine = String.join(",", cols) + "\n";

        String csv = "Empleado,1,A\n" + shortLine;
        CsvParserService.ParseResult result = service.parse(toFile(csv));
        assertThat(result.rows).hasSize(1);
        EmployeeRow row = result.rows.get(0);
        assertThat(row.getDiasNoLaborados()).isZero();
        assertThat(row.getHorasExtrasSimples()).isZero();
        assertThat(row.getHorasExtrasDobles()).isZero();
    }

    // -----------------------------------------------------------------
    // Branch coverage: isDate() — non-date col[0] rows ignored silently
    // -----------------------------------------------------------------

    @Test
    void nonDateRowsBetweenEmployeeBlocksAreIgnored() throws Exception {
        String csv = "Empleado,1,A\n"
                   + "NotADate,some,data,here,x,x,x,x,Ausencias\n"  // not a date → skip
                   + summaryLine("10/12/2024", "2", "0", "0");
        CsvParserService.ParseResult result = service.parse(toFile(csv));
        assertThat(result.rows).hasSize(1);
        assertThat(result.rows.get(0).getDiasNoLaborados()).isEqualTo(2);
    }

    // -----------------------------------------------------------------
    // Branch coverage: date present but col[8] != "Ausencias" → ignored
    // -----------------------------------------------------------------

    @Test
    void dateRowWithoutAusenciasTagIsIgnored() throws Exception {
        // Build a 29-column row where col[0] is a valid date but col[8] is "OtherTag"
        String[] cols = new String[29];
        for (int i = 0; i < cols.length; i++) cols[i] = "";
        cols[0] = "10/12/2024";
        cols[8] = "OtherTag";
        String otherRow = String.join(",", cols) + "\n";

        String csv = "Empleado,1,A\n" + otherRow + summaryLine("10/12/2024", "1", "0", "0");
        CsvParserService.ParseResult result = service.parse(toFile(csv));
        // Only the "Ausencias" row is captured
        assertThat(result.rows).hasSize(1);
    }

    // -----------------------------------------------------------------
    // Branch coverage: blank currentCode (set to empty string, not null)
    // -----------------------------------------------------------------

    @Test
    void blankCodeInEmployeeBlockWarnsThenSkips() throws Exception {
        // Empleado line with blank code (col[1] = "   ")
        String csv = "Empleado,   ,A\n" + summaryLine("10/12/2024", "0", "0", "0")
                   + singleEmployee("1", "B", "10/12/2024", "0", "0", "0");
        CsvParserService.ParseResult result = service.parse(toFile(csv));
        // Orphan summary row is skipped; valid employee "1" is captured
        assertThat(result.rows).hasSize(1);
        assertThat(result.rows.get(0).getCodigoEmpleado()).isEqualTo("1");
        assertThat(result.warnings).isNotEmpty();
    }

    // -----------------------------------------------------------------
    // Branch coverage: convertTime with a single token (no colon)
    // -----------------------------------------------------------------

    @Test
    void timeConversionWithNoColonTreatsValueAsHours() throws Exception {
        // "8" with no colon → hours=8, minutes=0
        String csv = singleEmployee("1", "A", "01/01/2024", "0", "8", "0");
        EmployeeRow row = service.parse(toFile(csv)).rows.get(0);
        assertThat(row.getHorasExtrasSimples()).isEqualTo(8);
    }

    // -----------------------------------------------------------------
    // Branch coverage: convertTime with non-numeric value → 0
    // -----------------------------------------------------------------

    @Test
    void timeConversionWithNonNumericValueDefaultsToZero() throws Exception {
        String csv = singleEmployee("1", "A", "01/01/2024", "0", "abc:def", "0");
        EmployeeRow row = service.parse(toFile(csv)).rows.get(0);
        assertThat(row.getHorasExtrasSimples()).isZero();
    }

    // -----------------------------------------------------------------
    // Branch coverage: empty records in CSV are skipped
    // -----------------------------------------------------------------

    @Test
    void emptyLinesInCsvAreSkipped() throws Exception {
        // Insert blank lines between the employee block and summary row
        String csv = "Empleado,1,A\n\n\n" + summaryLine("10/12/2024", "1", "0", "0");
        CsvParserService.ParseResult result = service.parse(toFile(csv));
        assertThat(result.rows).hasSize(1);
    }
}
