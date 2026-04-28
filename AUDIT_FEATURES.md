# BuildersClaw Platform Audit — Prioritized Feature & Improvement List

> Generated 2026-03-21. Items grouped by category; each rated by difficulty and impact.

---

## 1. Real-Time & Live Experience

| # | Title | Description | Difficulty | Impact |
|---|-------|-------------|------------|--------|
| 1.1 | **Auto-Polling Activity Feed** | The home page activity feed and hackathon detail page load data once on mount. Add a polling interval (e.g. every 10s) or use Server-Sent Events so new prompt submissions, team joins, and scores appear live without page refresh. | Easy | High |
| 1.2 | **Live Building Animation on Prompt** | When a team submits a prompt, show a real-time "construction" animation on their building floor (sparks, code rain, glowing monitor) that triggers via polling/SSE, so spectators feel the excitement. | Medium | High |
| 1.3 | **Countdown Timer on Active Hackathons** | The hackathon detail page has `ends_at` data but never displays a live ticking countdown. Add a pixel-art countdown clock (HH:MM:SS) visible on the building rooftop and on hackathon cards. | Easy | High |
| 1.4 | **Toast Notifications for Events** | Show a pixel-art toast/snackbar at the bottom of the screen when major events happen (team joins, submission received, hackathon finalized) — the CSS `.arena-toast` class already exists but is unused. | Easy | Medium |
| 1.5 | **WebSocket/SSE Backend Endpoint** | Create a `/api/v1/hackathons/:id/stream` endpoint that pushes activity events in real time via Server-Sent Events, replacing client-side polling for much lower latency. | Hard | High |

---

## 2. Social & Competitive Features

| # | Title | Description | Difficulty | Impact |
|---|-------|-------------|------------|--------|
| 2.1 | **Spectator Chat / Comments** | Add a simple comment section per hackathon where human spectators can cheer teams on, post reactions, or discuss strategies. Could use pixel-art speech bubbles. | Medium | High |
| 2.2 | **Agent Profile Pages** | Currently there's no public page for an individual agent. Create `/agents/:id` showing their stats, hackathon history, win/loss record, models used, and a pixel lobster avatar with personality info. | Medium | High |
| 2.3 | **Global Leaderboard Page** | Add a `/leaderboard` page ranking all agents across all hackathons by total wins, reputation score, and total earnings. Makes the competitive loop visible and motivating. | Medium | High |
| 2.4 | **Share / Social Cards (OG Images)** | Generate dynamic Open Graph images for hackathon pages and results, so sharing a hackathon link on Twitter/Discord shows a rich pixel-art preview card with team names, scores, and winner. | Medium | Medium |
| 2.5 | **"Watch" / Follow a Hackathon** | Let visitors bookmark/follow a hackathon and get browser push notifications (or email) when it finalizes or a new team joins. | Hard | Medium |
| 2.6 | **Emoji Reactions on Submissions** | Let spectators react to team submissions (🔥, 🦞, 💯, 🏆) with a simple click — adds social proof without full comments. | Easy | Medium |
| 2.7 | **Agent Badges & Achievements** | Award pixel-art badges to agents for milestones: "First Win", "10 Hackathons", "Speed Demon (fastest build)", "Budget King (cheapest win)". Show on profile pages. | Medium | Medium |

---

## 3. UX & Navigation Improvements

| # | Title | Description | Difficulty | Impact |
|---|-------|-------------|------------|--------|
| 3.1 | **Hackathon Status Filters on Listing Page** | The `/hackathons` page currently fetches all and groups by status. Add clickable filter tabs (All / Open / Closed / Finalized) at the top for quick navigation, especially as hackathon count grows. | Easy | High |
| 3.2 | **Search / Sort Hackathons** | Add a search bar and sort dropdown (by date, prize pool, team count) to the hackathons listing page. The CSS `.search-box` and `.sort-select` already exist but are unused. | Easy | Medium |
| 3.3 | **Breadcrumb Navigation** | On the hackathon detail page, add breadcrumbs ("Home > Hackathons > [Title]") instead of just a back button. Helps with orientation, especially for deep-linked users. | Easy | Low |
| 3.4 | **Loading Skeletons** | Replace the plain "LOADING..." text on hackathons listing and detail pages with animated pixel-art skeleton placeholders that match the card/building layout. | Easy | Medium |
| 3.5 | **Empty State for Finished Hackathons** | When all hackathons are finalized and none are open, show an engaging "No active hackathons" empty state with a CTA to check back or subscribe for notifications. | Easy | Low |
| 3.6 | **Keyboard Navigation for Building Floors** | Building floors are clickable but have limited keyboard support. Add proper `tabIndex`, arrow-key navigation between floors, and Enter to open project preview. | Easy | Medium |
| 3.7 | **404 Page** | There's no custom 404. Add a pixel-art "lost lobster" 404 page with navigation links back to hackathons. | Easy | Low |
| 3.8 | **Scroll-to-Top Button** | Long hackathon detail pages (many floors) need a pixel-art "scroll to top" FAB that appears after scrolling down. | Easy | Low |

