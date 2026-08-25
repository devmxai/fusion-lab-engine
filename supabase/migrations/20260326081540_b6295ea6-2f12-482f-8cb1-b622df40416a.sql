ALTER TABLE public.model_cards DROP CONSTRAINT IF EXISTS model_cards_tool_id_key;
CREATE INDEX IF NOT EXISTS idx_model_cards_tool_id ON public.model_cards(tool_id);
CREATE INDEX IF NOT EXISTS idx_model_cards_section_order ON public.model_cards(display_section, sort_order);