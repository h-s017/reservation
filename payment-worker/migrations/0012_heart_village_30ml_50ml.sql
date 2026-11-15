-- Heart Village capacity/price update. Never modify historical orders or slots.
-- course-01 previously sold single 10mL; its existing future seat inventory now serves 30mL.
UPDATE courses SET course='香氣探索｜30 mL',price=1350,unit='位',enabled=1
WHERE id='course-01' AND series='心村限定｜Helori 香氣探索所'
  AND course IN ('單人調香探索課 10ML','香氣探索｜30 mL');
-- Preserve each legacy order and reserved seat; block only future sales.
UPDATE courses SET enabled=0
WHERE id='course-02' AND series='心村限定｜Helori 香氣探索所';
-- Existing 50mL single seats serve the new headcount-based 50mL option.
UPDATE courses SET course='香氣探索｜50 mL',price=1800,unit='位',enabled=1
WHERE id='course-03' AND series='心村限定｜Helori 香氣探索所'
  AND course IN ('單人調香探索課 50ML','香氣探索｜50 mL');
UPDATE courses SET enabled=0
WHERE id='course-04' AND series='心村限定｜Helori 香氣探索所';
