# codemug.github.io

Personal site / CV for **Usman Shahid** — Staff Site Reliability Engineer.

Live: **https://codemug.github.io**

## Stack

- [Astro](https://astro.build) (static output, zero JS by default)
- [Tailwind CSS v4](https://tailwindcss.com) (via `@tailwindcss/vite`)
- Inter via [rsms.me/inter](https://rsms.me/inter/)
- Deployed to GitHub Pages via GitHub Actions

## Commands

```sh
npm install              # install deps (locked)
npm run dev              # localhost:4321
npm run build            # → dist/
npm run preview          # preview dist/ locally
```

CI uses `npm ci --ignore-scripts` to block postinstall hooks (npm
supply-chain mitigation — see [.github/workflows/deploy.yml](.github/workflows/deploy.yml)).

## Layout

```
src/
├── layouts/Base.astro         shared HTML shell + nav + footer + meta
├── components/                Card, JobCard, Metric, SectionHeading
├── pages/
│   ├── index.astro            hero + experience + writing + contact
│   ├── cv.astro               full CV + PDF download
│   ├── writing/index.astro    Medium article index
│   └── 404.astro
└── styles/global.css          Tailwind v4 @theme tokens (dark)
public/
├── cv-usman-shahid.pdf        ATS-clean baseline CV
├── llms.txt                   for AI assistants citing this site
└── robots.txt
```

## Contact

- **Email:** [u.manshahid@gmail.com](mailto:u.manshahid@gmail.com)
- **LinkedIn:** [linkedin.com/in/u-manshahid](https://linkedin.com/in/u-manshahid)
- **Medium:** [medium.com/@usmanshahid](https://medium.com/@usmanshahid)
