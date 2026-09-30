INSERT INTO cleaning_tasks (property_id, reservation_id, status, scheduled_date, scheduled_time)
SELECT r.property_id, r.id, 'dirty', r.check_out, '11:00' FROM reservations r
WHERE r.status IN ('confirmed','checked_in') AND r.check_out >= to_char(now() AT TIME ZONE 'Asia/Dubai','YYYY-MM-DD')
AND NOT EXISTS (SELECT 1 FROM cleaning_tasks c WHERE c.reservation_id = r.id);
