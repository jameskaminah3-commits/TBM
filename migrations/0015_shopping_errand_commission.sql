ALTER TABLE errands ALTER COLUMN shopping_commission_percent SET DEFAULT 5;

UPDATE errands
SET shopping_commission_percent = 5
WHERE shopping_enabled = true
  AND shopping_commission_percent = 10;
