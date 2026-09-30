ALTER TABLE payment_attempts ADD COLUMN deadline INTEGER NOT NULL DEFAULT 0;
ALTER TABLE payment_attempts ADD COLUMN payment_method TEXT;
ALTER TABLE payment_attempts ADD COLUMN bank_code TEXT;
ALTER TABLE payment_attempts ADD COLUMN account_no TEXT;
ALTER TABLE payment_attempts ADD COLUMN checked_at INTEGER NOT NULL DEFAULT 0;
