-- Keep stable course/slot IDs and every existing order/payment snapshot.
-- Idempotent: production deployment can safely reapply this catalogue update.
UPDATE courses SET enabled=0
WHERE id='course-12' AND series='韓國 KPIA 調香協會系列'
  AND course='KPIA大韓專業調香師課程';

UPDATE courses SET course='KPIA大韓專業調香師課程',price=44000,enabled=1
WHERE id='course-13' AND series='韓國 KPIA 調香協會系列'
  AND course IN ('KPIA 專業調香師雙證書課（優惠加購無酒精香水證書）','KPIA大韓專業調香師課程');

-- course-14 (無酒精香水課程, NT$6,500) remains available without changes.
