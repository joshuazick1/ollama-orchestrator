# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 1.0.x   | :white_check_mark: |
| < 1.0   | :x:                |

## Reporting a Vulnerability

We take security vulnerabilities seriously. If you discover a security issue in Ollama Orchestrator, please report it privately:

**Email**: noreply@ollama-orchestrator.local

Please include:

- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

We aim to respond within 48 hours and will work with you to understand and address the issue before any public disclosure.

## Security Best Practices for Deployment

When deploying Ollama Orchestrator:

1. **Enable Authentication**: Set `ORCHESTRATOR_ENABLE_AUTH=true` in production
2. **Use HTTPS**: Deploy behind a reverse proxy (nginx, Caddy, etc.) with TLS
3. **Rotate API Keys**: Use `ORCHESTRATOR_API_KEYS` and `ORCHESTRATOR_ADMIN_API_KEYS` env vars, not hardcoded values
4. **Network Isolation**: Run orchestrator on a private network; only expose inference endpoints externally
5. **Update Regularly**: Keep Ollama Orchestrator and Ollama servers updated
6. **Monitor Logs**: Watch for unusual authentication failures, circuit breaker trips, and request patterns
7. **Rate Limiting**: Keep default rate limits or tune them for your traffic patterns

## Disclosure Policy

- Security issues will be patched in the next minor release when feasible
- Critical issues may receive out-of-band patches
- CVE will be assigned for confirmed vulnerabilities affecting supported versions
- Public disclosure coordinated with reporter after fix is available

## Out of Scope

The following are NOT considered security vulnerabilities:

- Denial-of-service attacks requiring sustained high traffic
- Issues in upstream dependencies (file with the upstream project)
- Social engineering attacks
- Physical access attacks

## Acknowledgements

We thank security researchers and contributors who responsibly disclose vulnerabilities.
