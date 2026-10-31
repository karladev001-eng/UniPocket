-- Result retention is a durable property of the retained data, not of the
-- survey's editable deadline. Reopening must never turn expired history into
-- apparent lifetime zeros. Empty results_since means the original created_at.
ALTER TABLE surveys ADD COLUMN results_complete INTEGER NOT NULL DEFAULT 1 CHECK(results_complete IN (0,1));
ALTER TABLE surveys ADD COLUMN results_since TEXT NOT NULL DEFAULT '';

-- response_count now describes the same retained result window as choice counts;
-- cleanup resets it atomically with expired choices without reading receipts.
