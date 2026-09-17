# Pooling Lab (published site) — working context

> ⚠️ **You are in the generated repository. Almost nothing here should be
> edited by hand.** This is the deploy target for *Pooling Lab*, not its source.

## Where the source is

```
bayes_training/pooling-lab/pooling-lab   <- SOURCE. R, Stan, tests, the site.
                                            no remote; local history only
bayes_training/pooling-lab-pages         <- here. github.com/trevorlolsen/pooling-lab
                                            push to main == deploy
                                            -> https://trevorlolsen.github.io/pooling-lab/
```

The source project's `site/scripts/sync-pages.mjs` copies `index.html`,
`src/`, `public/`, `package.json`, `package-lock.json`, `vite.config.js` and
the three check scripts into here. It **deletes `src/`, `public/` and
`scripts/` wholesale and recopies them**, so a file deleted there disappears
here, and a file edited *here* is destroyed on the next sync — no conflict, no
warning, no trace.

## So: where do I make a change?

| you want to change | edit it in |
|---|---|
| a chart, a section, styles, the check scripts | **the source project**, then sync |
| the data under `public/data/` | the source project's R — `Rscript scripts/build_site_data.R --export-only`, then sync |
| this file, `README.md`, `.github/workflows/deploy.yml` | here. The sync does not touch them. |

Editing `src/` here to "just fix one thing quickly" is the mistake this file
exists to prevent. It will appear to work, deploy correctly, and then vanish
the next time anyone syncs.

## Shipping a change

From the source project:

```bash
cd site && npm run check && node scripts/interaction-test.mjs   # gate it there first
node scripts/sync-pages.mjs                                      # prints the absolute target
cd ../../../pooling-lab-pages                                    # THREE levels up from site/
git status                       # should be only what you meant to change
npm run check && node scripts/interaction-test.mjs
git commit -am "..." && git push  # pushing main IS the deploy
```

`.github/workflows/deploy.yml` re-runs `npm ci`, `npm run check` and
`interaction-test.mjs` on the runner before publishing, so a red check blocks
the deploy rather than shipping a broken page. A deploy takes about 45s.

Note `interaction-test.mjs` has no npm script and is not part of `npm run
check`; the workflow invokes it directly, and so should you.

## What this repository is

An eight-section scrollytelling story about Bayesian partial pooling. Static
Vite build, Observable Plot, no server and no runtime fitting — every posterior
was computed offline with CmdStan, except section 3, which recreates its
posteriors live on a θ grid in the browser from the per-serve data already in
`public/data/`. `public/data` is ~21 MB and is committed here deliberately: it
is the whole point of the site.

`vite.config.js` uses `base: './'` so the build works from any path without a
rebuild. Do not change it to an absolute base for GitHub Pages; the relative
base is what keeps local `npm run dev`, the Pages project path and any other
host all working from one artifact.
