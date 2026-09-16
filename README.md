# Pooling Lab — published site

The static build of *Pooling Lab*, an interactive data story about Bayesian
partial pooling: when a model should trust an individual, when it should
borrow from the group, what a covariate buys, and why knowing your own team
precisely tells you little about the next one.

This repository holds only what the site needs: the Vite front end and the
precomputed JSON under `public/data/`. Every model was fitted offline with
CmdStan in the source project; nothing runs at request time. The R compute
core, Stan programs and tests live there, not here — this repository is
synced from it and is not the place to change the data.

```
npm ci
npm run dev        # http://localhost:5173
npm run check      # data contract, headless renders, production build
```

Pushes to `main` build and deploy to GitHub Pages via
`.github/workflows/deploy.yml`.
