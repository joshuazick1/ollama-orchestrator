# Contributing to Ollama Orchestrator

Thank you for your interest in contributing to the Ollama Orchestrator project! This document provides guidelines and instructions for setting up your development environment and submitting changes.

## Development Setup

### Prerequisites

- Node.js (v20 or higher)
- npm (v9 or higher)
- Docker and Docker Compose (optional, for containerized testing)

### Installation

1.  **Clone the repository:**

    ```bash
    git clone https://github.com/joshuazick1/ollama-orchestrator.git
    cd ollama-orchestrator
    ```

2.  **Install dependencies:**

    ```bash
    npm install
    ```

3.  **Configure environment:**
    Copy the example environment file and adjust as needed:
    ```bash
    cp .env.example .env
    ```

### Running Locally

To start the development server with hot-reloading:

```bash
npm run dev
```

The server will start at `http://localhost:5100` (or the port specified in your `.env`).

## Building the Project

To build the TypeScript source code into the `dist/` directory:

```bash
npm run build
```

This compiles both the backend and frontend code.

## Testing

We use **Vitest** for testing. Please ensure all tests pass before submitting a pull request.

### Running Tests

- **Run all tests:**

  ```bash
  npm test
  ```

- **Run tests in watch mode (for development):**

  ```bash
  npx vitest
  ```

- **Run with coverage:**
  ```bash
  npm run coverage
  ```

### Writing Tests

- Place unit tests alongside the source files (e.g., `src/services/LoadBalancer.test.ts`).
- Place integration tests in the `tests/` directory.
- Ensure you cover both success and error scenarios.

## Linting and Formatting

We use **ESLint** and **Prettier** to maintain code quality. ESLint has two profiles:

- **`.eslintrc.json`** — full profile with `@typescript-eslint/recommended-requiring-type-checking` (used by `lint`/`lint:fix`). Runs type analysis on every pass; appropriate for CI.
- **`.eslintrc.fast.json`** — lightweight profile without type-aware rules (used by `lint:fast`). Appropriate for local dev iteration.

**Scripts:**

```bash
npm run lint:fast    # fast: no TypeScript type analysis (~2–5s)
npm run lint         # full: includes type checking (~10–20s)
npm run lint:fix     # full + auto-fix
npm run format:check # prettier format check
```

**Logging:** Use `logger` from `src/utils/logger.ts` instead of `console.log`. `console.*` is set to `warn` level — it won't block CI but will produce warnings. Suppress with `// eslint-disable-next-line no-console` when truly needed.

- **Format check:**
  ```bash
  npm run format:check
  ```

## Project Structure

- `src/`: Backend source code
  - `config/`: Configuration management (Zod schema, hot-reload)
  - `controllers/`: HTTP request handlers (18 controllers)
  - `middleware/`: Auth, rate-limiting, validation middleware
  - `orchestrator/`: Core routing engine, types, persistence
  - `probe/`: Circuit breaker state machine, health checks
  - `routes/`: Express router composition
  - `analytics/`: Analytics engine, recovery-failure tracker
  - `metrics/`: Prometheus exporter, sliding-window metrics
  - `storage/`: SQLite + JSON file persistence
  - `types/`: TypeScript type definitions
  - `utils/`: Pure helpers (fetch, logging, streaming, etc.)
- `frontend/`: React dashboard (Vite, shadcn/ui)
  - `src/pages/`: Page components (Dashboard, Servers, Models, Analytics, etc.)
  - `src/components/`: Reusable UI primitives
  - `src/hooks/`: React hooks (auth, data table, websocket, etc.)
  - `src/types/generated/`: Auto-generated backend type mirror
- `tests/`: Vitest + Playwright test suite
  - `unit/`, `integration/`, `e2e/`, `chaos/`, `performance/`
- `docs/`: Operator guides (API, Deployment, Operations, Examples)
- `scripts/`: Operational scripts (install, load test, sync-types, etc.)

## Submitting a Pull Request

1.  Create a new branch for your feature or bug fix: `git checkout -b feature/my-new-feature`
2.  Commit your changes with clear, descriptive messages.
3.  Push your branch to the repository.
4.  Open a Pull Request against the `main` branch.
5.  Ensure all CI checks pass.

## License

By contributing, you agree that your contributions will be licensed under the project's [MIT License](LICENSE).
