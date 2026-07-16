## PrimeVue component boundary

Use PrimeVue for generic interaction surfaces. Keep repository-owned components where they encode Dagonizer-specific behavior, domain semantics, or site framing.

The implementation rule is:

- generic UI primitive → PrimeVue
- Dagonizer workflow / graph / runtime / marketing composition primitive → ours

That means a component can still be repository-owned even when it uses PrimeVue internally. The ownership boundary is about API and responsibility, not whether `primevue/*` appears in the imports.

### PrimeVue-owned primitives

These should stay thin and generic. Their public API should track generic web UI needs, not Dagonizer semantics.

- `site/src/components/islands/MarketingTopNav.vue`
  - PrimeVue `Menubar`, `Menu`, `Drawer`, `Button`
  - generic site navigation surface
- `site/src/components/islands/UiActionLink.vue`
  - PrimeVue `Button`
  - generic CTA and link-button primitive
- `site/src/components/islands/UiFactTags.vue`
  - PrimeVue `Tag`
  - generic tag rendering
- `site/src/components/islands/UiLinkCard.vue`
  - PrimeVue `Card`
  - generic linked card shell
- `site/src/components/islands/UiAsideCard.vue`
  - PrimeVue `Card`
  - generic side-rail content shell
- `site/src/components/islands/UiContentPanel.vue`
  - PrimeVue `Card`
  - generic content panel shell
- `site/src/components/islands/UiPanelShell.vue`
  - PrimeVue `Card`
  - generic panel frame
- `site/src/components/islands/UiDocResultCard.vue`
  - PrimeVue `Card`, `Tag`, `Button`
  - generic result-card pattern
- `site/src/components/islands/UiPageHeader.vue`
  - PrimeVue `Breadcrumb`
  - generic breadcrumb/page-header primitive

### PrimeVue-backed site composition

These stay repository-owned because their API is Dagonizer-specific, but they should keep relying on PrimeVue as their generic control substrate.

- `site/src/components/islands/HomeHeroSection.vue`
  - PrimeVue `Card`, `Tag`
  - hero-specific copy framing and visual hierarchy
- `site/src/components/islands/HomeFaqs.vue`
  - PrimeVue `Card`, `Accordion`
  - FAQ composition, not a raw accordion primitive
- `site/src/components/islands/HomeUseCasesPanel.vue`
  - PrimeVue `Card`, `Tabs`, `Tag`
  - use-case framing around generic tab primitives
- `site/src/components/islands/HomeIntakeForm.vue`
  - PrimeVue `Card`, `Select`, `InputText`, `Textarea`, `Button`
  - marketing/evaluation flow, not a reusable form-kit abstraction
- `site/src/components/islands/DocsBrowser.vue`
  - PrimeVue `InputText`, `Select`, `Tabs`
  - docs navigation and search behavior are site-owned
- `site/src/components/islands/UiMarketingCardGrid.vue`
  - PrimeVue `Card`, `Tag`, shared `UiLinkCard`
  - marketing grid composition
- `site/src/components/islands/UiProofStrip.vue`
  - PrimeVue `Tag`
  - Dagonizer proof/metadata framing
- `site/src/components/islands/UiProofGrid.vue`
  - PrimeVue `Card`
  - Dagonizer proof/metadata framing
- `site/src/components/islands/UiHeroShell.vue`
  - PrimeVue `Card`
  - hero layout API stays repository-owned
- `site/src/components/islands/UiControlPanel.vue`
  - PrimeVue `Card`
  - control-panel layout API stays repository-owned
- `site/src/components/islands/SectionShell.vue`
  - PrimeVue `Card`
  - section framing stays repository-owned

### Keep custom and domain-specific

These components should not be flattened into generic PrimeVue wrappers because they encode graph/runtime semantics or reusable Dagonizer interaction models.

- `site/src/components/islands/VisualizationPlayground.vue`
  - keep repository-owned
  - may use PrimeVue for tabs, selects, and buttons internally
  - the component API and behavior are Dagonizer-specific
- `site/src/components/islands/LazyArchivistRunner.vue`
- `site/src/components/islands/LazyCartographerRunner.vue`
- `site/src/components/islands/LazyDispatcherRunner.vue`
  - example/runtime island boundaries
- `site/src/components/islands/UiCtaRow.vue`
  - layout composition primitive for site CTA grouping
- `site/src/components/islands/UiSectionIntro.vue`
  - section framing primitive

### Astro marketing shell

These are not candidates for direct PrimeVue replacement. They are the Astro page composition layer and should consume the Vue island primitives above.

- `site/src/components/marketing/TopNav.astro`
- `site/src/components/marketing/HomeHero.astro`
- `site/src/components/marketing/HomeArchitecture.astro`
- `site/src/components/marketing/HomeExamples.astro`
- `site/src/components/marketing/HomeFeatureGrid.astro`
- `site/src/components/marketing/HomePositioning.astro`
- `site/src/components/marketing/HomeProofBand.astro`
- `site/src/components/marketing/DocPageShell.astro`
- `site/src/components/marketing/DocsArticleShell.astro`
- `site/src/components/marketing/DocSections.astro`
- `site/src/components/marketing/MarketingFooter.astro`

### Practical migration rule for upcoming work

When touching a component:

- if it mainly exists to render a button, tab set, card, tag, drawer, menu, field, or dialog, migrate it onto PrimeVue
- if it mainly exists to express Dagonizer structure, proof, examples, graph controls, docs semantics, or marketing composition, keep the component and only use PrimeVue underneath it where useful

### Current next candidates

- continue moving generic form and disclosure surfaces onto PrimeVue first
- keep visualization controls repository-owned, but continue replacing raw generic controls inside them with PrimeVue controls where it improves consistency
- avoid creating new hand-rolled generic button, card, tag, tab, or menu abstractions unless the wrapper adds real Dagonizer semantics
