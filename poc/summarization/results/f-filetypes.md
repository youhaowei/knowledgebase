# F: Non-TypeScript File Types

## README.md (markdown)

_395 lines, structure 642 chars (7% of 9385)_

**Header Structure:**
```
# 🧠 Knowledgebase
## ✨ Features
## 🚀 Quick Start (5 minutes)
### 1. Install
### 2. Start Services
### 3. Configure
### 4. Run
## 📱 Access Methods
### 1. Web Interface (Svelte + Tailwind)
### 2. MCP Tools (Claude Code)
### 3. tRPC API (Type-Safe)
## 🏗️ How It Works
### Data Model
### Item Types
### Relation Types
### Conflict Handling
## 🎨 Design System
## 🛠️ Tech Stack
## 📁 Project Structure
## 🧪 Development
## 🔧 Configuration
## 📊 Example Workflow
## 🐛 Troubleshooting
### Neo4j Connection Failed
### Ollama Model Not Found
### Web Interface Not Loading
### Claude Extraction Fails
## 🤝 Contributing
## 📄 License
## 🔗 Links
```

**Structure→LLM** _(11843ms)_:
This `README.md` serves as the primary documentation for a Knowledgebase project built with Svelte, Tailwind, and Neo4j, detailing its features, installation steps, and architectural design. Key sections include the **Quick Start** guide covering service initialization and configuration via `.env`, the **How It Works** breakdown explaining data models, item types, and conflict resolution strategies, and a **Troubleshooting** area addressing specific issues like Neo4j connection failures or Ollama model errors. Developers and system administrators reference this file to understand the tech stack, configure the tRPC API and MCP tools for Claude Code integration, and resolve runtime errors during deployment or development.

**Full LLM** _(23750ms)_:
This `README.md` documents the **Knowledgebase**, a personal knowledge graph system that automatically extracts entities and relations from text to store them in a Neo4j database with vector embeddings. Key sections include installation instructions for local services like **Neo4j** (via Docker) and **Ollama**, configuration details for environment variables such as `CLAUDE_CODE_OAUTH_TOKEN` and `NEO4J_PASSWORD`, and usage guides for three access methods: a **Svelte web interface**, **MCP tools** for Claude Code, and a **TypeScript tRPC API**. Developers and users would reference this file to understand the project's architecture, deploy the local stack, configure authentication tokens, and utilize semantic search capabilities or resolve detected conflicts in their personal knowledge graph.

## DESIGN_SYSTEM.md (markdown)

_700 lines, structure 1312 chars (8% of 16400)_

**Header Structure:**
```
# Knowledgebase Design System
## 🎨 Design Philosophy
## 🌈 Color System
### Base Colors (Dark Theme)
### Accent Colors (Neon Glow)
### Text Colors
### Semantic Colors
## 📝 Typography
### Font Families
### Font Scale
### Best Practices
## 📐 Spacing Scale
## 🔘 Border Radius
## 🌑 Shadow System
## ✨ Animation System
### Keyframes
#### fadeIn
#### pulseGlow
#### animate-in
### Animation Principles
## 🧩 Component Patterns
### Buttons
#### Primary (CTA)
#### Secondary
### Cards
### Inputs
### Stats Pill
## 🎯 Interaction States
### State Matrix
### Hover Guidelines
## 🌐 Graph Visualization
### Physics Parameters
### Node Colors
### Link Styling
### Node Styling
### Label Backgrounds
## 📱 Responsive Breakpoints
### Common Patterns
## ♿ Accessibility
### Color Contrast
### Focus States
### Keyboard Navigation
## 🎭 Backdrop Effects
### Glass Morphism
### Noise Texture
### Gradient Background
## 📦 Component Library
### StatsOverlay
### CommandPalette
### Graph
## 🚀 Performance Guidelines
### Animation Performance
### Loading Strategy
## 📝 Code Style
### Tailwind Order
### Example
## 🎨 Design Tokens Reference
### Quick Reference Card
## 🎯 Usage Examples
### Full Page Layout
### Modal Pattern
## 🔧 Maintenance
### Adding New Colors
### Updating Components
### Version Control
## 📚 Resources
```

**Structure→LLM** _(12620ms)_:
This file, `DESIGN_SYSTEM.md`, establishes the comprehensive visual and interactive standards for a dark-themed application featuring neon accents and glass morphism effects. It details specific configurations including the "Color System" with base and semantic palettes, the "Animation System" defining keyframes like `pulseGlow`, and graph visualization parameters such as node styling and physics settings. Frontend developers and UI designers reference this document to ensure consistent implementation of components like the `StatsOverlay` and `CommandPalette` while adhering to accessibility guidelines for focus states and keyboard navigation. The guide also provides maintenance instructions for updating design tokens and adding new colors, ensuring the codebase remains performant and visually cohesive across responsive breakpoints.

