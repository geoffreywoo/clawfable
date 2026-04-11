# Design System — Clawfable

## Product Context
- **What this is:** A voice-training and automation product for X, where each agent learns from approvals, edits, deletes, and performance over time.
- **Who it's for:** Creators, founders, operators, and small teams who want help publishing consistently without losing their voice.
- **Space/industry:** Creator software, social publishing, AI copilots.
- **Project type:** Public marketing site plus authenticated control room.

## Aesthetic Direction
- **Direction:** Bright creator workspace.
- **Inspiration:** Buffer's warmth and clarity, without copying its layout. Clawfable should feel helpful, optimistic, and safe to try.
- **Decoration level:** Light but intentional. Soft color washes, rounded cards, gentle contrast shifts, and a few supportive accent surfaces are welcome.
- **Mood:** Friendly publishing teammate, not command-line infrastructure. The product should feel clear enough for a new user and trustworthy enough for an operator.
- **Reference traits:** generous whitespace, soft off-white backgrounds, clean card groupings, approachable copy, visible hierarchy, and upbeat accent color.

## Typography
- **Display/Hero:** Outfit 600-700, rounded and modern without feeling corporate.
- **Body:** Manrope 400-600, readable and friendly.
- **UI/Labels:** IBM Plex Mono 500-600, used sparingly for tags, data points, and compact control labels.
- **Data/Tables:** IBM Plex Mono 400-500.
- **Code:** IBM Plex Mono 400.
- **Loading:** `next/font`, self-hosted through Next.js.
- **Scale:**
  - h1: 56px / Outfit 700 / line-height 1.02
  - h2: 34px / Outfit 650 / line-height 1.08
  - h3: 22px / Outfit 650 / line-height 1.18
  - body-lg: 18px / Manrope 500 / line-height 1.65
  - body: 15px / Manrope 400 / line-height 1.7
  - small: 13px / Manrope 500 / line-height 1.6
  - label: 11px / IBM Plex Mono 600 / letter-spacing 0.08em

## Color
- **Approach:** Warm neutral foundation with one confident green primary and a few soft accent washes.
- **Background:** `#f6f1e7` (`--bg`)
- **Surface:** `#fffdf8` (`--surface`)
- **Surface 2:** `#f3ebdf` (`--surface-2`)
- **Surface 3:** `#fbf6ee` (`--surface-3`)
- **Elevated surface:** `#ffffff`
- **Border:** `rgba(70, 54, 38, 0.12)` default, `rgba(70, 54, 38, 0.22)` hover
- **Text:** `#213128` primary, `#5e6d63` muted, `#8b988f` dim
- **Primary:** `#4a8b67`
- **Primary hover:** `#3d7556`
- **Primary soft:** `rgba(74, 139, 103, 0.12)`
- **Primary border:** `rgba(74, 139, 103, 0.28)`
- **Accent wash 1:** warm peach `#ffe4d4`
- **Accent wash 2:** pale blue `#dcecff`
- **Accent wash 3:** butter `#f8e7b2`
- **Semantic:**
  - Success: `#2f9a5f`
  - Error: `#d65c5c`
  - Warning: `#c78528`
  - Info: `#4f84c4`
- **Theme:** Light by default. No dark-first styling decisions on public pages.

## Spacing
- **Base unit:** 4px
- **Density:** Airy on marketing surfaces, comfortable in-product.
- **Scale:**
  - 2xs: 4px
  - xs: 8px
  - sm: 12px
  - md: 16px
  - lg: 24px
  - xl: 32px
  - 2xl: 48px
  - 3xl: 72px

## Layout
- **Approach:** Spacious, readable, and section-led.
- **Marketing width:** 1180-1240px content width.
- **Control-room width:** 1200px content width with compact operational cards.
- **Hero pattern:** one strong promise, one short proof paragraph, one primary CTA, one secondary visual frame.
- **Cards:** rounded, bright, layered with soft borders and subtle shadows.
- **Border radius:**
  - sm: 10px
  - md: 16px
  - lg: 24px
  - pill: 9999px

## Motion
- **Approach:** Gentle and supportive.
- **Durations:** 120ms hover, 180ms standard, 280ms reveal.
- **Movement:** small lifts, fade-ins, and slight scale on emphasis.
- **Rule:** motion should make the interface feel alive, never busy.

## Component Patterns
- **Buttons:** rounded, generous height, sentence-case copy when possible. Primary buttons should feel warm and inviting. Outline buttons should use soft fills on hover, not harsh inverted states.
- **Hero cards:** use soft tinted backgrounds and supportive microcopy instead of dense operational jargon.
- **Metric cards:** large readable numbers, calm supporting labels, and visible context. Avoid terminal-style uppercase overload.
- **Tags/Chips:** pill shapes with soft fills, mono labels only when they add clarity.
- **Pricing cards:** bright cards with one featured plan and gentle accent backgrounds.
- **Souls cards:** should feel browsable and creative, like templates or examples, not logs.
- **Control-room cards:** still structured and operational, but visually related to the public site.

## Interaction States
- **Loading:** light skeletons or low-contrast placeholders that match the final surface.
- **Empty:** encouraging copy with a clear next action.
- **Error:** visible, warm, and actionable. Use plain language.
- **Hover:** subtle lift, brighter border, slightly warmer surface.
- **Disabled:** lower contrast, no fake interactivity.

## Responsive
- **Primary breakpoint:** 900px for major marketing layout shifts.
- **Mobile behavior:** stack sections cleanly, keep CTAs visible, do not collapse into dense dashboard-like blocks.
- **Touch targets:** minimum 44px.

## Accessibility
- **Focus:** 2px solid green outline with offset.
- **Contrast:** preserve AA contrast on all copy, especially muted text on warm backgrounds.
- **Copy:** prefer short, concrete sentences and clear action labels.
- **Structure:** marketing sections should scan in seconds.

## Voice For UI Copy
- Warm, plainspoken, and confidence-building.
- Prefer "train your voice", "review the first batch", "turn on autopilot when it feels right".
- Avoid "protocol", "mission control", and internal system jargon on public pages unless the product context truly requires it.
- In-product copy can be slightly more operational, but should still sound like a teammate, not a terminal.

## Decisions Log
| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-04-11 | Switched from industrial terminal aesthetic to bright creator workspace | Product moved from "AI infra toy" toward a friendlier creator tool and paid SaaS |
| 2026-04-11 | Chose Outfit + Manrope + IBM Plex Mono | Needed a warmer, more approachable type system while keeping data legible |
| 2026-04-11 | Adopted warm off-white canvas and green primary | Makes the product feel safer, brighter, and less techy |
