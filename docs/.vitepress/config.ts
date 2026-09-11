import { withMermaid } from "vitepress-plugin-mermaid";
// @ts-ignore: no types available for markdown-it-katex
import katex from "markdown-it-katex";

// https://vitepress.dev/reference/site-config
export default withMermaid({
  vite: {
    optimizeDeps: {
      include: ["mermaid", "dayjs", "@braintree/sanitize-url"],
    },
    plugins: [
      {
        name: "isolation-headers",
        configureServer(server) {
          server.middlewares.use((_req, res, next) => {
            res.setHeader("Cross-Origin-Embedder-Policy", "credentialless");
            res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
            next();
          });
        },
      },
    ],
  },
  markdown: {
    config: (md) => {
      md.use(katex);
    },
  },
  title: "Volten",
  description: "A 0-dependency Node.js HTTP framework that is simple, modern, and fast.",
  ignoreDeadLinks: true,
  head: [
    ["link", { rel: "icon", type: "image/svg+xml", href: "/logo.svg" }],
    [
      "link",
      {
        rel: "stylesheet",
        href: "https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css",
      },
    ],
  ],
  themeConfig: {
    logo: "/logo.svg",
    search: {
      provider: "local",
    },
    editLink: {
      pattern: "https://github.com/VoltenJS/volten/edit/main/docs/:path",
      text: "Edit this page on GitHub",
    },
    footer: {
      message: "Released under the MIT License.",
      copyright: "Copyright © 2026 Volten Contributors. Built for raw speed.",
    },
    nav: [
      { text: "Home", link: "/" },
      { text: "Guide", link: "/getting-started" },
      { text: "API Reference", link: "/api/configuration" },
    ],
    sidebar: [
      {
        text: "Features",
        items: [
          {
            text: "Adaptive Traffic Triage",
            link: "/guide/adaptive-traffic-triage",
          },
        ],
      },
      {
        text: "Introduction",
        items: [
          {
            text: "Getting Started",
            link: "/getting-started",
          },
          {
            text: "Express to Volten",
            link: "/guide/express-migration",
          },
        ],
      },
      {
        text: "Routing",
        items: [
          {
            text: "Overview",
            link: "/guide/routing/overview",
          },
          {
            text: "Route Registration",
            link: "/guide/routing/route-registration",
          },
          {
            text: "Case Sensitivity",
            link: "/guide/routing/case-sensitivity",
          },
          {
            text: "Route Parameters (:param)",
            link: "/guide/routing/route-parameters-param",
          },
          {
            text: "Wildcards & Catch-All Routes ()",
            link: "/guide/routing/wildcards-catch-all-routes",
          },
          {
            text: "Sub-Routers (Router)",
            link: "/guide/routing/sub-routers-router",
          },
          {
            text: "Route Options",
            link: "/guide/routing/route-options",
          },
          {
            text: "Multiple Route Handlers",
            link: "/guide/routing/multiple-route-handlers",
          },
        ],
      },
      {
        text: "Middleware",
        items: [
          {
            text: "Overview",
            link: "/guide/middleware/overview",
          },
          {
            text: "The Middleware Signature",
            link: "/guide/middleware/the-middleware-signature",
          },
          {
            text: "The Onion Execution Model",
            link: "/guide/middleware/the-onion-execution-model",
          },
          {
            text: "High-Performance Compiled Chains",
            link: "/guide/middleware/high-performance-compiled-chains",
          },
          {
            text: "Global Middleware",
            link: "/guide/middleware/global-middleware",
          },
          {
            text: "Router-Level Scoped Middleware",
            link: "/guide/middleware/router-level-scoped-middleware",
          },
          {
            text: "Route-Specific Middleware",
            link: "/guide/middleware/route-specific-middleware",
          },
          {
            text: "Short-Circuiting the Pipeline",
            link: "/guide/middleware/short-circuiting-the-pipeline",
          },
          {
            text: "Guardrails & Execution Safety",
            link: "/guide/middleware/guardrails-execution-safety",
          },
          {
            text: "State Sharing with ctx.state",
            link: "/guide/middleware/state-sharing-with-ctx-state",
          },
          {
            text: "Preflight Handlers (app.preflight)",
            link: "/guide/middleware/preflight-handlers-app-preflight",
          },
          {
            text: "Common Middleware Patterns",
            link: "/guide/middleware/common-middleware-patterns",
          },
        ],
      },
      {
        text: "Body Parsing & Uploads",
        items: [
          {
            text: "Overview",
            link: "/guide/body-parsing-and-uploads/overview",
          },
          {
            text: "Lazy Parsing: Zero Overhead by Default",
            link: "/guide/body-parsing-and-uploads/lazy-parsing-zero-overhead-by-default",
          },
          {
            text: "Parsing JSON",
            link: "/guide/body-parsing-and-uploads/parsing-json",
          },
          {
            text: "Parsing URL-Encoded Forms",
            link: "/guide/body-parsing-and-uploads/parsing-url-encoded-forms",
          },
          {
            text: "Parsing Raw Text",
            link: "/guide/body-parsing-and-uploads/parsing-raw-text",
          },
          {
            text: "Streaming Large Payloads with ctx.bodyStream",
            link: "/guide/body-parsing-and-uploads/streaming-large-payloads-with-ctx-bodystream",
          },
          {
            text: "Multipart Form Data & File Uploads",
            link: "/guide/body-parsing-and-uploads/multipart-form-data-file-uploads",
          },
          {
            text: "Configuring Body Size Limits",
            link: "/guide/body-parsing-and-uploads/configuring-body-size-limits",
          },
        ],
      },
      {
        text: "Context (ctx)",
        items: [
          {
            text: "Overview",
            link: "/guide/context/overview",
          },
          {
            text: "Dual Runtime Portability",
            link: "/guide/context/dual-runtime-portability",
          },
          {
            text: "Zero-Allocation Context Pooling",
            link: "/guide/context/zero-allocation-context-pooling",
          },
          {
            text: "Request Inspection Properties",
            link: "/guide/context/request-inspection-properties",
          },
          {
            text: "Response Methods",
            link: "/guide/context/response-methods",
          },
          {
            text: "Header Manipulation",
            link: "/guide/context/header-manipulation",
          },
          {
            text: "Cookie Management",
            link: "/guide/context/cookie-management",
          },
          {
            text: "Request Body & Streaming",
            link: "/guide/context/request-body-streaming",
          },
          {
            text: "File Serving & Downloads (Node.js)",
            link: "/guide/context/file-serving-downloads-node-js",
          },
          {
            text: "Per-Request State (ctx.state)",
            link: "/guide/context/per-request-state-ctx-state",
          },
        ],
      },
      {
        text: "Error Handling",
        items: [
          {
            text: "Overview",
            link: "/guide/error-handling/overview",
          },
          {
            text: "The Error Pipeline",
            link: "/guide/error-handling/the-error-pipeline",
          },
          {
            text: "Built-in Errors",
            link: "/guide/error-handling/built-in-errors",
          },
          {
            text: "Default Error Handler",
            link: "/guide/error-handling/default-error-handler",
          },
          {
            text: "Custom Error Handling with app.onError",
            link: "/guide/error-handling/custom-error-handling-with-app-onerror",
          },
          {
            text: "Creating Custom Application Errors",
            link: "/guide/error-handling/creating-custom-application-errors",
          },
        ],
      },
      {
        text: "Static Files",
        items: [
          {
            text: "Serving Static Files",
            link: "/guide/static-files",
          },
        ],
      },
      {
        text: "API Reference",
        items: [
          {
            text: "Configuration",
            link: "/api/configuration",
          },
          {
            text: "Performance & JIT",
            link: "/api/performance",
          },
          {
            text: "Edge Compatibility",
            link: "/api/edge-compatibility",
          },
          {
            text: "Logging",
            link: "/api/logging",
          },
        ],
      },
    ],
    socialLinks: [{ icon: "github", link: "https://github.com/VoltenJS/volten" }],
  },
});
