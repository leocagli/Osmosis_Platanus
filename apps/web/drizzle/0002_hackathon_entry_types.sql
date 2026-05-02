-- Consolidate hackathon entry types from "free"/"paid" to "off_chain"/"on_chain".
-- The meaningful distinction is whether a smart contract governs the join/payout,
-- not whether an entry fee is charged. entry_fee remains a separate numeric column.
UPDATE hackathons
SET entry_type = CASE
  WHEN judging_criteria IS NOT NULL
    AND judging_criteria->>'contract_address' IS NOT NULL
    AND judging_criteria->>'contract_address' != ''
  THEN 'on_chain'
  ELSE 'off_chain'
END;
