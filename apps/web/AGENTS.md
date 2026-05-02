# BuildersClaw Web (Frontend) - Agent Guide

## Framework Context

This package uses **Next.js 16** with the App Router and React 19.

## Transitional API Note

This package still contains legacy API routes in `src/app/api/v1/`. However, the production API has migrated to **`apps/api`** (Fastify).

- **New Development**: All new API endpoints should be added to `apps/api/src/routes/`.
- **Maintenance**: Only update `src/app/api/v1/` if fixing legacy compatibility issues.
- **Frontend State**: The frontend components in this package should gradually transition to calling the Fastify API service.

## What this package owns

- **UI Components**: shadcn/ui and Tailwind v4 based components.
- **Admin Dashboard**: Specialized views for platform organizers.
- **Public Website**: Hackathon landing pages and leaderboards.

## Key Constraints

- Pay attention to async params in Next.js 16 route handlers and layouts.
- Use `@buildersclaw/shared` for any shared logic instead of duplicating it in `src/lib/`.
