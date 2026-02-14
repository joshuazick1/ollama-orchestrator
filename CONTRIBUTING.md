# Contributing to Ollama Orchestrator

Thank you for your interest in contributing to the Ollama Orchestrator project! This document provides guidelines and instructions for setting up your development environment and submitting changes.

## Development Setup

### Prerequisites

- Node.js (v18 or higher)
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

We use **ESLint** and **Prettier** to maintain code quality.

- **Check for linting errors:**

  ```bash
  npm run lint
  ```

- **Fix linting errors automatically:**
  ```bash
  npm run lint:fix
  ```

## Project Structure

- `src/`: Backend source code
  - `config/`: Configuration logic
  - `routes/`: API route definitions
  - `services/`: Core business logic (LoadBalancer, Queue, etc.)
  - `types/`: TypeScript type definitions
- `frontend/`: React frontend source code
- `tests/`: Integration tests
- `docs/`: Documentation

## Submitting a Pull Request

1.  Create a new branch for your feature or bug fix: `git checkout -b feature/my-new-feature`
2.  Commit your changes with clear, descriptive messages.
3.  Push your branch to the repository.
4.  Open a Pull Request against the `main` branch.
5.  Ensure all CI checks pass.

## License

By contributing, you agree that your contributions will be licensed under the project's [MIT License](LICENSE).
