UPDATE pricing_rules
SET price_credits = 0.10, updated_at = now()
WHERE model = 'gemini-tts-pro';