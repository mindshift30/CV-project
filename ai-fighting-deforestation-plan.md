# Plan: AI Fighting Deforestation — Web App

## Top-Level Overview

Build a fully self-contained, single-page web application called
**"AI Fighting Deforestation"** using plain HTML, CSS, and JavaScript.
The app educates users on how AI and satellite imagery protect forests.
It will be visually rich, mobile-friendly, and deployed automatically to
GitHub Pages via a GitHub Actions workflow.

No frameworks. No external image dependencies. All assets (SVGs,
generated visuals) are inlined or created programmatically with CSS/Canvas.

---

## File Structure

```
/index.html                        — Single-page application shell + all HTML sections
/style.css                         — All styling, animations, CSS variables, responsive layout
/script.js                         — All interactivity: slider, counters, scroll observer
/.github/workflows/deploy.yml      — GitHub Actions: deploy to GitHub Pages on push to main
/README.md                         — Setup instructions, feature list, screenshot placeholder
/ai-fighting-deforestation-plan.md — This plan file
```

---

## Sub-Tasks

---

### Sub-Task 1 — `style.css`: Design System & Global Styles

**Intent**
Establish the full visual design system first — CSS custom properties (colors,
fonts, spacing), resets, utility classes, and all component styles. Building
styles before HTML means the page looks correct the moment markup is added.

**Expected Outcomes**
- A complete `style.css` file with all styles for every section.
- Green/earth-tone palette defined as CSS variables.
- Mobile-first responsive breakpoints for all major layouts.
- CSS keyframe animations for: hero text fade-in, stat counter pulse, card
  hover effects, and the comparison slider handle.
- `.is-visible` class used by Intersection Observer for scroll-triggered reveals.

**Todo List**
1. Define CSS custom properties: `--green-dark`, `--green-mid`, `--green-light`,
   `--earth-brown`, `--off-white`, `--text-dark`, `--accent-gold`, font stack,
   and spacing scale.
2. Write CSS reset and base styles (box-sizing, body font, scroll-behavior).
3. Style the **navbar** — sticky, semi-transparent, logo + nav links.
4. Style the **hero section** — full-viewport-height, forest-green gradient
   background with a CSS-generated layered tree silhouette using clip-path/
   pseudo-elements, centered headline and tagline, animated entrance.
5. Style the **how-it-works section** — grid of 5 cards, each with an icon
   area (SVG inline), title, and description. Hover lift effect. Scroll-reveal
   transition.
6. Style the **comparison slider** — two-panel stacked layout with a draggable
   divider, handle circle, and before/after labels. Both panels are CSS
   gradient-painted "forest scenes".
7. Style the **stats counter section** — dark earth-tone background, 3-column
   flex/grid layout, large animated number display, label underneath.
8. Style the **call-to-action section** — full-width, deep green background,
   centered quote text, supporting paragraph.
9. Style the **footer** — dark background, three columns (About, Links, Contact),
   copyright line.
10. Write all `@media` queries for mobile (≤ 768 px) and tablet (≤ 1024 px).

**Relevant Context**
- No external fonts: use `system-ui, sans-serif` stack.
- All "images" are CSS gradients, `clip-path` shapes, or inline SVG — no `<img>`
  tags pointing to files.

**Status**
[ ] pending

---

### Sub-Task 2 — `index.html`: Page Structure & Content

**Intent**
Write the complete HTML document. Every section's markup must match exactly
what `style.css` targets. All inline SVG icons are placed here. Semantic HTML5
elements throughout.

**Expected Outcomes**
- A valid, well-structured `index.html` with all 6 sections plus nav and footer.
- Correct class names that match `style.css` selectors.
- All SVG icons for the "How It Works" cards embedded inline.
- The comparison slider's two panels marked up with correct overlay structure.
- `data-target` attributes on stat counters for `script.js` to read.
- `<link>` to `style.css` and `<script defer src="script.js">` in `<head>`.

**Todo List**
1. Write `<!DOCTYPE html>`, `<head>` with meta charset, viewport, title, and
   CSS/JS links.
2. Write sticky `<nav>` with logo text and anchor links to each section.
3. Write **hero section** (`<section id="hero">`):
   - `<h1>` with class for animation, text "AI Is Fighting Deforestation"
   - `<p>` tagline: "Satellite intelligence meets machine learning to protect
     Earth's last wild forests."
   - A scroll-down chevron anchor.
4. Write **how-it-works section** (`<section id="how-it-works">`):
   - Section heading "How AI Protects Forests"
   - 5 `.card` elements, each with inline SVG icon, `<h3>`, and `<p>`:
     a. Satellite Images + Object Detection
     b. Forest Monitoring / Change Detection
     c. Illegal Logging Detection
     d. Fire Detection
     e. Environmental Analysis / Biodiversity
5. Write **comparison slider section** (`<section id="comparison">`):
   - Section heading "Before & After: Deforestation in the Amazon"
   - Slider container with `.before-panel`, `.after-panel`, and `.slider-handle`.
   - Before/after label overlays.
6. Write **stats section** (`<section id="stats">`):
   - Section heading "The Numbers Don't Lie"
   - 3 `.stat-item` blocks, each with `<span class="counter"
     data-target="15000000000">0</span>` pattern and a label:
     a. 15 billion trees lost per year
     b. 40% faster detection with AI
     c. 90M+ hectares monitored
