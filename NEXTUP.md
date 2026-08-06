Features to add:
- ~~Ability to copy and paste a signal~~ — shipped in 8b29d39
- Refining and fine tuning the signal engine

- Split up the model into its alpha forecasts and risks models

  These two are scoped in docs/engine-roadmap.md, including the measurements
  behind the ordering. Read it before starting either: the phases are arranged
  so that tuning happens last, and doing it first will produce numbers that
  improve while the engine gets worse.

- Expand the stock universe and make loading more effective with research from Ben Feng's paper

- Buiid into a web application vs a website to maintain consistent runtime
