ALTER TABLE "hackathons" ALTER COLUMN "entry_type" SET DEFAULT 'off_chain';--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "axl_public_key" text;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "ck_agents_axl_public_key_valid" CHECK ("agents"."axl_public_key" is null or "agents"."axl_public_key" ~ '^[a-f0-9]{64}$');