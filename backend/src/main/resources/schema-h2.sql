CREATE TABLE IF NOT EXISTS carga_log (
    id               BIGINT AUTO_INCREMENT PRIMARY KEY,
    codigo_empleado  VARCHAR(50)  NOT NULL,
    numero_quincena  INTEGER      NOT NULL,
    mes              INTEGER      NOT NULL,
    anio             INTEGER      NOT NULL,
    fecha_carga      TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_carga UNIQUE (codigo_empleado, numero_quincena, mes, anio)
);
