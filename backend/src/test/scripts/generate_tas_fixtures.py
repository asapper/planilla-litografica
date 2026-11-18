"""Generates the synthetic TAS clock exports in src/test/resources/fixtures. No real scans.

Run from backend/:  python3 src/test/scripts/generate_tas_fixtures.py src/test/resources/fixtures
Seeded, so the output is identical on every run; tests assert its exact counts.
"""
import random, sys
from datetime import date, datetime, timedelta
FIRST = "Ana Luis Maria Carlos Elena Jorge Sofia Pedro Rosa Diego Laura Oscar Paula Hugo Clara Ivan Lucia Felix Marta Raul Sara Tomas Irma Abel Nora Rene Dora Julio Elsa Marco".split()
LAST = "Garcia Lopez Martinez Hernandez Gonzalez Rodriguez Perez Sanchez Ramirez Torres Flores Rivera Gomez Diaz Cruz Moreno Reyes Jimenez Ruiz Alvarez".split()
EVENT = "1:N Autenticación exitosa (Rostro)"
def employees(n, rng):
    out = []
    for i in range(1, n + 1):
        out.append((str(i), f"{LAST[(i-1) % len(LAST)]} {FIRST[((i-1) + 7*((i-1)//len(LAST))) % len(FIRST)]}", rng.choice(["day", "day", "night", "office"])))
    return out
def scans_for(emp, start, end, rng):
    eid, name, kind = emp
    out = []
    d = start
    while d <= end:
        works = (d.weekday() < 5) if kind == "office" else ((d - start).days % 4 in (0, 1))
        if works and rng.random() > 0.05:
            h_in, h_out, overnight = {"day": (7, 19, False), "night": (19, 7, True), "office": (8, 17, False)}[kind]
            t_in = datetime(d.year, d.month, d.day, h_in) + timedelta(minutes=rng.randint(-20, 15))
            od = d + timedelta(days=1) if overnight else d
            t_out = datetime(od.year, od.month, od.day, h_out) + timedelta(minutes=rng.randint(-10, 45))
            r = rng.random()
            if r < 0.03: out.append(t_in)
            elif r < 0.06: out.append(t_out)
            else:
                out += [t_in, t_out]
                if rng.random() < 0.03: out.append(t_in + timedelta(minutes=1))  # a second scan a minute later
        d += timedelta(days=1)
    return [(t, name, eid) for t in out if start <= t.date() <= end]
def write(path, rows):
    rows.sort(key=lambda r: (r[0], r[2]), reverse=True)
    with open(path, "w", encoding="utf-8", newline="") as f:
        f.write('"No.","Fecha y hora","Evento","Nombre de usuario","ID de usuario"\r\n')
        for i, (t, name, eid) in enumerate(rows, 1):
            f.write(f'"{i}","{t:%Y/%m/%d %H:%M}","{EVENT}","{name}","{eid}"\r\n')
def multi(path, n, start, end, seed):
    rng = random.Random(seed)
    rows = []
    for e in employees(n, rng): rows += scans_for(e, start, end, rng)
    write(path, rows)
d = sys.argv[1]
multi(f"{d}/multi-employee-march.csv", 60, date(2026,3,1), date(2026,3,31), 1)
multi(f"{d}/multi-employee-march-april.csv", 62, date(2026,3,1), date(2026,4,30), 2)
rng = random.Random(3); rows = []
for day in range(16, 30):
    base = datetime(2026, 4, day)
    rows += [(base + timedelta(hours=8, minutes=rng.randint(40, 59)), "Garcia Ana", "1"),
             (base + timedelta(hours=19, minutes=rng.randint(0, 25)), "Garcia Ana", "1")]
write(f"{d}/single-employee-report.csv", rows)
