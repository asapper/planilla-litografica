# CSV Data Loader App – Architecture & Design Document (v2)

## Overview

This application enables non-technical users to:

1. Upload CSV file(s)
2. Review and edit data in a spreadsheet-like interface
3. Validate the data against configurable rules
4. Approve and upload the data into an external database via a stored procedure

---

## Core Goals

### For Users
- Extremely simple and intuitive UI
- No technical knowledge required
- Clear feedback (errors, warnings, success)
- Spreadsheet-like editing experience

### For Development
- Fast to build and iterate
- Cross-platform (develop on Mac, run on Windows)
- Minimal maintenance overhead
- Flexible and extensible validation system

---

## Final Technology Decision

#### Stack:
- **Frontend:** React
- **Data Grid:** AG Grid
- **Backend:** Java (Spring Boot)
- **Desktop Packaging:** Tauri

---

## Code

## 🔐 Why a Backend is Required

Although much of the logic (CSV parsing, validation, UI editing) can be implemented in the frontend, a backend is required for the following reasons:

### 1. Security
- Database credentials cannot be exposed in the frontend
- Direct database access from the browser is unsafe and not feasible

### 2. Controlled Data Ingestion
- Backend acts as a gatekeeper before data reaches the database
- Ensures all data passes validation and business rules

### 3. Stored Procedure Execution
- Stored procedures must be executed securely from a trusted environment
- Backend handles transformation and execution

### 4. Auditability & Logging
- Track uploads, duplicates, and errors
- Enable debugging and traceability

### 5. Duplicate Detection
- Requires querying the database
- Cannot be done reliably from the frontend alone

---

### Conclusion

The backend is intentionally designed as a **thin but critical layer**:
- It does NOT handle UI complexity
- It DOES handle security, validation enforcement, and database interaction