**Full LLM** _(34429ms)_:
This file documents the **Knowledgebase Design System**, establishing a neon cyber aesthetic through CSS variables, typography scales, and component patterns for a dark-themed application. It defines specific design tokens including base colors like `--color-void` and `--color-abyss`, accent glows such as `--color-glow-cyan`, and animation keyframes like `fadeIn` and `pulseGlow`. The document also details graph visualization parameters for the force-directed layout, responsive breakpoints, accessibility standards, and Tailwind class ordering conventions. Developers and designers reference this guide to ensure visual consistency across the interface, while frontend engineers use it to implement interactive elements like the `CommandPalette` and `StatsOverlay` components correctly.

## CLAUDE.md (markdown)

_196 lines, structure 296 chars (3% of 9661)_

**Header Structure:**
```
# CLAUDE.md
## Project Overview
## Commands
## Architecture
### Data Model: Edge-as-Fact (Graphiti-style)
### Contradiction Handling
### Key Design Decisions
### Retro Integration
### Storage Backend
### Core Files
### Graph Model
### MCP Tools
## Code Conventions
## Bun-Specific
## Dependencies
```

**Structure→LLM** _(12236ms)_:
This `CLAUDE.md` file serves as a comprehensive instruction manual for the AI assistant, defining the project's Edge-as-Fact architecture and specific constraints for the Bun runtime environment. It details critical sections including "Data Model: Edge-as-Fact," which enforces a graphiti-style graph structure, alongside dedicated subsections for "Contradiction Handling," "Retro Integration," and "MCP Tools" to guide logical reasoning and tool usage. The document further specifies "Code Conventions," "Bun-Specific" configurations, and dependency management rules to ensure consistent development practices. Developers and the AI agent itself reference this file to maintain architectural integrity, resolve graph contradictions correctly, and adhere to the defined coding standards within the Bun ecosystem.

**Full LLM** _(30567ms)_:
This `CLAUDE.md` file configures the Knowledgebase project, a personal knowledge graph that auto-extracts entities and edges from text using dual vector embeddings (Ollama primary, HuggingFace fallback) for semantic search via Web UI, MCP tools, and REST API. It documents key architectural decisions such as the "Edge-as-Fact" model where facts are `RELATES_TO` relationships with sentiment scoring (-1 to 1), manual contradiction resolution via `forgetEdge`, and a `GraphProvider` interface supporting both embedded LadybugDB and remote Neo4j backends. Developers and AI agents reference this file to understand specific commands like `bun run db:reembed`, adhere to code conventions using Zod schemas in `src/types.ts` and `@/*` path aliases, and utilize MCP tools (`add`, `search`, `forget`) for interacting with the graph. The guide also details Bun-specific behaviors, including handling LadybugDB native addon cleanup requirements and running CLI tests in isolated processes.

## tsconfig.json (json)

_17 lines, structure 252 chars (72% of 351)_

**Key Structure:**
```
{
  compilerOptions: {
    jsx: "react-jsx"
    moduleResolution: "Bundler"
    module: "ESNext"
    target: "ES2022"
    skipLibCheck: true
    strictNullChecks: true
    strict: true
    paths: {1 keys}
  }
  include: [2 items]
  exclude: [3 items]
}
```

**Structure→LLM** _(11536ms)_:
This `tsconfig.json` file configures the TypeScript compiler options for a React-based project, specifically targeting ES2022 and utilizing the "Bundler" module resolution strategy. Key settings enforce strict type checking with `strict: true` and `strictNullChecks: true`, while defining custom path aliases to resolve imports efficiently. The configuration explicitly includes source files in two directories while excluding node_modules, build outputs, and test environments from compilation. Developers reference this file during setup or refactoring to ensure consistent build behavior, correct JSX transformation via the "react-jsx" pragma, and adherence to strict type safety standards across the codebase.

**Full LLM** _(10795ms)_:
This `tsconfig.json` file configures the TypeScript compiler options for a React-based project using Vite, specifically enabling `react-jsx` transformation and setting the module resolution to `Bundler`. Key settings enforce strict type checking with `"strict": true` and `"strictNullChecks": true`, while targeting ES2022 and utilizing path aliases like `"@/*"` that map to the `./src` directory. Developers reference this file during build or linting processes to ensure consistent compilation behavior, resolve imports correctly via the defined paths, and exclude unnecessary directories such as `node_modules` from type checking.

## components.json (json)

