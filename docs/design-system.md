# Design System

Local Brain uses the **Reflect Open / Reflect Local design system**. The previous
warm-paper ("Picardo") direction has been retired. Local Brain should feel like
Reflect's app UI: minimalist, dense, cool-grey with a single indigo accent,
shadcn/HSL-token friendly, with a fixed sunken left sidebar, a quiet
command/search trigger, compact rows, restrained borders, and crisp Inter
typography.

We translate Reflect's **visual language**, not its product model. Local Brain
stays a local-first personal CRM and memory surface — it is not a note editor.

## Reference Sources

The system is adapted from the Reflect Open design-system package and its desktop app:

- `reflect-open/design-system/readme.md`, `SKILL.md`, `styles.css`
- `reflect-open/design-system/tokens/{colors,fonts,typography,spacing}.css`
- `reflect-open/design-system/components/{buttons,data-display,forms}/*`
- `reflect-open/design-system/ui_kits/app/{AppShell,Sidebar,SearchModal,Views}.jsx`
- `reflect-open/apps/desktop/src/components/{ui,sidebar}/*`

Concrete porting decisions and the before/after are recorded in
[`reflect-design-system/final-report.md`](reflect-design-system/final-report.md).

## Product Feel

Core qualities (unchanged in intent, restyled in execution):

- **Operational:** quick to scan, useful for inspection, correction, navigation.
- **Dense:** compact rows, small quiet labels, mono metadata, little wasted space.
- **Calm:** white content on a faint cool field, hairline borders, soft grey
  washes, restrained contrast. No warm paper, no rust, no gradients.
- **Focused accent:** indigo is the only saturated color, reserved for the brand
  mark, primary actions, focus rings, and the active-nav icon.
- **Demonstrable:** Graph and detail pages make the brain legible quickly.
- **Agent-aware:** recent changes, citations, and reports are easy to inspect.

Avoid oversized heroes, decorative gradients/orbs, nested cards, heavy
illustration, marketing whitespace, and any copy that explains the design system
inside the app.

## Implementation Stack

- Tauri 2 desktop shell; React 19 + TypeScript; Vite 6 build.
- **Tailwind CSS v4** with `@theme inline`, theming shadcn-compatible HSL CSS
  variables in `apps/desktop/src/app/globals.css`.
- `lucide-react` for icons (never hand-roll an icon lucide already provides).
- `cn()` (`clsx` + `tailwind-merge`) for conditional classes.
- Small in-repo primitives where they keep variants consistent: `components/button.tsx`,
  `components/badge.tsx`, and shared class strings in `lib/ui.ts`.

The design system themes components through CSS variables in `globals.css`, not by
forking class strings per component.

## Theme Tokens

Tokens live in `globals.css` as HSL triplets consumed via `hsl(var(--token))`, mapped
onto Tailwind/shadcn roles in `@theme inline`. The palette is Tailwind cool-grey for
neutrals and indigo for the accent.

```css
:root {
  --background: 210 20% 99%;   /* faint cool app field */
  --foreground: 221 39% 11%;   /* gray-900 ink */

  --card: 0 0% 100%;           /* white surface */
  --card-foreground: 221 39% 11%;
  --popover: 0 0% 100%;
  --popover-foreground: 221 39% 11%;

  --primary: 243 75% 59%;      /* indigo-600 — the only solid action */
  --primary-foreground: 0 0% 100%;

  --secondary: 220 14% 96%;    /* gray-100 wash: hover, active rows, segments */
  --secondary-foreground: 217 19% 27%;
  --muted: 220 14% 96%;
  --muted-foreground: 220 9% 46%;

  --accent: 226 100% 94%;      /* indigo-100 soft tint */
  --accent-foreground: 245 58% 51%;

  --destructive: 0 72% 51%;
  --destructive-foreground: 0 0% 100%;

  --border: 220 13% 91%;       /* gray-200 hairline */
  --input: 220 13% 91%;
  --ring: 239 84% 67%;         /* indigo-500 focus */

  --radius: 0.5rem;            /* 8px house radius (sm 4 / md 6 / lg 8 / xl 12) */
}
```

Local Brain surface aliases for recurring chrome:

```css
:root {
  --lb-bg-2: 220 14% 96%;
  --lb-line-soft: 220 14% 96%;
  --lb-ink-2: 215 14% 34%;   /* sidebar nav / secondary text */
  --lb-ink-3: 220 9% 46%;
  --lb-sidebar: 210 20% 98%; /* gray-50 sunken sidebar */
}
```

`.dark` defines the same variables on Reflect's dark surfaces (deep cool navy
`224 45% 7%`, indigo-500 brand, hairline white borders). Local Brain has no theme
toggle yet, but the dark palette is maintained so it lands faithfully when added.

### Accent Discipline

