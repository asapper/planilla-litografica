# Validation Rules Specification
**Owner:** Marco Silva — Backend Developer
**Status:** Phase 0 Draft
**Last updated:** 2026-04-21

---

## 1. Overview

Validation runs in the backend (Spring Boot) after CSV parsing and before any DB interaction. Rules are loaded from `config/validation-rules.json` at application startup, making them editable by a technical admin without touching code.

Validation runs at two points:
1. **On upload** — immediately after parsing, before the grid is shown to the user
2. **On submit** — as a final server-side check before calling the stored procedure

---

## 2. Validation Rule Format

Each field in `validation-rules.json` supports the following properties:

| Property | Type | Description |
|---|---|---|
| `required` | boolean | Field must be present and non-null |
| `type` | string | `"string"`, `"integer"` |
| `min` | number | Minimum value (integers) or minimum length (strings) |
| `max` | number | Maximum value (integers) or maximum length (strings) |
| `description` | string | Human-readable description (for logging and error messages) |

---

## 3. Current Rules

See `config/validation-rules.json` for the live config. Summary:

| Field | Required | Type | Constraints |
|---|---|---|---|
| `codigo_empleado` | Yes | string | Non-empty |
| `dias_no_laborados` | Yes | integer | ≥ 0 |
| `horas_extras_simples` | Yes | integer | ≥ 0 |
| `horas_extras_dobles` | Yes | integer | ≥ 0 |
| `numero_de_quincena` | Yes | integer | 1 or 2 |
| `mes` | Yes | integer | 1–12 |
| `anio` | Yes | integer | 2000–2100 |

---

## 4. Error Response Format

Validation errors are returned per field, per row, so the frontend can highlight specific cells.

```json
{
  "valid": false,
  "rows": [
    {
      "codigo_empleado": "3",
      "valid": true,
      "errors": []
    },
    {
      "codigo_empleado": "16",
      "valid": false,
      "errors": [
        {
          "field": "horas_extras_simples",
          "message": "Debe ser un número entero mayor o igual a 0"
        }
      ]
    }
  ]
}
```

---

## 5. Duplicate Check

Duplicate detection is a separate step from field validation, executed against the DB before submission.

**A record is a duplicate if:**
`codigo_empleado + numero_de_quincena + mes + anio` already exists in the database.

**Behavior:**
- Duplicate rows are flagged in the response with `"duplicate": true`
- They are excluded from submission automatically
- Non-duplicate rows in the same file proceed normally
- No override is possible from the UI

---

## 6. Extending Rules

To add a new validation rule:
1. Edit `config/validation-rules.json`
2. Add or modify the field entry
3. Restart the backend — rules are loaded at startup

No code changes required for rule modifications within the supported property set.