_21 lines, structure 360 chars (89% of 406)_

**Key Structure:**
```
{
  $schema: "https://ui.shadcn.com/schema.json"
  style: "new-york"
  rsc: false
  tsx: true
  tailwind: {
    config: ""
    css: "web/styles.css"
    baseColor: "zinc"
    cssVariables: true
  }
  aliases: {
    components: "@/components"
    utils: "@/lib/utils"
    ui: "@/components/ui"
    lib: "@/lib"
    hooks: "@/hooks"
  }
  iconLibrary: "lucide"
}
```

**Structure→LLM** _(10846ms)_:
This `components.json` file configures the design system and import paths for a project using the shadcn/ui framework. It explicitly sets the visual style to "new-york", disables React Server Components (`rsc: false`), and enables TypeScript support (`tsx: true`). The configuration defines Tailwind CSS settings including the `zinc` base color palette, points to `web/styles.css` for custom styles, and establishes path aliases for components, utilities, hooks, and libraries. Developers reference this file during setup or refactoring to ensure consistent UI theming and to correctly resolve imports across the codebase.

**Full LLM** _(10960ms)_:
This `components.json` file configures the Shadcn UI component registry, defining the project's design system and import aliases. It specifies the "new-york" style variant, disables React Server Components (`rsc: false`), and sets Tailwind CSS to use the "zinc" base color with CSS variables enabled. The configuration maps logical paths like `@/components` and `@/lib/utils` to their actual locations while designating Lucide as the icon library. Developers reference this file to ensure consistent UI theming, resolve component imports correctly, and maintain alignment with the project's specific Tailwind and Shadcn setup.

## package.json (json)

_78 lines, structure 2276 chars (92% of 2478)_

**Key Structure:**
```
{
  name: "knowledgebase"
  module: "index.ts"
  type: "module"
  private: true
  bin: {
    kb: "src/cli.ts"
  }
  exports: {
    ./mcp: "./src/mcp-server.ts"
    ./operations: "./src/operations.ts"
    ./types: "./src/types.ts"
  }
  scripts: {
    dev: "vite dev"
    build: "vite build"
    db:init: "bun run src/lib/init-db.ts"
    db:reembed: "bun run src/lib/reembed.ts"
    db:backfill: "bun run src/lib/reembed.ts --backfill"
    db:reextract: "bun run src/lib/reextract.ts"
    test: "bun test test/types.test.ts test/embedder.test.ts test/fallback-embedder.test.ts test/intent.test.ts && bun test test/provider.test.ts"
    test:cli: "bun test test/cli.test.ts"
    test:all: "bun test test/types.test.ts test/embedder.test.ts test/fallback-embedder.test.ts test/intent.test.ts && bun test test/provider.test.ts && bun test test/cli.test.ts"
    lint: "eslint ."
    kb: "bun run src/cli.ts"
    kb-test: "bun run src/cli.ts --env test"
  }
  devDependencies: {
    @eslint/js: "^9.18.0"
    @types/bun: "latest"
    @types/react: "^19.2.7"
    @types/react-dom: "^19.2.3"
    @types/vega: "^3.2.0"
    @typescript-eslint/eslint-plugin: "^8.18.2"
    @typescript-eslint/parser: "^8.18.2"
    autoprefixer: "^10.4.23"
    eslint: "^9.18.0"
    eslint-plugin-sonarjs: "^3.0.5"
    prettier: "3.7.4"
    tailwindcss: "^4.1.18"
    typescript-eslint: "^8.18.2"
  }
  peerDependencies: {
    typescript: "^5"
  }
  dependencies: {
    @fontsource-variable/geist: "^5.2.8"
    @fontsource-variable/geist-mono: "^5.2.7"
    @huggingface/transformers: "^3.8.1"
    @modelcontextprotocol/sdk: "^1.25.2"
    @radix-ui/react-slot: "^1.2.4"
    @tailwindcss/vite: "^4.1.18"
    @tanstack/react-router: "^1.146.0"
    @tanstack/react-start: "^1.146.0"
    @vitejs/plugin-react: "^5.1.2"
    class-variance-authority: "^0.7.1"
    clsx: "^2.1.1"
    lbug: "^0.14.3"
    lucide-react: "^0.562.0"
    neo4j-driver: "^6.0.1"
    react: "^19.2.3"
    react-dom: "^19.2.3"
    react-force-graph-2d: "^1.29.0"
    tailwind-merge: "^3.4.0"
    unifai: "github:youhaowei/unifai"
    vega: "^6.2.0"
    vega-embed: "^7.1.0"
    vinxi: "^0.5.10"
    vite: "^7.3.1"
    vite-tsconfig-paths: "^6.0.3"
    zod: "^4.3.5"
    zod-to-json-schema: "^3.25.1"
  }
  trustedDependencies: [1 items]
}
```

