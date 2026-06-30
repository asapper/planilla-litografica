package com.planilla.backend.controller;

import com.planilla.backend.service.tas.HolidayService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/config/holidays")
public class HolidayController {

    private static final Logger log = LoggerFactory.getLogger(HolidayController.class);

    private final HolidayService holidayService;

    public HolidayController(HolidayService holidayService) {
        this.holidayService = holidayService;
    }

    @GetMapping
    public ResponseEntity<?> getForYear(@RequestParam int year) {
        List<Map<String, Object>> holidays = holidayService.getHolidaysForYear(year);
        return ResponseEntity.ok(holidays);
    }

    @PostMapping
    public ResponseEntity<?> addManual(@RequestBody Map<String, Object> body) {
        String date = (String) body.get("date");
        String name = (String) body.get("name");

        try {
            Map<String, Object> created = holidayService.addManualHoliday(date, name);
            return ResponseEntity.ok(created);
        } catch (Exception e) {
            log.error("Failed to add manual holiday", e);
            return ResponseEntity.badRequest().body(error(400, "ADD_FAILED", "No se pudo agregar el feriado."));
        }
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<?> delete(@PathVariable long id) {
        try {
            holidayService.deleteHoliday(id);
            return ResponseEntity.ok().build();
        } catch (Exception e) {
            log.error("Failed to delete holiday {}", id, e);
            return ResponseEntity.badRequest().body(error(400, "DELETE_FAILED", "No se pudo eliminar el feriado."));
        }
    }

    @PostMapping("/refresh")
    public ResponseEntity<?> refresh(@RequestParam int year) {
        boolean apiSuccess = holidayService.refreshFromApi(year);
        Map<String, Object> response = new HashMap<>();
        response.put("year", year);
        response.put("usedFallback", !apiSuccess);
        return ResponseEntity.ok(response);
    }

    private Map<String, Object> error(int status, String code, String message) {
        Map<String, Object> body = new HashMap<>();
        body.put("status", status);
        body.put("code", code);
        body.put("message", message);
        return body;
    }
}
