package com.planilla.backend.service.tas;

import com.planilla.backend.model.tas.TasScanRecord;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockMultipartFile;

import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.charset.StandardCharsets;
import java.time.LocalDateTime;
import java.util.List;

import static org.assertj.core.api.Assertions.*;

class TasParserServiceTest {

    private final TasParserService service = new TasParserService();

    private static final String HEADER = "No.,Fecha y hora,Evento,Nombre de usuario,ID de usuario\n";

    private MockMultipartFile csv(String content) {
        byte[] bytes = content.getBytes(StandardCharsets.UTF_8);
        return new MockMultipartFile("file", "test.csv", "text/csv", bytes);
    }

    private MockMultipartFile csvWithBom(String content) {
        byte[] contentBytes = content.getBytes(StandardCharsets.UTF_8);
        byte[] bom = {(byte) 0xEF, (byte) 0xBB, (byte) 0xBF};
        byte[] combined = new byte[bom.length + contentBytes.length];
        System.arraycopy(bom, 0, combined, 0, bom.length);
        System.arraycopy(contentBytes, 0, combined, bom.length, contentBytes.length);
        return new MockMultipartFile("file", "test.csv", "text/csv", combined);
    }

    @Test
    void parse_validFile_returnsScansInAscendingOrder() throws Exception {
        String content = HEADER
                + "1,2026/03/15 19:46,Evento,Morales Roberto,134\n"
                + "2,2026/03/15 07:00,Evento,Garcia Ana,200\n"
                + "3,2026/03/15 07:05,Evento,Morales Roberto,134\n";

        TasParserService.ParseResult result = service.parse(csv(content));

        assertThat(result.scans).hasSize(3);
        assertThat(result.warnings).isEmpty();

        TasScanRecord first = result.scans.get(0);
        assertThat(first.getEmployeeId()).isEqualTo("134");
        assertThat(first.getTimestamp()).isEqualTo(LocalDateTime.of(2026, 3, 15, 7, 5));
    }

    @Test
    void parse_bomStripped_parsesCorrectly() throws Exception {
        String content = HEADER + "1,2026/03/10 08:00,Evento,Test User,99\n";

        TasParserService.ParseResult result = service.parse(csvWithBom(content));

        assertThat(result.scans).hasSize(1);
        assertThat(result.scans.get(0).getEmployeeId()).isEqualTo("99");
        assertThat(result.scans.get(0).getTimestamp()).isEqualTo(LocalDateTime.of(2026, 3, 10, 8, 0));
    }

    @Test
    void parse_scansExactly5MinutesApartAreKeptSeparate() throws Exception {
        String content = HEADER
                + "1,2026/03/15 07:00,Evento,Garcia Ana,200\n"
                + "2,2026/03/15 07:05,Evento,Garcia Ana,200\n";

        TasParserService.ParseResult result = service.parse(csv(content));

        assertThat(result.scans).hasSize(2);
    }

    @Test
    void parse_sortsByEmployeeIdThenTimestampAscending() throws Exception {
        String content = HEADER
                + "3,2026/03/15 22:00,Evento,Employee B,300\n"
                + "2,2026/03/15 15:00,Evento,Employee A,100\n"
                + "1,2026/03/15 07:00,Evento,Employee A,100\n";

        TasParserService.ParseResult result = service.parse(csv(content));

        assertThat(result.scans).hasSize(3);
        assertThat(result.scans.get(0).getEmployeeId()).isEqualTo("100");
        assertThat(result.scans.get(0).getTimestamp()).isEqualTo(LocalDateTime.of(2026, 3, 15, 7, 0));
        assertThat(result.scans.get(1).getEmployeeId()).isEqualTo("100");
        assertThat(result.scans.get(1).getTimestamp()).isEqualTo(LocalDateTime.of(2026, 3, 15, 15, 0));
        assertThat(result.scans.get(2).getEmployeeId()).isEqualTo("300");
    }

    @Test
    void parse_skipsHeaderRow() throws Exception {
        String content = HEADER + "1,2026/03/15 07:00,Evento,Test,555\n";

        TasParserService.ParseResult result = service.parse(csv(content));

        assertThat(result.scans).hasSize(1);
    }

    @Test
    void parse_emptyFile_throwsException() {
        MockMultipartFile emptyFile = new MockMultipartFile("file", "test.csv", "text/csv", new byte[0]);

        assertThatThrownBy(() -> service.parse(emptyFile))
                .isInstanceOf(Exception.class)
                .hasMessageContaining("Columnas requeridas no encontradas");
    }

    @Test
    void parse_headerOnlyFile_throwsException() throws Exception {
        MockMultipartFile headerOnly = csv(HEADER);

        assertThatThrownBy(() -> service.parse(headerOnly))
                .isInstanceOf(Exception.class)
                .hasMessageContaining("No se encontraron registros");
    }

    @Test
    void parse_invalidDateFormat_addsWarningAndSkipsRow() throws Exception {
        String content = HEADER
                + "1,invalid-date,Evento,Test,555\n"
                + "2,2026/03/15 07:00,Evento,Valid,200\n";

        TasParserService.ParseResult result = service.parse(csv(content));

        assertThat(result.scans).hasSize(1);
        assertThat(result.warnings).hasSize(1);
    }

