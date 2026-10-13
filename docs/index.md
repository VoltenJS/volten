---
# https://vitepress.dev/reference/default-theme-home-page
layout: home

hero:
  name: "Volten"
  text: "Simple, Modern, Fast."
  tagline: "A zero-runtime-dependency HTTP framework for Node.js and Web Fetch-compatible runtimes."
  image:
    src: /logo.svg
    alt: Volten Logo
  actions:
    - theme: brand
      text: Get Started
      link: /getting-started
    - theme: alt
      text: Express Migration Guide
      link: /guide/express-migration
    - theme: alt
      text: View on GitHub
      link: https://github.com/VoltenJS/volten

features:
  - title: 🚦 Adaptive Traffic Triage
    details: Optionally monitor event-loop delay and shed requests by route priority when triage enters WARNING or CRITICAL states. This is load shedding, not a guarantee of availability.
    link: /guide/adaptive-traffic-triage
  - title: 🏎️ Compiled Route Matching
    details: Node.js builds a matcher from the radix route tree, including a conditional static-route fast path for case-sensitive requests without query strings.
  - title: 🪶 0 Dependencies
    details: Uses native Node.js and Web platform APIs with no runtime package dependencies; this reduces package dependency risk but does not eliminate all supply-chain risk.
  - title: 🧠 Native Context (ctx)
    details: Say goodbye to messy `req` and `res` objects. Everything you need is encapsulated in a powerful, strongly-typed `ctx` object.
  - title: ☁️ Edge Ready
    details: Built with modern Web APIs in mind, allowing you to deploy to Edge environments seamlessly.
---

<div class="hero-badges-wrapper" style="display: flex; justify-content: center; align-items: center; gap: 8px; flex-wrap: wrap; margin: 1.5rem auto 2.5rem; max-width: 900px; padding: 0 1rem;">
  <a href="https://www.npmjs.com/package/volten" target="_blank" rel="noopener noreferrer">
    <img src="https://img.shields.io/npm/v/volten?color=0ea5e9&label=npm&logo=npm" alt="npm version" />
  </a>
  <img src="https://img.shields.io/badge/dependencies-0-10b981?style=flat&logo=buffer" alt="0 dependencies" />
  <a href="https://github.com/VoltenJS/volten/blob/main/LICENSE" target="_blank" rel="noopener noreferrer">
    <img src="https://img.shields.io/badge/license-MIT-0284c7?style=flat" alt="MIT License" />
  </a>
  <a href="https://www.npmjs.com/package/volten" target="_blank" rel="noopener noreferrer">
    <img src="https://img.shields.io/npm/dm/volten?color=38bdf8" alt="monthly downloads" />
  </a>
  <img src="https://img.shields.io/badge/node-%3E%3D22.0.0-64748b?logo=node.js&logoColor=white" alt="node >= 22" />
  <a href="https://github.com/VoltenJS/volten" target="_blank" rel="noopener noreferrer">
    <img src="https://img.shields.io/github/stars/VoltenJS/volten?style=social" alt="GitHub Stars" />
  </a>
</div>

<div class="landing-playground-section">
  <div class="playground-intro">
    <div class="playground-badge">⚡ Instant WebContainer Runtime</div>
    <h2 class="playground-heading">Try Volten Live in Your Browser</h2>
    <p class="playground-subheading">
      Experience raw throughput, zero cold-start HTTP routing, and JIT serialization running directly on in-browser Node.js WebContainers.
    </p>
  </div>
  <ClientOnly>
    <LivePlayground />
  </ClientOnly>
</div>
