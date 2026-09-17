# Pooling Lab — published site

The static build of *Pooling Lab*, an interactive data story about Bayesian
partial pooling: when a model should trust an individual, when it should
borrow from the group, what a covariate buys, and why knowing your own team
precisely tells you little about the next one.

This repository holds only what the site needs: the Vite front end and the
precomputed JSON under `public/data/`. Every model was fitted offline with
CmdStan in the source project; nothing runs at request time.

> ⚠️ **Every file here is generated. Do not edit this repository by hand.**
> `src/`, `public/` and `scripts/` are *deleted and recopied* by
> `site/scripts/sync-pages.mjs` in the source project, so any change made here
> — a chart, a section, a stylesheet, a typo fix — is silently destroyed by the
> next sync, with no conflict and no warning.
>
> Make the change in the source project
> (`bayes_training/pooling-lab/pooling-lab`), which holds the R compute core,
> the Stan programs and the tests, then run the sync and commit the result here.
> The only files safe to edit directly are this README and
> `.github/workflows/deploy.yml`, neither of which the sync touches.

```
npm ci
npm run dev        # http://localhost:5173
npm run check      # data contract, headless renders, production build
```

Pushes to `main` build and deploy to GitHub Pages via
`.github/workflows/deploy.yml`.
