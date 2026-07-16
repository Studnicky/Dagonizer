## PrimeVue component boundary

Generic interaction primitives use PrimeVue as the implementation substrate. Dagonizer-specific workflow and visualization surfaces stay repository-owned.

### PrimeVue-owned or PrimeVue-backed primitives

- `site/src/components/islands/MarketingTopNav.vue`
  - PrimeVue `Menubar`, `Menu`, `Drawer`, `Button`
  - owns site navigation behavior, not graph behavior
- `site/src/components/islands/HomeIntakeForm.vue`
  - PrimeVue `Card`, `Select`, `InputText`, `Textarea`, `Button`
- `site/src/components/islands/HomeFaqs.vue`
  - PrimeVue `Card`, `Accordion`
- `site/src/components/islands/HomeUseCasesPanel.vue`
  - PrimeVue `Card`, `Tabs`, `TabList`, `TabPanels`, `Tag`
- `site/src/components/islands/DocsBrowser.vue`
  - PrimeVue `InputText`, `Select`, `Tabs`
- `site/src/components/islands/UiActionLink.vue`
  - PrimeVue `Button`
- `site/src/components/islands/UiFactTags.vue`
  - PrimeVue `Tag`
- `site/src/components/islands/UiLinkCard.vue`
  - PrimeVue `Card`
- `site/src/components/islands/UiAsideCard.vue`
  - PrimeVue `Card`
- `site/src/components/islands/UiContentPanel.vue`
  - PrimeVue `Card`
- `site/src/components/islands/UiPanelShell.vue`
  - PrimeVue `Card`
- `site/src/components/islands/UiDocResultCard.vue`
  - PrimeVue `Card`, `Tag`, `Button`
- `site/src/components/islands/UiMarketingCardGrid.vue`
  - PrimeVue `Card`, `Tag`, shared `UiLinkCard`
- `site/src/components/islands/UiPageHeader.vue`
  - PrimeVue `Breadcrumb`
- `site/src/components/islands/UiProofStrip.vue`
  - PrimeVue `Tag`
- `site/src/components/islands/UiProofGrid.vue`
  - PrimeVue `Card`

### Keep custom composition and domain surfaces

- `site/src/components/islands/VisualizationPlayground.vue`
  - Dagonizer visualization UX and runtime-specific controls
- `site/src/components/islands/LazyArchivistRunner.vue`
- `site/src/components/islands/LazyCartographerRunner.vue`
- `site/src/components/islands/LazyDispatcherRunner.vue`
  - runtime/example island boundaries
- `site/src/components/islands/UiControlPanel.vue`
  - local orchestration/inspection framing
- `site/src/components/islands/UiHeroShell.vue`
- `site/src/components/islands/UiSectionIntro.vue`
- `site/src/components/islands/UiProofStrip.vue`
- `site/src/components/islands/UiProofGrid.vue`
- `site/src/components/islands/UiCtaRow.vue`
  - repository-owned layout/composition primitives; some are built on PrimeVue internals, but their API stays Dagonizer-owned because they encode site framing rather than generic widget behavior

### Rule

- generic UI primitive → PrimeVue
- DAG/runtime/visualization/brand composition primitive → custom