    @Test
    void parse_employeeNameSetCorrectly() throws Exception {
        String content = HEADER + "1,2026/03/15 07:00,Evento,Morales Cifuentes Roberto,134\n";

        TasParserService.ParseResult result = service.parse(csv(content));

        assertThat(result.scans.get(0).getEmployeeName()).isEqualTo("Morales Cifuentes Roberto");
    }

    private MockMultipartFile fileFromDocs(String filename) throws Exception {
        Path path = Paths.get("../docs/" + filename);
        byte[] bytes = Files.readAllBytes(path);
        return new MockMultipartFile("file", filename, "text/csv", bytes);
    }

    @Test
    void parse_realTasFile_danielMorales() throws Exception {
        TasParserService.ParseResult result = service.parse(fileFromDocs("Reporte TAS Daniel Morales.csv"));
        assertThat(result.scans).hasSize(28);
        assertThat(result.warnings).isEmpty();
        assertThat(result.scans.get(0).getEmployeeId()).isEqualTo("134");
    }

    @Test
    void parse_realTasFile_marzo2026() throws Exception {
        TasParserService.ParseResult result = service.parse(fileFromDocs("Reporte TAS Marzo 2026.csv"));
        assertThat(result.scans).isNotEmpty();
    }

    @Test
    void parse_realTasFile_marzoYAbril2026() throws Exception {
        TasParserService.ParseResult result = service.parse(fileFromDocs("Reporte TAS Marzo y Abril 2026.csv"));
        assertThat(result.scans).isNotEmpty();
    }

    @Test
    void parse_quotedCsvFormat_parsesCorrectly() throws Exception {
        String content =
            "\"No.\",\"Fecha y hora\",\"Evento\",\"Nombre de usuario\",\"ID de usuario\"\n"
            + "\"1\",\"2026/04/30 19:11\",\"1:N Autenticación exitosa (Rostro)\",\"Morales Cifuentes Roberto Daniel\",\"134\"\n"
            + "\"2\",\"2026/04/30 08:51\",\"1:N Autenticación exitosa (Rostro)\",\"Morales Cifuentes Roberto Daniel\",\"134\"\n";

        TasParserService.ParseResult result = service.parse(csv(content));

        assertThat(result.scans).hasSize(2);
        assertThat(result.warnings).isEmpty();
        assertThat(result.scans.get(0).getEmployeeId()).isEqualTo("134");
    }

    @Test
    void parse_extraColumns_addsWarningAndParsesData() throws Exception {
        String header = "No.,Fecha y hora,Evento,Nombre de usuario,ID de usuario,Departamento,Cargo\n";
        String content = header
                + "1,2026/03/15 07:00,Evento,Garcia Ana,200,Ventas,Analista\n"
                + "2,2026/03/15 15:00,Evento,Garcia Ana,200,Ventas,Analista\n";

        TasParserService.ParseResult result = service.parse(csv(content));

        assertThat(result.scans).hasSize(2);
        assertThat(result.scans.get(0).getEmployeeId()).isEqualTo("200");
        assertThat(result.warnings).hasSize(1);
        assertThat(result.warnings.get(0)).contains("Departamento");
        assertThat(result.warnings.get(0)).contains("Cargo");
    }

    @Test
    void parse_missingRequiredColumns_throwsWithColumnNames() {
        String content = "No.,Evento,Nombre de usuario\n"
                + "1,Evento,Garcia Ana\n";

        assertThatThrownBy(() -> service.parse(csv(content)))
                .isInstanceOf(Exception.class)
                .hasMessageContaining("Columnas requeridas no encontradas")
                .hasMessageContaining("Fecha y hora")
                .hasMessageContaining("ID de usuario");
    }

    @Test
    void parse_reorderedColumns_parsesCorrectly() throws Exception {
        String header = "ID de usuario,Nombre de usuario,Fecha y hora,Evento,No.\n";
        String content = header + "200,Garcia Ana,2026/03/15 07:00,Evento,1\n";

        TasParserService.ParseResult result = service.parse(csv(content));

        assertThat(result.scans).hasSize(1);
        assertThat(result.scans.get(0).getEmployeeId()).isEqualTo("200");
        assertThat(result.scans.get(0).getEmployeeName()).isEqualTo("Garcia Ana");
        assertThat(result.scans.get(0).getTimestamp()).isEqualTo(LocalDateTime.of(2026, 3, 15, 7, 0));
        assertThat(result.warnings).isEmpty();
    }

    @Test
    void parse_headerOnlyWithExtraColumns_throwsNoRecords() {
        String content = "No.,Fecha y hora,Evento,Nombre de usuario,ID de usuario,Extra\n";

        assertThatThrownBy(() -> service.parse(csv(content)))
                .isInstanceOf(Exception.class)
                .hasMessageContaining("No se encontraron registros");
    }

    @Test
    void parse_extraColumnsWithReorderedRequired_parsesAndWarns() throws Exception {
        String header = "Departamento,ID de usuario,Nombre de usuario,Fecha y hora,Evento,No.,Cargo\n";
        String content = header + "Ventas,200,Garcia Ana,2026/03/15 07:00,Evento,1,Analista\n";

        TasParserService.ParseResult result = service.parse(csv(content));

        assertThat(result.scans).hasSize(1);
        assertThat(result.scans.get(0).getEmployeeId()).isEqualTo("200");
        assertThat(result.warnings).hasSize(1);
        assertThat(result.warnings.get(0)).contains("Departamento");
        assertThat(result.warnings.get(0)).contains("Cargo");
    }
}
