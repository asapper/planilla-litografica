MERGE INTO shift_config (id, name, start_time, end_time, cross_midnight)
KEY(id)
VALUES ('manana', 'Mañana', '07:00', '15:00', FALSE);

MERGE INTO shift_config (id, name, start_time, end_time, cross_midnight)
KEY(id)
VALUES ('tarde', 'Tarde', '15:00', '23:00', FALSE);

MERGE INTO shift_config (id, name, start_time, end_time, cross_midnight)
KEY(id)
VALUES ('noche', 'Noche', '19:00', '07:00', TRUE);
