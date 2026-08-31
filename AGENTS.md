## Development

When starting the dev server, use background mode:

```
astro dev --background
```

Manage the background server with `astro dev stop`, `astro dev status`, and `astro dev logs`.

## Engineering quality

- Human readability and long-term maintainability are acceptance criteria, not optional cleanup.
- Design ownership, module boundaries, state flow, and lifecycle before implementation. Keep one authoritative source for each fact.
- Prefer small cohesive modules, explicit typed dependencies, intention-revealing names, and comments that explain decisions rather than restate code.
- Do not introduce hidden mutable globals, stringly typed event buses, duplicated state, timing-dependent workarounds, speculative abstractions, or monolithic controllers.
- Unavoidable complexity must be tied to a documented behavior contract, isolated behind a narrow interface, and covered at the lowest practical test level.
- A user-visible behavior, interaction, or visual change requires prior discussion and explicit approval. Update the relevant behavior cases and tests in the same change as its implementation.

## Mainline control

- Keep the current mainline and its active branch explicit before implementation work. Stop a branch as soon as it has answered the question that justified it; do not expand a proof of concept into a parallel product.
- Before implementing a material tradeoff, proactively pause and present the current behavior, viable options, user-visible differences, advantages, disadvantages, and a recommendation. Wait for explicit approval.
- After completing implementation work, report the complete mainline list and complete active-branch/substep list, marking the current position and next step. Do not append this progress report to ordinary discussion or question answering.

## Documentation

Full documentation: https://docs.astro.build

Consult these guides before working on related tasks:

- [Adding pages, dynamic routes, or middleware](https://docs.astro.build/en/guides/routing/)
- [Working with Astro components](https://docs.astro.build/en/basics/astro-components/)
- [Using React, Vue, Svelte, or other framework components](https://docs.astro.build/en/guides/framework-components/)
- [Adding or managing content](https://docs.astro.build/en/guides/content-collections/)
- [Adding styles or using Tailwind](https://docs.astro.build/en/guides/styling/)
- [Supporting multiple languages](https://docs.astro.build/en/guides/internationalization/)
