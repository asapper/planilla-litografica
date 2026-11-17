CREATE TABLE IF NOT EXISTS carga_log (
    id               BIGINT AUTO_INCREMENT PRIMARY KEY,
    codigo_empleado  VARCHAR(50)  NOT NULL,
    numero_quincena  INTEGER      NOT NULL,
    mes              INTEGER      NOT NULL,
    anio             INTEGER      NOT NULL,
    fecha_carga      TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_carga UNIQUE (codigo_empleado, numero_quincena, mes, anio)
);

CREATE TABLE IF NOT EXISTS shift_config (
    id                       VARCHAR(36)   PRIMARY KEY,
    name                     VARCHAR(100)  NOT NULL,
    start_time               TIME          NOT NULL,
    end_time                 TIME          NOT NULL,
    cross_midnight           BOOLEAN       NOT NULL DEFAULT FALSE,
    detection_before_minutes INTEGER       NOT NULL DEFAULT 60,
    detection_after_minutes  INTEGER       NOT NULL DEFAULT 10,
    CONSTRAINT uq_shift_name UNIQUE (name)
);

CREATE TABLE IF NOT EXISTS employee_registry (
    employee_id     VARCHAR(50)   PRIMARY KEY,
    name            VARCHAR(255)  NOT NULL,
    shift_id        VARCHAR(36),
    active          BOOLEAN       NOT NULL DEFAULT TRUE,
    accrues_overtime BOOLEAN     NOT NULL DEFAULT TRUE,
    first_seen      TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_seen       TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_emp_shift FOREIGN KEY (shift_id) REFERENCES shift_config(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS holiday_cache (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    holiday_date    DATE          NOT NULL,
    name            VARCHAR(255)  NOT NULL,
    holiday_year    INTEGER       NOT NULL,
    source          VARCHAR(10)   NOT NULL DEFAULT 'API',
    CONSTRAINT uq_holiday UNIQUE (holiday_date, source)
);

CREATE TABLE IF NOT EXISTS app_config (
    config_key      VARCHAR(100)  PRIMARY KEY,
    config_value    VARCHAR(255)  NOT NULL
);

INSERT INTO app_config (config_key, config_value)
SELECT 'legalBreakAllowanceMinutes', '45'
WHERE NOT EXISTS (SELECT 1 FROM app_config WHERE config_key = 'legalBreakAllowanceMinutes');

CREATE TABLE IF NOT EXISTS tas_draft (
    id              INT PRIMARY KEY,
    upload_token    VARCHAR(64)  NOT NULL,
    schema_version  INT          NOT NULL,
    file_name       VARCHAR(255),
    tas_view        VARCHAR(32)  NOT NULL,
    state_revision  BIGINT       NOT NULL,
    partial_submit  BOOLEAN      NOT NULL DEFAULT FALSE,
    period_label    VARCHAR(64),
    saved_at        TIMESTAMP    NOT NULL,
    backend_state   CLOB         NOT NULL,
    ui_state        CLOB         NOT NULL
);
