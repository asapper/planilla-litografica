# Running Planilla Lito

Open two terminal tabs — one for each process.

## Backend (Spring Boot — port 49301)

```bash
cd backend
./mvnw spring-boot:run
```

Starts when you see: `Started PlanillaBackendApplication`

## Frontend (Vite — port 5173)

```bash
cd frontend
npm run dev
```

Open: http://localhost:5173

## Notes

- Backend uses a local H2 database at `~/.planilla/data/planilla-log` and connects to PostgreSQL at `192.168.0.20:5432` for stored procedure execution.
- Backend logs are written to `backend/logs/planilla.log`.
- A pre-built JAR is available at `binaries/planilla-backend-0.0.1-SNAPSHOT.jar` if you want to run without Maven: `java -jar binaries/planilla-backend-0.0.1-SNAPSHOT.jar`