7. Write **CTA section** (`<section id="cta">`):
   - Large quote: "Technology is becoming Earth's guardian."
   - Supporting paragraph about the mission.
8. Write **footer** with three columns and copyright.

**Relevant Context**
- All `id` attributes on sections must match `href` anchors in the nav.
- SVG icons should use `currentColor` fill so CSS can tint them.

**Status**
[ ] pending

---

### Sub-Task 3 — `script.js`: Interactivity & Animations

**Intent**
Wire up all JavaScript behavior: the drag comparison slider, animated stat
counters triggered on scroll, smooth Intersection Observer reveals, and the
mobile nav toggle. No dependencies — pure vanilla JS.

**Expected Outcomes**
- Comparison slider responds to mouse drag and touch drag, clipping the
  after-panel correctly.
- Stat counters animate from 0 to their `data-target` value when scrolled
  into view (eased, ~2 s duration).
- All `.card` and `.stat-item` elements fade/slide in when they enter the
  viewport (Intersection Observer adds `.is-visible`).
- Mobile hamburger nav toggle works.

**Todo List**
1. **Intersection Observer** — observe all `.reveal` elements; add `.is-visible`
   when they cross 15% of the viewport.
2. **Comparison Slider**:
   - On `mousedown` / `touchstart` on `.slider-handle`, begin tracking.
   - On `mousemove` / `touchmove`, compute percentage across container width
     and apply `clip-path: inset(0 X% 0 0)` to `.after-panel`.
   - On `mouseup` / `touchend`, stop tracking.
3. **Stat Counters**:
   - Observe each `.counter` with a second Intersection Observer.
   - On first intersection, run `animateCounter(el, target, duration)` that
     uses `requestAnimationFrame` and an ease-out curve.
   - Format large numbers with `toLocaleString()`.
4. **Navbar scroll effect** — add `.scrolled` class to `<nav>` when
   `window.scrollY > 60` to trigger background opacity change.
5. **Mobile nav toggle** — hamburger button toggles `.nav-open` on `<nav>`.

**Relevant Context**
- `data-target` on `.counter` elements holds the raw integer target value.
- The "40%" stat should display as `40%` not `40` — handle the `%` suffix
  via a `data-suffix` attribute on that element.

**Status**
[ ] pending

---

### Sub-Task 4 — `.github/workflows/deploy.yml`: GitHub Actions Deployment

**Intent**
Create a GitHub Actions workflow that automatically builds and deploys the
static site to GitHub Pages on every push to the `main` branch.

**Expected Outcomes**
- A valid YAML workflow file at `.github/workflows/deploy.yml`.
- Triggers on `push` to `main`.
- Uses `actions/checkout@v3` to check out the repo.
- Uses `JamesIves/github-pages-deploy-action@v4` to deploy the root folder
  (`.`) to the `gh-pages` branch.
- No build step needed (static files, deploy-as-is).

**Todo List**
1. Define workflow name: `Deploy to GitHub Pages`.
2. Set trigger: `on: push: branches: [main]`.
3. Define single job `deploy` running on `ubuntu-latest`.
4. Step 1 — `actions/checkout@v3`.
5. Step 2 — `JamesIves/github-pages-deploy-action@v4` with:
   - `folder: .` (deploy everything from repo root)
   - `branch: gh-pages`
   - `clean: true`

**Relevant Context**
- The user must enable GitHub Pages in repo Settings → Pages → Source:
  `gh-pages` branch after first push.
- No secrets are required for public repos using this action.

**Status**
[ ] pending

---

### Sub-Task 5 — `README.md`: Documentation

**Intent**
Write clear setup and deployment instructions so anyone can fork and run
the project.

**Expected Outcomes**
- A well-formatted README with project title, description, feature list,
  live demo link placeholder, screenshot placeholder, setup instructions,
  and deployment notes.

**Todo List**
1. Project title + badge placeholder (GitHub Pages status).
2. One-paragraph description.
3. Feature list (6 bullets matching the 6 sections).
4. Screenshot placeholder: `![Screenshot](screenshot.png)` with note to
   replace after first deploy.
5. Local development instructions: "Clone the repo and open `index.html`
   in a browser — no build step required."
6. Deployment instructions: explain the GitHub Actions workflow and the
   one-time Pages settings step.
7. Tech stack section.
8. License line (MIT).

**Relevant Context**
- Live demo URL pattern: `https://<username>.github.io/<repo-name>/`

**Status**
[ ] pending

---

## Build Order

```
1. style.css       — design system first; everything else depends on class names
2. index.html      — markup that targets the already-defined CSS
3. script.js       — behavior layer, references DOM elements from index.html
4. deploy.yml      — infrastructure; independent of app code
5. README.md       — documentation; written last when full scope is known
```

---

## Design Decisions & Constraints

| Decision | Rationale |
|---|---|
| No external images | GitHub Pages serves static files; avoids CORS and broken assets |
| CSS gradients as "forest scenes" | Self-contained; no image hosting needed |
| `JamesIves/github-pages-deploy-action` | Simpler than `actions/deploy-pages`; works without Pages API permissions |
| System font stack | No Google Fonts request; faster load; no privacy concerns |
| Single HTML file | Simplest possible GitHub Pages setup; no routing needed |
| `data-target` + `data-suffix` on counters | Keeps animation logic generic and reusable |
