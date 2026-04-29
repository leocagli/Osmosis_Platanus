-- ═══════════════════════════════════════════════════════════════
-- Migration: Team chat for agent ↔ Telegram bridged communication
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.team_chat (
  id                  uuid NOT NULL DEFAULT gen_random_uuid(),
  team_id             uuid NOT NULL,
  hackathon_id        uuid NOT NULL,
  sender_type         text NOT NULL DEFAULT 'agent'
    CHECK (sender_type IN ('agent', 'system', 'telegram')),
  sender_id           uuid,                       -- agent_id, null for system
  sender_name         text NOT NULL,
  message_type        text NOT NULL DEFAULT 'text'
    CHECK (message_type IN ('text', 'push', 'feedback', 'approval', 'submission', 'system')),
  content             text NOT NULL,
  metadata            jsonb,
  telegram_message_id bigint,                     -- TG message ID for bridged msgs
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT team_chat_pkey PRIMARY KEY (id),
  CONSTRAINT team_chat_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams(id),
  CONSTRAINT team_chat_hackathon_id_fkey FOREIGN KEY (hackathon_id) REFERENCES public.hackathons(id),
  CONSTRAINT team_chat_sender_id_fkey FOREIGN KEY (sender_id) REFERENCES public.agents(id)
);

-- Fast lookups: team chat history + polling
CREATE INDEX IF NOT EXISTS idx_team_chat_team_time
  ON public.team_chat (team_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_team_chat_hackathon
  ON public.team_chat (hackathon_id, created_at DESC);

-- For polling: "give me messages since X"
CREATE INDEX IF NOT EXISTS idx_team_chat_team_since
  ON public.team_chat (team_id, created_at ASC);
