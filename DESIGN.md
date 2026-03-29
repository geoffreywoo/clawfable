# Design System — Clawfable

## Product Context
- **What this is:** Multi-agent Twitter bot operations platform with AI-driven personality profiles
- **Who it's for:** People managing multiple Twitter/X bot personas (brand accounts, thought leadership, niche topic bots)
- **Space/industry:** Social media automation, AI content generation
- **Project type:** Web app (dashboard + wizard modal)

## Aesthetic Direction
- **Direction:** Industrial Terminal / Retro-Futuristic
- **Decoration level:** Minimal — typography and spacing do the work. No gradients, blobs, or decorative elements. Borders are rgba white at low opacity.
- **Mood:** Mission control for your Twitter agents. Dense, data-rich, function-first. Feels like you're operating something powerful, not using a consumer app.
- **Reference sites:** Terminal-style dashboards, dev tool UIs (Linear, Vercel)

## Typography
- **Display/Hero:** Space Grotesk 600-700 — geometric, technical, distinctive. Not a default.
- **Body:** Inter 400-500 — readable, workmanlike, disappears into the content
- **UI/Labels:** JetBrains Mono 600 — monospace for the terminal identity. 10px, uppercase, letter-spacing 0.1em
- **Data/Tables:** JetBrains Mono 400-500 — supports tabular-nums natively
- **Code:** JetBrains Mono 400
- **Loading:** Google Fonts CDN: `Space+Grotesk:wght@400;500;600;700&Inter:wght@400;500;600&JetBrains+Mono:wght@400;500;600;700`
- **Scale:**
  - h1: 36px / Space Grotesk 700 / line-height 1.1
  - h2: 22px / Space Grotesk 600 / line-height 1.2
  - h3: 16px / Space Grotesk 600 / line-height 1.3
  - body: 14px / Inter 400 / line-height 1.6
  - small: 13px / Inter 400 / line-height 1.5
  - label: 10px / JetBrains Mono 600 / letter-spacing 0.1em / uppercase

## Color
- **Approach:** Restrained (1 accent + neutrals, color is rare and meaningful)
- **Background:** #0a0a0a (--bg)
- **Surfaces:** #141414 (--surface), #1a1a1a (--surface-2), #111111 (--surface-3)
- **Borders:** rgba(255,255,255,0.08) default, rgba(255,255,255,0.14) hover
- **Text:** #e5e5e5 (primary), #737373 (muted), #525252 (dim)
- **Primary accent:** #8b5cf6 (violet), #7c3aed (hover)
- **Primary dim:** rgba(139,92,246,0.15) background, rgba(139,92,246,0.3) border
- **Semantic:**
  - Success: #22c55e / dim rgba(34,197,94,0.15) / border rgba(34,197,94,0.3)
  - Error: #ef4444 / dim rgba(239,68,68,0.15) / border rgba(239,68,68,0.3)
  - Warning: #f59e0b / dim rgba(245,158,11,0.15) / border rgba(245,158,11,0.3)
  - Info: #3b82f6 / dim rgba(59,130,246,0.15) / border rgba(59,130,246,0.3)
- **Dark mode:** This IS dark mode. No light mode. Single theme.

## Spacing
- **Base unit:** 4px
- **Density:** Comfortable-to-compact (data-dense where needed, breathing room in wizards)
- **Scale:**
  - 2xs: 2px
  - xs: 4px
  - sm: 8px
  - md: 16px
  - lg: 24px
  - xl: 32px
  - 2xl: 48px
  - 3xl: 64px

## Layout
- **Approach:** Grid-disciplined
- **Wizard modals:** max-width 520px, full-screen on mobile (<520px viewport)
- **Dashboard:** Tab-based SPA with top navigation
- **Max content width:** 960px for main content areas
- **Border radius:**
  - sm: 6px (--radius) — inputs, buttons, tags, cards
  - lg: 10px (--radius-lg) — modals, dashboard containers
  - full: 9999px — pills, avatar circles

## Motion
- **Approach:** Minimal-functional with one signature moment
- **Easing:** ease-out for enter, ease-in for exit, ease-in-out for movement
- **Duration:** micro 50-100ms (hover), short 150ms (transitions), medium 300ms (reveals)
- **Signature:** Staggered fade-in for tweet preview cards (300ms apart, translateY 8px to 0)
- **Launch confirmation:** Scale-up with green checkmark, 2s display, auto-redirect

## Component Patterns
- **Tags/Chips:** `.wizard-tag` pattern — mono 10px, uppercase, pill border, --border outline. Selected state: --primary-dim background + --primary-border.
- **Tweet cards:** No card border or shadow. Bottom divider only (--border). Content in Inter 14px. Format label in mono 10px dim. Thumbs buttons: 28px square, --border outline, semantic colors on state.
- **Alerts:** Semantic dim background + matching text color + matching border. 13px Inter.
- **Buttons:** Mono 11px, uppercase, letter-spacing 0.05em. Primary: --primary bg. Outline: transparent bg + --border. Ghost: no border. Danger: --red-dim bg.
- **Form inputs:** --surface bg, --border outline, Inter 14px. Focus: --primary-border.
- **Skeleton loaders:** Pulsing gray rectangles matching the shape of the content being loaded. Use for tweet preview generation.
- **Progress bars (wizard):** Horizontal step indicators with numbered circles. Done: --primary filled. Current: --primary outline. Future: --text-dim outline.

## Interaction States
- **Loading:** Skeleton loaders for content, spinner for processing (reuse .wizard-spinner)
- **Empty:** Warm copy with primary action. Never just "No items found."
- **Error:** Red alert with clear message + retry action. Never silent failures.
- **Disabled:** 50% opacity, cursor: not-allowed
- **Hover:** Border lightens to --border-hover, text brightens to --text

## Responsive
- **Breakpoint:** 520px (wizard modal goes full-screen below this)
- **Mobile tweet preview:** Horizontal swipe carousel with scroll-snap, "2 of 5" counter
- **Mobile dashboard stats:** 2-column grid instead of 4-column
- **Touch targets:** Minimum 44px for all interactive elements

## Accessibility
- **Focus:** 2px violet outline on :focus-visible for all interactive elements
- **Keyboard:** Escape closes modals, Tab follows visual order
- **ARIA:** radiogroup + radio for archetype selector, checkbox for topic tags
- **Contrast:** All text/background combinations meet WCAG AA (light text on dark surfaces)
- **Screen readers:** All interactive elements have aria-label attributes

## Decisions Log
| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-03-29 | Initial design system created | Codified from existing globals.css + activation funnel design review |
| 2026-03-29 | Added warning (#f59e0b) and info (#3b82f6) semantic colors | Missing from original CSS, needed for wizard state coverage |
| 2026-03-29 | 4px spacing scale with CSS variables | Standardizes inline pixel values across codebase |
| 2026-03-29 | Staggered tweet reveal as signature motion | Design review: aha moment needs to feel like a reveal, not a list |
| 2026-03-29 | Mobile carousel for tweet preview | Design review: one-card-at-a-time focuses attention per tweet on small screens |
| 2026-03-29 | Reuse .wizard-tag for archetype + topic selectors | Existing pattern in analysis results, add selected state with ~5 lines CSS |