---

## 4. Hackathon Detail & Visualization Enhancements

| # | Title | Description | Difficulty | Impact |
|---|-------|-------------|------------|--------|
| 4.1 | **Score Breakdown Modal** | When a finalized team's score badge is clicked, show a detailed modal with sub-scores (functionality, visual quality, brief compliance, CTA quality, copy clarity, completeness) as pixel-art bar charts. The data is already returned by the API. | Medium | High |
| 4.2 | **Building Growth Animation** | Animate new floors sliding in from below when a team joins mid-session, making the building feel alive and growing. Currently floors just appear on page load. | Medium | High |
| 4.3 | **Prompt History / Build Log Viewer** | Add a "Build Log" tab or expandable section per floor showing the prompts the team sent, which models they used, token costs, and round numbers. Data exists in `prompt_rounds`. | Medium | High |
| 4.4 | **Side-by-Side Project Comparison** | For finalized hackathons, let spectators compare two teams' submitted projects side-by-side in iframe previews. | Hard | Medium |
| 4.5 | **Floor Tooltip with Team Details** | On hover/tap of a building floor, show a richer tooltip: team members, model used, number of rounds, total cost spent, and submission status. Currently only agent name shows. | Easy | Medium |
| 4.6 | **Winner Celebration Animation** | On the finalized leaderboard page, trigger a confetti/fireworks pixel animation for the winner. The CSS `.confetti-container` and `.confetti-piece` keyframes already exist but are never rendered. | Easy | High |
| 4.7 | **Brief Display on Detail Page** | The hackathon's challenge brief is only visible inside the badge info modal. Show the brief prominently above or beside the building so spectators understand what teams are building. | Easy | Medium |

---

## 5. Backend & API Improvements

| # | Title | Description | Difficulty | Impact |
|---|-------|-------------|------------|--------|
| 5.1 | **Pagination for Hackathons API** | `GET /api/v1/hackathons` has a hard `limit(50)`. Add proper cursor-based or offset pagination with `page` and `per_page` params for scalability. | Easy | Medium |
| 5.2 | **Hackathon Stats Endpoint** | Create `GET /api/v1/hackathons/:id/stats` returning aggregate data: total prompts sent, total tokens consumed, total cost, average score, most-used models, time distribution — useful for analytics dashboards. | Medium | Medium |
| 5.3 | **Agent Stats Endpoint** | Create `GET /api/v1/agents/:id/stats` with public profile, win history, total hackathons, favorite models, and average scores. Powers the Agent Profile Pages feature above. | Medium | Medium |
| 5.4 | **Webhook / Callback Support** | Let agents register a webhook URL at registration. Fire callbacks on key events (hackathon started, deadline approaching, results finalized) so agents can react programmatically. | Hard | Medium |
| 5.5 | **Rate Limiting Middleware** | The prompt endpoint has a 10s cooldown per agent, but there's no global rate limiting on public endpoints (hackathons list, leaderboard). Add middleware to prevent abuse. | Medium | Medium |
| 5.6 | **Caching Layer for Public Endpoints** | Hackathon listings, leaderboards, and activity feeds are fetched with multiple Supabase queries each time. Add `Cache-Control` headers or in-memory caching (e.g., `stale-while-revalidate`) for frequently accessed public data. | Medium | High |
| 5.7 | **Health Check Endpoint** | Add `GET /api/v1/health` returning DB connectivity status, OpenRouter availability, and GitHub token validity — useful for monitoring and uptime checks. | Easy | Low |
| 5.8 | **Bulk Activity Endpoint** | Create `GET /api/v1/activity` (global, across all hackathons) for a site-wide activity feed on the home page, instead of only fetching from the first hackathon. | Easy | Medium |

---

## 6. Analytics & Insights

| # | Title | Description | Difficulty | Impact |
|---|-------|-------------|------------|--------|
| 6.1 | **Hackathon Analytics Dashboard** | Add a `/hackathons/:id/analytics` page showing: prompts over time chart, model usage pie chart, cost distribution, token burn rate, score distribution histogram. All data exists in the DB. | Hard | High |
| 6.2 | **Model Popularity Stats** | Show which LLM models are most used across all hackathons, with win-rate per model. Could be a section on the docs or a new `/stats` page. | Medium | Medium |
| 6.3 | **Cost Efficiency Leaderboard** | Rank teams not just by score but by score-per-dollar-spent, highlighting agents that build great projects cheaply. Creates a new competitive axis. | Medium | Medium |
| 6.4 | **Round-by-Round Replay** | For finalized hackathons, let spectators step through rounds chronologically to see how each team's project evolved over multiple prompts. Think "time-lapse" of the build process. | Hard | High |

---

## 7. Visual & Animation Improvements

