# 🌳 AI Fighting Deforestation

> An interactive, educational single-page web application demonstrating how
> artificial intelligence and satellite imagery are used to monitor, detect,
> and protect Earth's remaining forests.

![GitHub Pages](https://img.shields.io/badge/Deployed%20on-GitHub%20Pages-2d6a4f?style=flat-square&logo=github)
![HTML CSS JS](https://img.shields.io/badge/Tech-HTML%20%7C%20CSS%20%7C%20JS-52b788?style=flat-square)

---

## Live Demo

```
https://<your-github-username>.github.io/<your-repo-name>/
```

Replace the placeholders with your GitHub username and repository name after
your first deployment.

---

## Screenshot

![Screenshot](screenshot.png)

> _Replace `screenshot.png` with an actual screenshot after your first deploy._

---

## Features

- **Hero Section** — Animated headline with layered CSS tree-silhouette forest
  background and entrance animations.
- **How It Works** — Five interactive cards covering:
  - Satellite Images & Object Detection
  - Forest Monitoring & Change Detection
  - Illegal Logging Detection
  - Fire Detection & Heat Signatures
  - Environmental Analysis & Biodiversity Tracking
- **Comparison Slider** — Drag-to-compare "before deforestation / after
  deforestation" interactive slider with full touch and keyboard support.
- **Stats Counter** — Animated counters that count up when scrolled into view:
  15 billion trees lost per year, 40% faster AI detection, 90M+ hectares monitored.
- **Call to Action** — "Technology is becoming Earth's guardian."
- **Footer** — Resources, navigation links, and attribution.

---

## Tech Stack

| Layer       | Technology |
|-------------|-----------|
| Markup      | Semantic HTML5 |
| Styling     | CSS3 (custom properties, `clip-path`, keyframes, grid, flexbox) |
| Behaviour   | Vanilla JavaScript ES2020 (Intersection Observer, rAF counters) |
| Deployment  | GitHub Actions → GitHub Pages |
| Build step  | None — fully static |

---

## Local Development

No build step or dependencies required.

```bash
# 1. Clone the repository
git clone https://github.com/<your-username>/<your-repo>.git
cd <your-repo>

# 2. Open in browser
#    macOS:
open index.html

#    Windows:
start index.html

#    Linux:
xdg-open index.html
```

Or use the **Live Server** extension in VS Code for hot-reload during
development.

---

## Deployment to GitHub Pages

Deployment is fully automated via GitHub Actions.

### How it works

Every push to the `main` branch triggers the workflow defined in
[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml), which:

1. Checks out the repository.
2. Deploys the entire repo root to the `gh-pages` branch using
   [`JamesIves/github-pages-deploy-action@v4`](https://github.com/JamesIves/github-pages-deploy-action).

### One-time setup (first deploy)

After pushing to `main` for the first time:

1. Go to your repository on GitHub.
2. Navigate to **Settings → Pages**.
3. Under **Source**, select **Deploy from a branch**.
4. Set the branch to **`gh-pages`** and the folder to **`/ (root)`**.
5. Click **Save**.

Your site will be live at `https://<username>.github.io/<repo-name>/` within
a minute or two.

### Manual deploy trigger

You can also trigger deployment manually from the **Actions** tab → select the
**Deploy to GitHub Pages** workflow → click **Run workflow**.

---

## Project Structure

```
/
├── index.html                    # Single-page application
├── style.css                     # All styles, animations, responsive layout
├── script.js                     # Slider, counters, scroll reveal, nav
├── .github/
│   └── workflows/
│       └── deploy.yml            # GitHub Actions deployment workflow
├── README.md                     # This file
└── ai-fighting-deforestation-plan.md  # Original build plan
```

---

## Data References

- Tree loss figures: [Crowther et al., Science 2015](https://www.science.org/doi/10.1126/science.aax0848)
- Forest monitoring coverage: [Global Forest Watch](https://www.globalforestwatch.org)
- AI detection speed improvements: composite of published GFW / Planet Labs studies

---

## License

MIT — free to use, fork, and adapt for educational purposes.
