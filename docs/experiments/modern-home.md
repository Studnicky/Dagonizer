---
layout: doc
aside: false
title: Runtime overview
description: Typed orchestration for agent workflows, resumable pipelines, and explicit DAG execution.
hero:
  name: Dagonizer
  text: Typed orchestration, visible execution.
  tagline: 'Define agent workflows and data pipelines as explicit DAGs, inspect the run in motion, and resume from a durable cursor.'
  image:
    src: /dagonizer-icon.svg
    alt: Dagonizer
  actions:
    - theme: brand
      text: Get Started
      link: /getting-started
    - theme: alt
      text: Architecture
      link: /architecture
features:
  - icon: λ
    title: Typed graph contracts
    details: Route work through explicit ports, declared terminals, and runtime documents that remain stable as workflows evolve.
  - icon: ↻
    title: Durable resume
    details: Capture execution state, persist it outside process memory, and continue from the recorded cursor.
  - icon: ⬡
    title: First-class graph behavior
    details: Compose scatter, gather, embedded DAGs, streaming producers, and hand-offs without hiding control flow.
---

<ExperimentalHomeHero />
