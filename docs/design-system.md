# Design System

This guide adapts the Picardo Internal UI design system for Local Brain.

Local Brain should feel related to Picardo's internal CRM: dense, calm, text-forward,
operational, and graph-capable. It should not copy Picardo's implementation details
directly. Local Brain will use a Tauri + React app with shadcn/ui components, Tailwind,
and theme tokens in `globals.css`.

## Product Feel

Local Brain is an agent-operated personal CRM and memory surface. The UI is mostly a
window into a brain maintained and queried by AI agents through the CLI and local
skills.

Core qualities:

- **Operational:** quick to scan, useful for inspection, correction, and navigation.
- **Dense:** compact rows, small labels, mono metadata, little wasted vertical space.
- **Calm:** warm paper backgrounds, thin borders, soft tints, restrained contrast.
- **Personal:** less corporate than Picardo, but still serious and structured.
- **Demonstrable:** the Graph and detail pages should make the user's brain legible to
  another person in a few seconds.
- **Agent-aware:** recent changes, citations, and generated reports should be easy to
  inspect.

Avoid oversized heroes, decorative gradients, fluffy cards, heavy illustration, empty
marketing whitespace, and generic admin-dashboard gloss.

## Implementation Stack

Use:

- Tauri 2 for the desktop shell.
- React and TypeScript for UI.
- Vite for frontend build tooling.
- Tailwind CSS for utilities.
- shadcn/ui for reusable primitives.
- Radix through shadcn where behavior matters.
- `cmdk` through shadcn command components for command/search flows.
- `lucide-react` for icons.
- `cn()` using `clsx` and `tailwind-merge`.
- `globals.css` for theme tokens, shadcn CSS variables, app shell styles, and recurring
  component classes.

Do not hand-roll basic controls when a shadcn primitive fits. Use shadcn Button, Input,
Textarea, Select, Dialog, Popover, Command, DropdownMenu, Tabs, Tooltip, Switch,
Checkbox, Badge, Separator, ScrollArea, Sheet, Table, and Card where appropriate.

The design system should theme shadcn through CSS variables in `globals.css`, not by
forking every component's class strings.

## Source Map

Expected future files:

- `apps/desktop/src/app/globals.css`: tokens, shadcn variables, app shell, recurring
  component classes.
- `apps/desktop/src/components/ui/*`: shadcn generated components.
- `apps/desktop/src/components/app-shell.tsx`: sidebar, topbar, command trigger.
- `apps/desktop/src/components/page-head.tsx`: route-level title and actions.
- `apps/desktop/src/components/toolbar.tsx`: list filters and search.
- `apps/desktop/src/components/data-table.tsx`: dense tables or virtualized wrapper.
- `apps/desktop/src/components/detail-layout.tsx`: body plus aside detail pattern.
- `apps/desktop/src/components/graph-view.tsx`: user-centered graph surface.
- `apps/desktop/src/lib/badges.ts`: semantic badge color mapping.
- `apps/desktop/src/lib/cn.ts`: class merging helper.

Until the app scaffold exists, treat these as target names rather than fixed paths.

## Theme Tokens

Define tokens in `globals.css` using shadcn's variable model. Keep Picardo's warm,
editorial feel, but name tokens through shadcn-compatible roles.

Example direction:

```css
:root {
  --background: 48 31% 95%;
  --foreground: 42 16% 9%;

  --card: 45 45% 97%;
  --card-foreground: 42 16% 9%;

  --popover: 45 45% 97%;
  --popover-foreground: 42 16% 9%;

  --primary: 18 56% 38%;
  --primary-foreground: 45 45% 97%;

  --secondary: 43 28% 91%;
  --secondary-foreground: 42 16% 18%;

  --muted: 43 28% 91%;
  --muted-foreground: 42 8% 46%;

  --accent: 18 56% 38%;
  --accent-foreground: 45 45% 97%;

  --destructive: 4 61% 42%;
  --destructive-foreground: 45 45% 97%;

  --border: 43 22% 81%;
  --input: 43 22% 81%;
  --ring: 18 56% 38%;

  --radius: 0.375rem;
}
```

Add Local Brain aliases only when they clarify recurring app surfaces:

```css
:root {
  --lb-bg-2: 43 28% 91%;
  --lb-line-soft: 43 22% 86%;
  --lb-ink-2: 42 12% 26%;
  --lb-ink-3: 42 8% 46%;
  --lb-sidebar: 45 45% 97%;
}
```

Dark mode should define the same variables under `.dark`.

### Semantic Accents

Keep accent colors limited and semantic:

