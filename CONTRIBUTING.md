<p align="center">
  <img src="https://github.com/VoltenJS/volten/blob/main/.github/voltenLogo.png?raw=true" alt="Volten Logo" width="500" style="margin-bottom: -80px;" />
</p>

<h1 align="center">Contributing to Volten ⚡</h1>

<p align="center">
  <strong>First off, thank you for taking the time to contribute!</strong>
</p>

<p align="center">
  It's developers like you who will help turn Volten from a cool experimental project into a stable, production-ready framework. Volten is built for performance nerds, minimalist engineers, and anyone who loves pushing the Node.js standard library to its absolute limits.
</p>

---

## Our Core Philosophy: Strictly 0-Dependencies

Volten's primary promise is **absolute zero third-party production dependencies**.

```text
volten/
└─ 🔒 No nested node_modules
└─ 🔒 No sudden security deprecations
└─ 🔒 100% auditable source code
```

- **Rule #1:** Every feature, utility, parser, or router element must be written using nothing but the **Node.js Core API** (e.g., `node:http`, `node:buffer`, `node:stream`, `node:path`).
- **Rule #2:** Pull Requests that attempt to add a new package to the `dependencies` object in `package.json` will be immediately closed.
- **Rule #3 (The Exception):** Adding packages to `devDependencies` for linting, testing, formatting, or build tooling is completely fine, but please open an issue to discuss it first!

> 💡 **The Volten Challenge:** If a feature seems to "require" an external library, challenge yourself to write a lightweight, hyper-focused version of it using raw Node primitives. That's where the fun of this project lives!

---

## Technical Constraints & Standards

Because we rely strictly on Node.js core modules, contributors must adhere to these performance and security standards:

- **Prefer Streams over Buffers:** For request/response bodies and file handling, always use `node:stream` or the newer Web Streams API. Avoid loading entire payloads into memory (`Buffer.concat`) unless absolutely necessary.
- **Async by Default:** Never use synchronous methods (e.g., `fs.readFileSync`) in runtime code. Use the promises-based core APIs (`node:fs/promises`).
- **Strict TypeScript:** We compile with `strict: true`. Avoid using `any` type assertions. If a type is unknown, use `unknown` and implement proper type guards.
- **Security First:** Because we write our own parsers and utilities, you must manually handle edge cases like prototype pollution, malicious payload sizes, and URI malformations.

---

## Local Development Setup

To get the codebase running locally on your machine, follow these steps:

### 1. Fork and Clone the Repository

```bash
git clone https://github.com/VoltenJS/volten.git
cd volten
```

### 2. Install Dev Dependencies

Even though Volten has zero runtime dependencies, we use essential development tools to compile our TypeScript source and keep code formatted.

```bash
# We use pnpm, but feel free to use your preferred package manager locally
pnpm install
```

### 3. Live Development Testing

You can modify any file in the `src` folder and test your active changes in real-time by using the test runner or running the framework sandbox:

```bash
pnpm run dev
```

---

## Flow for Submitting Pull Requests (PRs)

We want to make the code review process as smooth and rewarding as possible:

| Step  | Action                   | Description                                                                                                                                                                    |
| :---- | :----------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1** | **Find an Issue**        | Check our GitHub Issues tab. Look for tags like `good first issue` or `help wanted`. For brand new features, **please open a feature request issue first** to align on design. |
| **2** | **Create a Branch**      | Give your branch a descriptive, structural name matching our schema (see below).                                                                                               |
| **3** | **Write Idiomatic Code** | Keep your functions focused, lean, and highly performant. Ensure formatting aligns with rules.                                                                                 |
| **4** | **Run Build & Format**   | Compile typescript targets and pass lint boundaries cleanly.                                                                                                                   |
| **5** | **Test Your Changes**    | Verify your changes against the 10 reference examples located in the `./examples` folder.                                                                                      |
| **6** | **Submit the PR**        | Fill out the PR template completely. Detail what changed, why, and performance impacts.                                                                                        |

### Branch Naming Conventions

- `feat/json-error-parser`
- `fix/router-trailing-slash`
- `docs/middleware-examples`

### Pre-Commit Validation Matrix

Before staging commits or opening up a review queue, ensure the local toolchain executes flawlessly:

```bash
pnpm run build   # Compiles ts source targets safely into ./dist
pnpm run lint    # Confirms zero static analysis rule violations
pnpm run format  # Enforces deterministic code format configurations
pnpm test        # Executes full multi-matrix coverage validation
```

---

## Code of Conduct

Be kind, respectful, and highly collaborative. We are all here to learn, build incredibly optimized software, and experiment with low-level Node.js engineering. Hostile, dismissive, or elitist behavior will not be tolerated.

Let's build something fast together!

---

## License

MIT © VoltenJS
