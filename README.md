# Lenny’s Music Room

An R&B/Soul-inspired Father’s Day gift for Lenny Ball: a warm, mobile-friendly space to record a musical idea, shape it with simple effects, save it on a device, find legally available charts, and explore a small public-facing account of Lenny’s musical story.

## What it does

- Records audio locally in a modern browser; recordings stay on the device until the user chooses to save them.
- Plays recordings back with adjustable warmth, echo, room, and pitch controls.
- Opens searches for legal sheet-music sources rather than hosting copyrighted charts.
- Presents **Lenny’s Story**, clearly labeling family memories separately from verified public context and source links.
- Is designed for Android phones first: large controls, readable text, and a single-column mobile layout.

## Privacy

The original family reference photos are deliberately excluded from Git and will not be published. The public page uses one AI-generated musical portrait of Lenny, created from those private reference images with family permission.

## Running it locally

```powershell
npm install
npm run dev
```

For a production build:

```powershell
npm run build
```

## Publishing

The project includes a GitHub Actions workflow that deploys the `main` branch to GitHub Pages. In the repository’s **Settings → Pages**, choose **GitHub Actions** as the deployment source. After a successful workflow run, the site will be available at:

`https://pixelpolicyuser.github.io/fathers-day/`

## Credits

Created by **Anthony R. Ball** in collaboration with **AI (Codex)** on **June 21, 2026**, as a Father’s Day gift for Lenny Ball.