- Rust/accent: primary actions, active nav rail, important highlights.
- Green: success, current, completed, healthy.
- Blue: meetings, organizations, scheduled.
- Red: errors, overdue, destructive.
- Yellow: due soon, documents, warnings.
- Purple: people, projects, memory/AI context.

Map these in `badges.ts` and reusable badge variants. Do not invent per-screen color
switch statements.

## Typography

Use a three-family system:

- Sans: Inter Tight or Inter for UI.
- Serif: Source Serif 4 for page titles, detail titles, summaries, and readable prose.
- Mono: JetBrains Mono or IBM Plex Mono for metadata, labels, counts, dates, IDs, and
  keyboard hints.

Rules:

- Body text defaults to sans at roughly 13px.
- Route titles and important detail headings use serif.
- Section labels and table headers use small uppercase mono.
- Dates, counts, IDs, emails, hashes, and status metadata use mono.
- Long readable content uses a prose style with serif text and comfortable line height.
- Avoid viewport-scaled type.
- Keep letter spacing at zero except uppercase mono labels, where subtle positive
  spacing is acceptable.

## Shape And Spacing

The system is compact:

- Topbar: about 52px desktop, 48px mobile.
- Sidebar: about 240px expanded, 56px collapsed.
- Dense row baseline: 32px.
- Rich table rows: 48px to 56px.
- Page header padding: about `18px 24px 14px`.
- Detail body padding: about `24px 24px 80px`.
- Card radius: 4px to 8px, with 8px as the upper bound.
- Buttons and nav items: usually 6px radius.
- Badges and tags: 2px to 4px radius.

Prefer thin borders over shadows. Use shadows only for overlays, popovers, modals, and
graph detail panels.

## Layout Patterns

### App Shell

The app shell contains:

- fixed/sidebar navigation
- compact topbar
- command/search trigger
- main route region
- optional detail drawer or right aside

Top-level nav:

- Today
- Tasks
- Network
- Projects
- Graph
- Ask
- Settings

Use lucide icons for each nav item. Keep labels short and stable.

### Page Head

Every route should use a route header with:

- mono uppercase eyebrow
- serif title
- short muted subtitle when useful
- right-aligned actions

Use shadcn Button variants for actions. Avoid custom button markup.

### Lists And Tables

Use a dense data-table pattern for people, organizations, projects, tasks, documents,
and interactions.

Conventions:

- Sticky mono uppercase headers.
- Thin dividers.
- No zebra striping.
- Hover background uses the muted/secondary token.
- Identity column first, with a strong title and subtle subtitle.
- Dates, counts, IDs, and statuses use mono.
- Missing values render as `-` in muted text.
- Meaningful filters should sync to URL state.

Use shadcn Table for modest lists. Use a virtualized table wrapper for large lists.

### Detail Pages

Use a two-column detail layout:

- main body for summary, tasks, interactions, documents, memories, and prose
- right aside for metadata and quick links

At narrow widths, the aside stacks below the body.

Use:

- section blocks separated by space, not nested cards
- shadcn Tabs for detail subsections where tabs are natural
- shadcn Badge for status/kind labels
- shadcn Separator for dividers
- compact related-record rows for links
- prose styles for document/interactions bodies and AI summaries

### Graph

Graph is a specialized full tool surface inspired by Picardo's graph view.

It should:

- center on the user's own `people.is_self` row
- render typed nodes for people, organizations, projects, tasks, documents,
  interactions, memories, and tags
- derive edges from affiliations, join tables, task origins, memory links, evidence
  refs, and tags
- show a right-side selected-node panel
- open the relevant detail page from any node
- use token colors for overlays and UI chrome

Filters by node type, time range, project, and edge strength are useful follow-up once
the base graph is working.

Canvas/WebGL/SVG graph drawing may need literal colors, but keep those values in a
single graph theme model derived from the same semantic palette.

### Ask And Reports

Ask and report surfaces should make citations obvious.

Use:

- shadcn ScrollArea for message/report history
- shadcn Button for actions
- shadcn Badge for cited record types
- compact citation rows that open documents or interactions
- prose styling for generated reports

The UI should make it easy to inspect what an automation changed or cited.

## Components

### Buttons

Use shadcn Button.

Preferred variants:

- `default`: primary actions
- `secondary`: calm secondary actions
- `outline`: toolbar and page actions
- `ghost`: sidebar, icon, and low-emphasis actions
- `destructive`: irreversible operations

Icon-only buttons need `aria-label` and usually a Tooltip.

### Badges And Tags

