# Clawfable Website Architecture v1

## Positioning
**Clawfable** is the practical operating manual for OpenClaw builders: setup guides, implementation playbooks, and production-ready templates/skills.

## Core Information Architecture

### 1) Home (`/`)
Purpose: explain promise fast + route users to highest-intent sections.

Sections:
- Hero: "Build OpenClaw agents that ship real work"
- 3 primary paths:
  - Learn OpenClaw (guides)
  - Deploy Use Cases (playbooks)
  - Get Templates/Skills (products)
- Featured guides (top 3)
- Featured use-case stacks (top 3)
- Proof strip (recent build logs/results)
- CTA: Start with OpenClaw Setup Guide

### 2) Guides Hub (`/guides`)
Purpose: rank for setup/implementation search intent.

Structure:
- Beginner setup
- Deployment (local, VPS, cloud)
- Integrations
- Troubleshooting
- Comparisons

Page template:
- who this is for
- prerequisites
- step-by-step
- failure modes + fixes
- next step links

### 3) Playbooks Hub (`/playbooks`)
Purpose: capture use-case intent.

Structure:
- Founder ops
- Content ops
- Sales/lead gen
- Community ops
- Support ops

Each playbook includes:
- architecture diagram
- required tools
- implementation steps
- expected outcomes
- downloadable assets

### 4) Templates Hub (`/templates`)
Purpose: productized execution assets.

Structure:
- prompt packs
- workflow templates
- SOP/checklists
- starter configs

Each template page:
- problem solved
- what’s included
- setup time
- ideal user
- sample output

### 5) Skills Hub (`/skills`)
Purpose: package and surface reusable OpenClaw skills.

Structure:
- free starter skills
- premium operator skills
- bundles

Each skill page:
- capability summary
- prerequisites
- install steps
- inputs/outputs
- changelog

### 6) Comparisons Hub (`/compare`)
Purpose: high-intent decision traffic.

Targets:
- openclaw vs n8n
- openclaw vs langgraph
- openclaw vs autopilot agents

Format:
- decision matrix
- best-for scenarios
- migration path

### 7) Build Logs (`/build-logs`)
Purpose: thought leadership + proof-of-work moat.

Content type:
- weekly operator logs
- what shipped / what broke / what changed
- hard numbers when possible

### 8) About (`/about`)
Purpose: credibility + editorial standards.

Include:
- mission
- writing principles (no fluff, no fake benchmarks)
- how content is tested

### 9) Start Here (`/start`)
Purpose: onboarding page for first-time visitors.

Flow:
- 10-minute orientation
- choose your path (founder, developer, operator)
- first 3 pages to read

---

## Navigation (Top-level)
- Start Here
- Guides
- Playbooks
- Templates
- Skills
- Compare
- Build Logs
- About

## URL + Slug Rules
- lowercase
- short descriptive slugs
- primary keyword in slug
- avoid date in slug unless news-like

Examples:
- `/guides/openclaw-setup-guide`
- `/playbooks/openclaw-for-content-ops`
- `/compare/openclaw-vs-n8n`

## Internal Linking Rules
Every page must link to:
1) one parent hub,
2) two related guides/playbooks,
3) one product page,
4) one start-here or onboarding page.

## Content Quality Rules
Publish only if page has:
- clear target audience
- concrete setup steps
- at least one original artifact (template/script/checklist)
- troubleshooting section
- explicit next action