**Structure→LLM** _(18754ms)_:
This `package.json` file defines the build and runtime configuration for the "knowledgebase" project, a TypeScript-based knowledge management system utilizing Vite as its bundler. It establishes entry points via the `exports` field for modules like the MCP server (`./src/mcp-server.ts`) and operations logic, while defining scripts for development, database initialization (e.g., `db:init`, `db:backfill`), and comprehensive testing suites covering types, embedders, and CLI functionality. The file specifies a robust dependency stack including Neo4j for graph storage, Hugging Face Transformers for AI capabilities, TanStack Router for frontend navigation, and various tooling like ESLint, Prettier, and Tailwind CSS for code quality and styling. Developers and DevOps engineers reference this file to understand the project's architecture, execute build commands, manage database migrations, and run specific test scenarios to ensure system integrity.

**Full LLM** _(17863ms)_:
This `package.json` file configures the build, test, and runtime environment for a Knowledge Base application named "knowledgebase," utilizing Bun as its primary runtime. It defines key scripts such as `db:init` for database initialization using `src/lib/init-db.ts`, `build` for Vite compilation, and comprehensive test suites covering types, embedders, intents, and CLI functionality. The project relies heavily on React 19, TanStack Router, and Neo4j for graph data management, while exposing specific modules like the MCP server (`./mcp`) and operations logic via its `exports` configuration. Developers would reference this file to understand dependency versions (e.g., `@huggingface/transformers`, `zod`), execute local development commands, and verify that the application's core features like re-embedding and backfilling are properly wired up.

## eslint.config.js (config)

_11 lines, structure 197 chars (66% of 298)_

**Config Structure:**
```
import eslint from "@eslint/js";
import { defineConfig } from "eslint/config";
import sonarjs from "eslint-plugin-sonarjs";
import typescript from "typescript-eslint";
export default defineConfig([
```

**Structure→LLM** _(8881ms)_:
This `eslint.config.js` file defines the ESLint linting rules and plugins for a TypeScript project using the flat config format. It imports and integrates specific rule sets from `@eslint/js`, `eslint-plugin-sonarjs`, and `typescript-eslint` to enforce code quality standards. The configuration exports a default array containing these plugin definitions, enabling automated detection of bugs and security vulnerabilities via SonarJS rules alongside standard TypeScript linting. Developers and CI/CD pipelines reference this file to ensure consistent code style and maintain high reliability standards across the codebase.

**Full LLM** _(10189ms)_:
This file serves as the primary ESLint configuration entry point that aggregates and exports a unified linting rule set. It imports and applies three specific recommended configurations: `@eslint/js`, `typescript-eslint`, and `eslint-plugin-sonarjs` to enforce code quality standards across JavaScript, TypeScript, and security logic. The `defineConfig` array sequentially layers these rules, ensuring that the project adheres to best practices for syntax, type safety, and maintainability without defining custom overrides or specific rule severities. Developers and CI/CD pipelines reference this file during build processes to automatically detect and report violations before code is merged into the repository.

## vite.config.ts (config)

_19 lines, structure 314 chars (67% of 471)_

**Config Structure:**
```
import { defineConfig } from "vite";
import tsConfigPaths from "vite-tsconfig-paths";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
export default defineConfig({
  server: {
    port: 8000,
  plugins: [
```

**Structure→LLM** _(10613ms)_:
This `vite.config.ts` file configures the Vite build toolchain for a React application using TanStack Start. It integrates essential plugins including `@tanstack/react-start/plugin/vite`, `@vitejs/plugin-react`, and Tailwind CSS via `@tailwindcss/vite`, while also applying `vite-tsconfig-paths` to resolve TypeScript path aliases. The configuration explicitly sets the development server port to 8000 within the `server` object and defines a plugins array to orchestrate these dependencies. Developers and build engineers reference this file to customize compilation behaviors, manage asset handling, and ensure consistent environment setup across the project.

**Full LLM** _(10339ms)_:
This `vite.config.ts` file configures the Vite build toolchain for a React application using TanStack Start. It defines development server settings, such as running on port 8000, and registers five specific plugins in a strict execution order: `tsConfigPaths` for path aliasing, `tanstackStart` for SSR support, `viteReact` for JSX transformation, and `tailwindcss` for utility class processing. Developers referencing this file rely on it to ensure the correct build pipeline is active, particularly noting that the React plugin must be loaded after the TanStack Start plugin to prevent configuration conflicts.