Indigo is the sole saturated color. It appears in: the brand mark, primary buttons,
focus rings, the active-nav icon, the soft `accent` tint (selected/secondary
emphasis, the Ask user bubble), and citation rules. Status badges may use small
muted success/warning/danger tints. Do not introduce new palettes or per-screen
color switch statements — map status colors once in `components/badge.tsx`.

## Typography

Reflect uses **one sans family (Inter / system) plus mono** — there is **no serif**.

```css
--font-sans: 'Inter', 'Inter Variable', ui-sans-serif, system-ui, -apple-system, …;
--font-mono: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Monaco, Consolas, …;
```

Rules:

- Body defaults to sans at ~13px with a subtle negative tracking for Inter crispness.
- Titles use sans **semibold** with tight tracking (not serif).
- Section/field labels are small (11–12px), medium weight, calm grey, **sentence
  case — never uppercase, never mono**.
- Mono is reserved for metadata: dates, counts, statuses, IDs, and keyboard hints.
- Long readable bodies use comfortable sans line height; avoid viewport-scaled type.

## Shape and Spacing

- Sidebar: 260px, sunken (`--lb-sidebar`), hairline right border.
- Topbar: ~48px, hairline bottom border.
- Dense row baseline ~32px; table rows compact with `px-3 py-2`.
- House radius 8px (`--radius`): buttons/inputs `rounded-md` (6px), cards/tables
  `rounded-lg` (8px), overlays `rounded-xl` (12px), badges `rounded-full`.
- Prefer hairline borders over shadows. Shadows only for overlays/popovers/modals.

## Layout Patterns

### App Shell (`components/app-shell.tsx`)

- 260px sunken sidebar: the **brain switcher** in the brand slot (the active
  brain's color swatch + name, sans semibold, opening a keyboard-navigable menu),
  compact nav rows, and a pinned "Add record" action with the Settings gear at the
  bottom. The quiet ⌘K search trigger lives in the topbar.
- Active nav row: `bg-secondary` grey wash, foreground text, **indigo icon**;
  inactive rows use muted text and hover to the grey wash.
- Topbar: back/forward, a quiet Search trigger with a mono ⌘K keycap, and the single
  indigo **Add** button (the `Button` primitive, `variant="primary"`).
- Main content is white on the faint app field, `px-7 py-6`.

### Page Head (`components/page-head.tsx`)

Quiet grey eyebrow + sans-semibold tight-tracking title + right-aligned actions.

### Lists and Tables (`components/data-list.tsx`)

Dense table, `rounded-lg` frame, hairline dividers, quiet sentence-case header row on
a faint grey wash, hover wash on clickable rows. No zebra striping. Statuses render as
`StatusBadge`; dates/counts/IDs use mono; missing values render as `—` in muted text.

### Detail Pages

`PageHead` + `DetailFields` (140px label grid) + spaced `Section` blocks of related
records — never nested cards. Status fields render as a `StatusBadge`. Citations use
a left indigo rule.

### Graph

User-centered node graph. Node colors come from a single cool palette (indigo self,
blue/violet/emerald/cyan/etc.), edges and chrome use token colors.

### Ask and Reports

Conversation list + thread + composer. The user bubble uses the soft indigo `accent`;
the assistant bubble is a bordered white card. Citations open the source document or
interaction. Use the `Button` primitive for the composer Send action.

## Components

### Button (`components/button.tsx`)

Variants: `primary` (indigo solid — the one loud action), `secondary` (soft indigo),
`outline` (bordered white), `ghost` (muted, washes on hover), `destructive`. Sizes
`sm`/`md`. Icon-only buttons need `aria-label`.

### Badge (`components/badge.tsx`)

Reflect pill: `rounded-full`, small, soft-tinted. Tones `neutral | accent | success |
warning | danger`. `StatusBadge` maps a status string to a tone once, so screens never
invent their own status colors.

### Command Palette (`components/command-palette.tsx`)

Soft scrim, elevated `rounded-xl` card, leading search icon, quiet group labels,
rounded result rows with a grey-wash active state, mono shortcut hints. Preserve
Cmd/Ctrl+K, Escape, ArrowUp/Down, Enter.

### Inputs

Use the shared `controlClass` from `lib/ui.ts`: bordered white field, indigo focus
ring. Field labels use the quiet grey label style.

## Tailwind Usage

1. Reach for the `Button`/`Badge` primitives and shared `lib/ui.ts` classes first.
2. Theme through tokens and `globals.css`.
3. Add Tailwind utilities for local layout and one-off adjustments.
4. Use `cn()` for conditional classes.
5. Avoid inline hard-coded colors except dynamic values (graph coordinates/colors).

## Things to Avoid

- The retired warm/paper/rust palette, or any new palette off-token.
- Serif type, uppercase-mono section labels, or metadata in non-mono.
- Large rounded cards, nested card stacks, gradients, blobs/orbs, hero sections.
- Custom buttons/badges/inputs when the primitives fit.
- Per-screen status color switch statements (map them in `badge.tsx`).
- Long explanatory text — or any text about the design system — inside app screens.
