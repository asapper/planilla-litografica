import { test, type Page } from '@playwright/test';
import * as mock from './mock-data';

const OUT = '../docs/demo-data/screenshots';

// ── Noche cross-midnight session (not in shared mock-data) ──────────
const FLAGGED_NOCHE_MISSING_EXIT = {
  sessionId: 101, employeeId: 'E205', employeeName: 'Tzoc Cux, Miguel Ángel',
  date: '2026-06-16',
  scans: ['2026-06-16T19:05:00'],
  matchedShiftId: 'shift-3', matchedShiftName: 'Noche',
  assignedShiftId: 'shift-3', assignedShiftName: 'Noche',
  crossMidnight: true,
  effectiveStart: '2026-06-16T19:05:00', lastScan: null,
  workedMinutes: 0, workedHours: 0, needsResolution: true,
  flags: ['MISSING_EXIT'],
};

// ── Shared mock helpers ──────────────────────────────────────────────

async function mockHealth(page: Page) {
  await page.route('**/api/health', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  await page.route('**/api/db-health', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
}

async function mockConfig(page: Page) {
  await page.route('**/api/config/shifts', r =>
    r.request().method() === 'GET'
      ? r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mock.SHIFTS) })
      : r.continue(),
  );
  await page.route('**/api/config/employees**', r =>
    r.request().method() === 'GET'
      ? r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mock.EMPLOYEES) })
      : r.continue(),
  );
  await page.route('**/api/config/holidays**', r =>
    r.request().method() === 'GET'
      ? r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mock.HOLIDAYS) })
      : r.continue(),
  );
  await page.route('**/api/config/general', r =>
    r.request().method() === 'GET'
      ? r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mock.GENERAL_CONFIG) })
      : r.continue(),
  );
}

async function mockUpload(page: Page, result: object) {
  await page.route('**/api/tas/upload', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(result) }),
  );
}

async function mockResolve(page: Page) {
  await page.route('**/api/tas/resolve', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mock.RESOLVE_RESULT_TO_REVIEW) }),
  );
}

async function mockNoDuplicates(page: Page) {
  await page.route('**/api/tas/check-duplicates', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ duplicates: [] }) }),
  );
}

async function mockSubmit(page: Page) {
  await page.route('**/api/tas/submit', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ jobId: 'demo-job' }) }),
  );
}

async function mockJobSuccess(page: Page) {
  await page.route('**/api/tas/jobs/**', r =>
    r.request().method() === 'GET'
      ? r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mock.JOB_STATUS_SUCCESS) })
      : r.continue(),
  );
}

async function mockRecompute(page: Page) {
  await page.route('**/api/tas/recompute', r =>
    r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ resolvedRows: mock.RESOLVED_ROWS, sessionSummaries: mock.SESSION_SUMMARIES }),
    }),
  );
}

async function go(page: Page) {
  await page.goto('/');
  await page.waitForSelector('text=Cargador de Planilla', { timeout: 15_000 });
}

async function upload(page: Page) {
  await page.locator('input[type="file"]').setInputFiles({
    name: 'demo-reporte.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('"No.","Fecha y hora","Evento","Nombre de usuario","ID de usuario"\n"1","2026/06/16 07:05","Autenticación","Demo","201"\n'),
  });
}

async function snap(page: Page, name: string) {
  await page.screenshot({ path: `${OUT}/${name}`, fullPage: false });
}

function reviewUploadResult(flaggedSessions: object[] = []) {
  return {
    ...mock.UPLOAD_RESULT_WITH_FLAGS,
    flaggedSessions,
    resolvedRows: mock.RESOLVED_ROWS,
    availablePeriods: [{ anio: 2026, mes: 6, numeroDequincena: 2 }],
    absentActiveEmployees: [],
    inactiveEmployeesFound: [],
  };
}

// ── 1. Pantalla principal ────────────────────────────────────────────

test('01 - pantalla principal', async ({ page }) => {
  await mockHealth(page);
  await go(page);
  await page.waitForSelector('text=Seleccionar archivo');
  await snap(page, '01-pantalla-principal.png');
});

// ── 2. Selección de archivo (muestra área de carga) ──────────────────

test('02 - seleccion archivo', async ({ page }) => {
  await mockHealth(page);
  await go(page);
  await page.waitForSelector('text=Seleccionar archivo');
  // Highlight the upload zone so it's the visual focus
  await page.evaluate(() => {
    const btn = document.querySelector('label[for], input[type="file"]')?.closest('div, label');
    if (btn) (btn as HTMLElement).style.outline = '3px solid #e53e3e';
  });
  await snap(page, '02-seleccion-archivo.png');
});

