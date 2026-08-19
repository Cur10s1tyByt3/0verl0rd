# Overlord UI styles

The dashboard is the visual reference for this design system. Source styles are
bundled from `src/ui.css` into `public/assets/ui.css`.

## Layers

- `tokens.css` contains semantic theme values. Components should consume these
  variables instead of introducing raw palette values when a token exists.
- `base.css` contains application-wide accessibility and motion behavior.
- `primitives/` contains reusable controls with no page-specific layout.
- `patterns/` composes primitives into recurring structures such as toolbars.
- Feature-specific layout belongs in a future `features/` module or the existing
  feature stylesheet until it is migrated.

Load order is `tailwind.css`, `main.css`, `ui.css`, then `custom.css`. This lets
the design system replace legacy declarations while preserving administrator
branding overrides.

## Conventions

- Use the `ui-` prefix for reusable components.
- Use `data-tone` for semantic color variants and `data-size` for sizing.
- Use `is-*` classes for transient JavaScript state during legacy migration.
- Keep data fetching in feature modules; UI primitives should only render or
  manage their own interaction behavior.
- Retain a legacy class beside its `ui-*` replacement until all consumers and
  selectors have migrated, then remove the legacy declaration separately.

