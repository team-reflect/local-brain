# Desktop interface polish

Full review of shared desktop primitives, shell and brain navigation, Graph,
Chat controls and markdown, record headers/fields, task completion, and Settings
feedback. React 19 and TypeScript run inside Tauri 2; changes use the existing
Tailwind 4 utilities, HSL tokens, Radix/shadcn primitives, and Lucide icons.

This is a source and automated-test review. It does not claim a visual inspection
of every screen. Per the repository's [verification boundary](../../AGENTS.md),
the native app and manual browser walkthrough were not run.

## Coverage

| Category | Evidence inspected | Result |
| --- | --- | --- |
| Typography | `globals.css`, `lib/ui.ts`, PageHead, DetailFields, EmptyState, SettingsField, ChatMarkdown, update/download labels | Long-title/value wrapping, short-copy wrapping, and numeric alignment improved. Existing font smoothing and font families retained. |
| Surfaces | AppShell, BrainSwitcher/Chooser, shared controls, ChatComposer/ConversationRail, Graph/NodeDetailsPanel, task/list components, Settings option cards | Keyboard access, focus, eligible hit areas, disabled controls, and recoverable picker feedback improved. Structural borders and dense rows retained. |
| Animations | Dialog, Popover, DropdownMenu, task completion, message scroller, graph layout, reduced-motion rules | Popover state selectors corrected; pending task feedback no longer adds width. Runtime motion remains unverified. |
| Icons | Lucide/currentColor usage in shell, Settings, Chat, task status, graph controls; source search for image elements | Existing icon sizing and state colors retained. Spinner shares the checkbox footprint. No rendered `<img>` elements found in desktop source; no image-outline change applies. Optical weight at render size remains unverified. |
| Performance | Desktop-wide search for broad transitions/GPU hints, Chat message rendering, static graph layout, generated Tailwind utilities | No `transition-all`, `transition: all`, or `will-change` found in desktop source. No animation dependency or new render-time measurement added. Runtime profiling remains unverified. |

## Findings addressed

### Keyboard access and visible state