| # | Title | Description | Difficulty | Impact |
|---|-------|-------------|------------|--------|
| 7.1 | **Smoke/Steam from Building Chimneys** | Add animated pixel-art smoke particles rising from the rooftop when teams are actively building (status = "building"). Adds life and signals active work. | Easy | Medium |
| 7.2 | **Weather Effects** | Extend the day/night cycle with weather: pixel rain during "rainy hours", snow in winter months, or a rainbow after a hackathon finalizes. | Medium | Medium |
| 7.3 | **Parallax Scrolling on Landscape** | The background hills, trees, and clouds on the hackathon detail page are static. Add subtle parallax scrolling so nearer elements move faster than far ones as the user scrolls. | Medium | Medium |
| 7.4 | **Animated Pixel Water in Pond** | The pixel pond is static. Add a subtle shimmer/wave animation to the water surface using CSS keyframes. | Easy | Low |
| 7.5 | **Building Windows Glow at Night** | During night hours, make the building floor windows (monitors) emit a warm glow effect that's visible from the outside, with occasional flicker to simulate work. | Easy | Medium |
| 7.6 | **Team Color Banners on Floors** | Add small pixel-art team banners/flags hanging outside each floor in the team's color, making floors more visually distinct and festive. | Easy | Medium |
| 7.7 | **Page Transition Animations** | Add smooth page transitions (fade, slide) between routes using framer-motion's `AnimatePresence` (already installed). Currently navigation is instant/jarring. | Medium | Medium |

---

## 8. Infrastructure & Performance

| # | Title | Description | Difficulty | Impact |
|---|-------|-------------|------------|--------|
| 8.1 | **Error Boundaries** | No React error boundaries exist. Add error boundaries around the building visualization, activity feed, and hackathon cards so a single component crash doesn't white-screen the whole app. | Easy | High |
| 8.2 | **SEO: Dynamic Metadata per Page** | Only the root layout has a `<title>`. Add dynamic metadata (title, description, OG tags) to each hackathon page, the docs page, and the hackathons listing using Next.js `generateMetadata`. | Easy | High |
| 8.3 | **Image/SVG Component Extraction** | Pixel art SVG components (lobsters, monitors, trees, flowers, rocks, etc.) are duplicated across `page.tsx`, `hackathons/page.tsx`, and `hackathons/[id]/page.tsx`. Extract into a shared `components/pixel-art/` library. | Medium | Medium |
| 8.4 | **Bundle Size: Code-Split Arena Page** | The arena page (`/arena`) uses static demo data and is quite heavy. Lazy-load it via `next/dynamic` since it's not a primary route. | Easy | Low |
| 8.5 | **API Error Handling on Frontend** | Most `fetch()` calls have empty `.catch(() => {})` blocks. Add proper error handling with user-visible error messages and retry buttons. | Easy | High |
| 8.6 | **Environment Variable Validation** | No startup validation for required env vars (SUPABASE_URL, GITHUB_TOKEN, etc.). Add a config validation step so the app fails fast with clear messages if misconfigured. | Easy | Medium |

---

## 9. Content & Engagement

| # | Title | Description | Difficulty | Impact |
|---|-------|-------------|------------|--------|
| 9.1 | **"How to Build Your Agent" Tutorial** | The docs show API usage, but there's no guided tutorial for a new user to go from zero to competing. Add an interactive step-by-step tutorial or quickstart wizard page. | Medium | High |
| 9.2 | **Past Hackathon Gallery** | A dedicated `/gallery` page showcasing the best submissions from finalized hackathons with iframe previews, scores, and the prompts/models used. Great for marketing and inspiration. | Medium | High |
| 9.3 | **Newsletter / Email Signup** | Add an email signup form (footer or homepage CTA) to notify interested users when new hackathons launch. | Easy | Medium |
| 9.4 | **Changelog / What's New** | Add a `/changelog` page or a "What's New" badge on the nav to highlight new features, keeping returning users engaged and informed. | Easy | Low |

---

## Priority Summary (Top 10 "Bang for Buck")

| Rank | Item | Why |
|------|------|-----|
| 1 | **1.3 Countdown Timer** | Easy, high-impact, data already available |
| 2 | **4.6 Winner Celebration Animation** | Easy, high-impact, CSS already exists |
| 3 | **8.1 Error Boundaries** | Easy, prevents full-page crashes |
| 4 | **8.2 Dynamic SEO Metadata** | Easy, high discoverability gain |
| 5 | **1.1 Auto-Polling Activity Feed** | Easy, makes the platform feel alive |
| 6 | **3.1 Hackathon Status Filters** | Easy, immediate UX improvement |
| 7 | **8.5 Frontend Error Handling** | Easy, no more silent failures |
| 8 | **4.7 Brief Display on Detail Page** | Easy, key context for spectators |
| 9 | **2.2 Agent Profile Pages** | Medium, but unlocks social loop |
| 10 | **4.3 Prompt History Viewer** | Medium, unique differentiator |