Use shadcn Badge as the base.

Badges are for status, record type, and state. Tags are user taxonomy. If shadcn Badge
is too rounded by default, tune its classes or CSS variables globally so it matches the
compact Local Brain shape.

Shared helpers should map:

- task status
- project status
- document kind
- interaction kind
- memory kind
- record type

### Filters

Use shadcn Tabs, ToggleGroup, Select, Checkbox, Switch, Popover, and Command rather
than custom chip controls when behavior matches.

Compact filter buttons may still use Button with `variant="outline"` or a small
ToggleGroup item.

### Cards

Use shadcn Card sparingly:

- dashboard panels
- repeated summaries
- modals/dialog content
- framed tool surfaces

Do not put cards inside cards. Do not make page sections feel like floating marketing
cards.

### Command Palette

Use shadcn Command powered by `cmdk`.

Rows should show:

- record-type badge
- title
- short subtitle or highlighted match
- optional mono keyboard hint

Preserve Cmd/Ctrl+K, Escape, ArrowUp/Down, and Enter.

### Popovers, Dialogs, Sheets, Tooltips

Use shadcn wrappers.

- Popover: filters, lightweight selectors, graph controls.
- Dialog: focused confirmation or creation flows.
- Sheet: mobile navigation and narrow detail panels.
- Tooltip: icon-only buttons and graph controls.

## Tailwind Usage

Preferred pattern:

1. Start with a shadcn component.
2. Use theme tokens and global CSS for app-wide look.
3. Add Tailwind utilities for local layout, spacing, and small one-off adjustments.
4. Use `cn()` for conditional classes.
5. Move repeated structural styling into `globals.css`.

Avoid one-off inline styles except for dynamic values like grid templates, graph
coordinates, canvas dimensions, or CSS variables.

## Responsive Behavior

Default breakpoints:

- `1100px`: detail aside stacks below body.
- `1024px` to `901px`: sidebar becomes icon rail.
- `900px`: sidebar becomes mobile drawer; dashboard grids stack.
- `700px`: dense rows simplify.
- `600px`: search rows and typography compress.

Rules:

- Keep tables horizontally scrollable or virtualized.
- Let toolbars wrap.
- Hide nonessential keyboard hints on small screens.
- Keep detail content readable with smaller padding.
- Avoid fixed widths that exceed the viewport.

## Accessibility And Interaction

- Icon-only controls need `aria-label`.
- Add Tooltip for unfamiliar icon-only controls.
- Use anchors for navigation and buttons for local state changes.
- Use visible focus styles.
- Use semantic tab roles through shadcn Tabs.
- Preserve Cmd/Ctrl+K for command/search.
- Preserve Escape to close overlays.
- Do not rely on color alone for important state.

## Copy Style

Use terse operational copy:

- "Loading..."
- "Failed to load"
- "No tasks match"
- "No interactions"
- "Type a query to search."
- "Open in Graph"
- "Cited by report"

Avoid marketing claims, long instructional text, obvious control explanations, and
repeated model/vendor names unless the screen is specifically about model settings.

## New Component Checklist

Before adding a new component:

- Does shadcn already provide the primitive?
- Are colors tokenized in `globals.css`?
- Is the type family right for the content?
- Are labels, dates, IDs, and counts mono?
- Does it work in dark mode?
- Does it fit at 900px and 600px widths?
- Are icon buttons labeled and tooled?
- Are filters represented with shadcn controls?
- Is URL state synced when the filter/view is worth sharing?
- Is repeated status color mapped in a helper rather than locally invented?

## Things To Avoid

- New palettes disconnected from theme tokens.
- Large rounded cards or nested card stacks.
- Gradient backgrounds, decorative blobs, or ornamental hero sections.
- Custom buttons, inputs, dialogs, popovers, or menus when shadcn fits.
- Custom table systems when the shared table/virtual table fits.
- Local badge color switch statements.
- Inline hard-coded colors in normal DOM UI.
- Dense prose in sans when it should use the prose style.
- Metadata in serif when it should be mono.
- Controls without hover/focus states.
- Long explanatory text inside app screens.

## Extending The System

When adding a reusable primitive:

1. Generate or add the closest shadcn component.
2. Tune its app-wide appearance through `globals.css` and theme tokens.
3. Wrap it only if Local Brain needs stable domain-specific behavior.
4. Keep screen-specific composition close to the data.
5. Add semantic mappings to shared helpers like `badges.ts`.

The goal is not to make every component generic. The goal is to keep behavior and
visual language consistent while letting each screen stay close to the user's brain
data.