| Severity | Location | Before | After | Why |
| --- | --- | --- | --- | --- |
| HIGH | [graph.tsx:38](../../apps/desktop/src/surfaces/graph.tsx#L38), [graph.tsx:358](../../apps/desktop/src/surfaces/graph.tsx#L358), [graph.tsx:412](../../apps/desktop/src/surfaces/graph.tsx#L412) | Interaction edges were click-only; the SVG was exposed as one image despite containing interactive controls. | Named edge buttons support focus and Enter/Space, with an explicit focus stroke; the graph is an accessible group. Nodes and edges share activation-key handling. | Keyboard users can reach and open the same interaction records as pointer users. |
| MEDIUM | [chat-composer.tsx:145](../../apps/desktop/src/components/chat/chat-composer.tsx#L145) | The model picker cancelled its shared focus border/ring while retaining `outline-none`. | It inherits the shared field focus ring. | A static, local focus cue identifies the selected control inside the composer. |
| MEDIUM | [ui.ts:19](../../apps/desktop/src/lib/ui.ts#L19) | Disabled text inputs, textareas, and selects used the same chrome as available fields. | Shared disabled styles use a muted surface, reduced opacity, and unavailable cursor. | Pending forms make unavailable controls distinguishable without new motion. |
| MEDIUM | [brain-switcher.tsx:43](../../apps/desktop/src/components/brain-switcher.tsx#L43), [brain-switcher.tsx:64](../../apps/desktop/src/components/brain-switcher.tsx#L64), [brain-switcher.tsx:106](../../apps/desktop/src/components/brain-switcher.tsx#L106), [brain-switcher.tsx:166](../../apps/desktop/src/components/brain-switcher.tsx#L166), [app-shell.tsx:151](../../apps/desktop/src/components/app-shell.tsx#L151) | Switch/reveal actions closed the menu without showing their pending or failed outcome. | Polite pending text, an accessible error, disabled competing actions, successful-close, and retry/alternate-folder recovery. Feedback persists near the trigger after Escape; Settings stays aligned with the trigger. | Static feedback distinguishes progress, failure, and success while keeping recovery available. |

### Minimum hit area

| Severity | Location | Before | After | Why |
| --- | --- | --- | --- | --- |
| MEDIUM | [app-shell.tsx:52](../../apps/desktop/src/components/app-shell.tsx#L52), [app-shell.tsx:56](../../apps/desktop/src/components/app-shell.tsx#L56), [app-shell.tsx:159](../../apps/desktop/src/components/app-shell.tsx#L159), [app-shell.tsx:203](../../apps/desktop/src/components/app-shell.tsx#L203), [brain-switcher.tsx:91](../../apps/desktop/src/components/brain-switcher.tsx#L91), [conversation-rail.tsx:59](../../apps/desktop/src/components/chat/conversation-rail.tsx#L59), [chat-composer.tsx:145](../../apps/desktop/src/components/chat/chat-composer.tsx#L145), [chat-composer.tsx:164](../../apps/desktop/src/components/chat/chat-composer.tsx#L164), [graph-nodes.tsx:126](../../apps/desktop/src/surfaces/graph-nodes.tsx#L126), [graph-nodes.tsx:138](../../apps/desktop/src/surfaces/graph-nodes.tsx#L138) | Standalone history, search, Add task, Settings, brain picker, New chat, model/Send, and graph panel actions had 24–32px boxes. | Actual 40px boxes using `size-10`/`h-10`; icon dimensions stay the same. | Easier pointer targets fit their available chrome without overlapping invisible extensions or enlarging dense record rows. |

### Text wrapping and numeric stability

| Severity | Location | Before | After | Why |
| --- | --- | --- | --- | --- |
| MEDIUM | [page-head.tsx:15](../../apps/desktop/src/components/page-head.tsx#L15) | Record titles used `truncate`; header actions could compete for the same line. | Titles balance and wrap; the header and action group can wrap in narrow panes. The helper's outdated serif description is corrected. | Record identity stays readable when titles are long. |
| MEDIUM | [detail-fields.tsx:10](../../apps/desktop/src/components/detail-fields.tsx#L10), [detail-fields.tsx:14](../../apps/desktop/src/components/detail-fields.tsx#L14), [chat-markdown.tsx:126](../../apps/desktop/src/components/chat/chat-markdown.tsx#L126), [ui.ts:19](../../apps/desktop/src/lib/ui.ts#L19) | Intrinsic minimum widths and unbroken values could overflow their column. | `minmax(0,1fr)`, `min-w-0`, and bounded anywhere-wrapping keep values/prose inside the pane; code blocks retain horizontal scrolling. | Long URLs and identifiers remain readable without widening the surrounding layout. |
| LOW | [empty-state.tsx:25](../../apps/desktop/src/components/empty-state.tsx#L25), [field.tsx:22](../../apps/desktop/src/components/settings/field.tsx#L22), [chat-markdown.tsx:16](../../apps/desktop/src/components/chat/chat-markdown.tsx#L16), [chat-markdown.tsx:19](../../apps/desktop/src/components/chat/chat-markdown.tsx#L19), [chat-markdown.tsx:22](../../apps/desktop/src/components/chat/chat-markdown.tsx#L22) | Short headings/help text had default wrapping, and empty-state copy could span the pane. | Balanced headings, pretty wrapping for short descriptions, and a prose-width cap for empty states. | Applies the short-copy wrapping principle without rebalancing long generated paragraphs. |
| LOW | [model-download-progress.tsx:74](../../apps/desktop/src/surfaces/settings/model-download-progress.tsx#L74), [update-field.tsx:53](../../apps/desktop/src/surfaces/settings/update-field.tsx#L53), [update-notice.tsx:19](../../apps/desktop/src/components/update-notice.tsx#L19) | Updating byte/percentage text used proportional sans digits. | Those labels use tabular numerals. Existing mono percentages are retained. | Equal-width digits reduce movement during progress updates. |

### Motion restraint and stable feedback

| Severity | Location | Before | After | Why |
| --- | --- | --- | --- | --- |
| MEDIUM | [task-completion-control.tsx:48](../../apps/desktop/src/components/task-completion-control.tsx#L48) | A pending spinner added width next to the checkbox and displaced the task title. | The mounted checkbox establishes the footprint; a pointer-transparent spinner occupies it during the request, with `aria-busy`. | Pending feedback preserves alignment and control identity without adding an animation. |
| LOW | [popover.tsx:26](../../apps/desktop/src/components/ui/popover.tsx#L26) | `data-open:`/`data-closed:` selectors did not match Radix's `data-state` attribute. | All six entry/exit selectors use `data-[state=open]` or `data-[state=closed]`. | The existing brief popover transitions can run, including the reduced-motion override. |

The durable conventions are recorded in [Design System](../design-system.md).
Regression tests accompany brain-picker recovery, graph keyboard activation, and
task pending/control-identity behavior.

## Considered but rejected

| Location | Candidate | Rejected because |
| --- | --- | --- |
| Shared Button, task/list rows | Resize every control to 40px or extend checkbox pseudo-targets | Dense rows have less available height and neighboring actions. A blanket change would create overlap or change the documented density. |
| Shared Button and high-frequency rows | Add press scaling everywhere or remove every short color transition | Existing ≤150ms color feedback meets the motion-restraint rule. No observed problem justifies new motion or a blanket timing change. |
| Tables, Settings cards, shared fields | Replace all borders with shadows | These hairlines communicate structure, selection, or field boundaries; the project reserves elevation for overlays. |
| Graph and contextual icons | Add animated layout, icon swaps, or `will-change` | Static graph positioning and consistent Lucide states are deliberate. No runtime stutter was measured. |
| ChatMarkdown body paragraphs | Apply pretty/balanced wrapping to all generated prose | Long responses and streaming updates should not incur paragraph-wide balancing. The change is limited to headings and bounded prose overflow. |

## Verification

- Focused Graph, app-shell, and Chat DOM tests: 56 passed, including actual DOM
  focus and Enter/Space navigation to an interaction.
- Focused brain-switcher DOM tests: 5 passed, covering deferred switch/reveal,
  disabled competing actions, Escape, failures, retries, and alternate-folder recovery.
- Focused task completion/detail/Settings tests: 37 passed, including retention of
  the same checkbox during pending and successful completion.
- `pnpm --filter @local-brain/desktop test src/components/detail-page.dom.test.tsx src/components/chat/chat-markdown.test.tsx src/components/feedback.dom.test.tsx`:
  9 passed.
- `pnpm check`: passed typechecking, lint, and 785 tests (398 desktop, 362 core,
  4 database, and 21 release-workflow tests).
- `pnpm build`: passed; Vite retains the existing large-chunk advisory.
- `git diff --check`: passed.

**Not verified:** rendered narrow-window geometry and actual target measurements;
light/dark visual contrast; browser hover/active/focus appearance; assistive-technology
behavior in the native WebView; reduced-motion playback and animations at 10% speed;
runtime performance. DOM tests establish behavior, not those visual properties.

**Verdict: Approve — source and automated-test review.** No actionable findings
remain in the inspected scope. Not verified: rendered layout and target geometry,
theme contrast, browser states, native assistive technology, reduced/slowed motion,
and runtime performance, as listed above.