// ── 3. Progreso de carga ─────────────────────────────────────────────

test('03 - progreso carga', async ({ page }) => {
  await mockHealth(page);
  await page.route('**/api/tas/upload', () => new Promise(() => {})); // never resolves
  await go(page);
  await upload(page);
  await page.waitForSelector('text=procesando', { timeout: 10_000 });
  await snap(page, '03-progreso-carga.png');
});

// ── 4. Selector de quincena ──────────────────────────────────────────

test('04 - selector quincena', async ({ page }) => {
  await mockHealth(page);
  await mockUpload(page, { ...mock.UPLOAD_RESULT_WITH_FLAGS, availablePeriods: mock.AVAILABLE_PERIODS });
  await go(page);
  await upload(page);
  await page.waitForSelector('text=Verificación de marcaciones', { timeout: 10_000 });
  await page.waitForSelector('text=Periodo');
  await snap(page, '04-selector-quincena.png');
});

// ── 5. Revisión sin alertas ──────────────────────────────────────────

test('05 - revision sin alertas', async ({ page }) => {
  await mockHealth(page);
  await mockNoDuplicates(page);
  await mockRecompute(page);
  await mockUpload(page, reviewUploadResult([]));
  await go(page);
  await upload(page);
  await page.waitForSelector('text=Revisión de registros procesados', { timeout: 10_000 });
  await page.waitForSelector('[aria-label^="Días no laborados"]', { timeout: 5_000 });
  await page.waitForTimeout(400);
  await snap(page, '05-revision-sin-alertas.png');
});

// ── 6. Revisión con alertas ──────────────────────────────────────────

test('06 - revision con alertas', async ({ page }) => {
  await mockHealth(page);
  await mockUpload(page, {
    ...mock.UPLOAD_RESULT_WITH_FLAGS,
    availablePeriods: [{ anio: 2026, mes: 6, numeroDequincena: 2 }],
  });
  await mockResolve(page);
  await go(page);
  await upload(page);
  await page.waitForSelector('text=Verificación de marcaciones', { timeout: 10_000 });
  await page.waitForTimeout(400);
  await snap(page, '06-revision-con-alertas.png');
});

// ── 7. Turno auto-detectado (SHIFT_MISMATCH) ─────────────────────────

test('07 - turno autodetectado', async ({ page }) => {
  await mockHealth(page);
  await mockUpload(page, {
    ...mock.UPLOAD_RESULT_WITH_FLAGS,
    flaggedSessions: [mock.FLAGGED_SHIFT_MISMATCH],
    availablePeriods: [{ anio: 2026, mes: 6, numeroDequincena: 1 }],
  });
  await go(page);
  await upload(page);
  await page.waitForSelector('text=Verificación de marcaciones', { timeout: 10_000 });
  await page.waitForSelector('text=Morales Pérez', { timeout: 5_000 });
  await page.waitForTimeout(400);
  await snap(page, '07-turno-autodetectado.png');
});

// ── 8. Verificación: ingreso de horas ───────────────────────────────

test('08 - verificacion horas', async ({ page }) => {
  await mockHealth(page);
  await mockUpload(page, {
    ...mock.UPLOAD_RESULT_WITH_FLAGS,
    flaggedSessions: [mock.FLAGGED_MISSING_EXIT],
    availablePeriods: [{ anio: 2026, mes: 6, numeroDequincena: 1 }],
  });
  await go(page);
  await upload(page);
  await page.waitForSelector('text=Verificación de marcaciones', { timeout: 10_000 });
  await page.waitForSelector('input[type="time"]', { timeout: 5_000 });
  await page.waitForTimeout(400);
  await snap(page, '08-verificacion-horas.png');
});

// ── 9. Verificación: turno nocturno (cruce de medianoche) ─────────────

test('09 - turno nocturno', async ({ page }) => {
  await mockHealth(page);
  await mockUpload(page, {
    ...mock.UPLOAD_RESULT_WITH_FLAGS,
    flaggedSessions: [FLAGGED_NOCHE_MISSING_EXIT],
    availablePeriods: [{ anio: 2026, mes: 6, numeroDequincena: 2 }],
  });
  await go(page);
  await upload(page);
  await page.waitForSelector('text=Verificación de marcaciones', { timeout: 10_000 });
  await page.waitForSelector('input[type="time"], input[placeholder="HH:MM"]', { timeout: 5_000 });
  await page.waitForTimeout(400);
  await snap(page, '09-turno-nocturno.png');
});

