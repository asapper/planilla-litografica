# URL: 192.168.0.20

# Port: 5432

# Username: see POSTGRES_DB_USERNAME in ~/.planilla/db.properties (or GitHub Secret)

# Password: see POSTGRES_DB_PASSWORD in ~/.planilla/db.properties (or GitHub Secret)

# Stored procedure name: carga_datos_empleados

# Parameters:

  Codigo Empleado: String,
  Días no laborados: integer,
  Horas extras simples: integer,
  Horas extras dobles: integer,
  Numero de quincena: integer,
  Mes: integer,
  Año: integer