// ── 10. Confirmación de envío ─────────────────────────────────────────

test('10 - confirmacion envio', async ({ page }) => {
  await mockHealth(page);
  await mockNoDuplicates(page);
  await mockRecompute(page);
  await mockUpload(page, reviewUploadResult([]));
  await go(page);
  await upload(page);
  await page.waitForSelector('text=Revisión de registros procesados', { timeout: 10_000 });
  await page.waitForSelector('button:has-text("Enviar")', { timeout: 5_000 });
  await page.waitForTimeout(400);
  await snap(page, '10-confirmacion-envio.png');
});

// ── 11. Pantalla de éxito ─────────────────────────────────────────────

test('11 - pantalla exito', async ({ page }) => {
  await mockHealth(page);
  await mockNoDuplicates(page);
  await mockSubmit(page);
  await mockJobSuccess(page);
  await mockRecompute(page);
  await mockUpload(page, reviewUploadResult([]));
  await go(page);
  await upload(page);
  await page.waitForSelector('text=Revisión de registros procesados', { timeout: 10_000 });
  await page.locator('button:has-text("Enviar")').click();
  await page.waitForSelector('text=Carga completada', { timeout: 15_000 });
  await snap(page, '11-pantalla-exito.png');
});

// ── 12. Configuración: pestaña Turnos ────────────────────────────────

test('12 - config turnos', async ({ page }) => {
  await mockHealth(page);
  await mockConfig(page);
  await go(page);
  await page.locator('button:has-text("Configuración")').click();
  await page.waitForSelector('[aria-label="Nombre del turno"]', { timeout: 10_000 });
  await page.waitForTimeout(300);
  await snap(page, '12-config-turnos.png');
});

// ── 13. Configuración: pestaña Empleados ─────────────────────────────

test('13 - config empleados', async ({ page }) => {
  await mockHealth(page);
  await mockConfig(page);
  await go(page);
  await page.locator('button:has-text("Configuración")').click();
  await page.waitForSelector('[aria-label="Nombre del turno"]', { timeout: 10_000 });
  await page.locator('button[role="tab"]:has-text("Empleados")').click();
  await page.waitForSelector('[aria-label="Buscar empleado"]', { timeout: 5_000 });
  await page.waitForTimeout(300);
  await snap(page, '13-config-empleados.png');
});

// ── 14. Configuración: pestaña Feriados ──────────────────────────────

test('14 - config feriados', async ({ page }) => {
  await mockHealth(page);
  await mockConfig(page);
  await go(page);
  await page.locator('button:has-text("Configuración")').click();
  await page.waitForSelector('[aria-label="Nombre del turno"]', { timeout: 10_000 });
  await page.locator('button[role="tab"]:has-text("Feriados")').click();
  await page.waitForSelector('text=Agregar feriado', { timeout: 5_000 });
  await page.waitForTimeout(300);
  await snap(page, '14-config-feriados.png');
});

// ── 15. Configuración: pestaña General ───────────────────────────────

test('15 - config general', async ({ page }) => {
  await mockHealth(page);
  await mockConfig(page);
  await go(page);
  await page.locator('button:has-text("Configuración")').click();
  await page.waitForSelector('[aria-label="Nombre del turno"]', { timeout: 10_000 });
  await page.locator('button[role="tab"]:has-text("General")').click();
  await page.waitForSelector('text=Tiempo de descanso no deducible', { timeout: 5_000 });
  await page.waitForTimeout(300);
  await snap(page, '15-config-general.png');
});

// ── 16. Botón de ayuda ────────────────────────────────────────────────

test('16 - boton ayuda', async ({ page }) => {
  await mockHealth(page);
  await go(page);
  await page.waitForSelector('text=Seleccionar archivo');
  // Highlight the help button so it stands out in the screenshot
  await page.evaluate(() => {
    const helpBtn = Array.from(document.querySelectorAll('button'))
      .find(b => /ayuda/i.test(b.textContent ?? '') || b.getAttribute('aria-label')?.toLowerCase().includes('ayuda'));
    if (helpBtn) helpBtn.style.outline = '3px solid #e53e3e';
  });
  await page.waitForTimeout(200);
  await snap(page, '16-boton-ayuda.png');
});
