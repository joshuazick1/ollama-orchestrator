import express from 'express';
import type { Request, Response } from 'express';

export class MockOllamaServer {
  private app: express.Application;
  private server: any;
  private port: number;
  private failureRate: number;

  constructor(port: number = 11435, failureRate: number = 0) {
    this.port = port;
    this.failureRate = failureRate;
    this.app = express();
    this.setupRoutes();
  }

  private setupRoutes(): void {
    // Mock root endpoint for health checks
    this.app.get('/', (req: Request, res: Response) => {
      res.json({ status: 'ok' });
    });

    // Mock /api/tags
    this.app.get('/api/tags', (req: Request, res: Response) => {
      res.json({
        models: [
          {
            name: 'llama2:7b',
            size: 3791730592,
            digest: 'sha256:1234567890abcdef',
            details: {
              format: 'gguf',
              family: 'llama',
              families: ['llama'],
              parameter_size: '7B',
              quantization_level: 'Q4_0',
            },
          },
          {
            name: 'codellama:7b',
            size: 3791730592,
            digest: 'sha256:abcdef1234567890',
            details: {
              format: 'gguf',
              family: 'llama',
              families: ['llama'],
              parameter_size: '7B',
              quantization_level: 'Q4_0',
            },
          },
        ],
      });
    });

    // Mock /api/generate
    this.app.post('/api/generate', (req: Request, res: Response) => {
      // Check failure rate
      if (Math.random() < this.failureRate) {
        return res.status(500).json({ error: 'Internal server error' });
      }

      const { prompt, model, stream = false } = req.body;

      if (stream) {
        // Simple streaming response
        res.writeHead(200, {
          'Content-Type': 'text/plain',
          'Transfer-Encoding': 'chunked',
        });

        const response = `{"model":"${model}","created_at":"${new Date().toISOString()}","response":"Hello! This is a streaming response to: ${prompt}","done":false}\n`;
        const done = `{"model":"${model}","created_at":"${new Date().toISOString()}","response":"","done":true,"context":[1,2,3],"total_duration":123456789,"load_duration":456789,"prompt_eval_count":10,"prompt_eval_duration":123456,"eval_count":20,"eval_duration":987654}\n`;

        setTimeout(() => {
          res.write(response);
          setTimeout(() => {
            res.write(done);
            res.end();
          }, 100);
        }, 50);
      } else {
        // Non-streaming response
        res.json({
          model,
          created_at: new Date().toISOString(),
          response: `Hello! This is a response to: ${prompt}`,
          done: true,
          context: [1, 2, 3],
          total_duration: 123456789,
          load_duration: 456789,
          prompt_eval_count: 10,
          prompt_eval_duration: 123456,
          eval_count: 20,
          eval_duration: 987654,
        });
      }
    });

    // Mock /api/chat
    this.app.post('/api/chat', (req: Request, res: Response) => {
      const { messages, model, stream = false } = req.body;

      if (stream) {
        res.writeHead(200, {
          'Content-Type': 'text/plain',
        });

        const response = `{"model":"${model}","created_at":"${new Date().toISOString()}","message":{"role":"assistant","content":"This is a chat response."},"done":false}\n`;
        const done = `{"model":"${model}","created_at":"${new Date().toISOString()}","message":{"role":"assistant","content":""},"done":true,"total_duration":123456789,"load_duration":456789,"prompt_eval_count":10,"prompt_eval_duration":123456,"eval_count":20,"eval_duration":987654}\n`;

        setTimeout(() => {
          res.write(response);
          setTimeout(() => {
            res.write(done);
            res.end();
          }, 100);
        }, 50);
      } else {
        res.json({
          model,
          created_at: new Date().toISOString(),
          message: {
            role: 'assistant',
            content: 'This is a chat response.',
          },
          done: true,
          total_duration: 123456789,
          load_duration: 456789,
          prompt_eval_count: 10,
          prompt_eval_duration: 123456,
          eval_count: 20,
          eval_duration: 987654,
        });
      }
    });

    // Mock /api/embeddings
    this.app.post('/api/embeddings', (req: Request, res: Response) => {
      res.json({
        embedding: Array.from({ length: 4096 }, () => Math.random() - 0.5),
      });
    });

    // Mock model loading/unloading
    this.app.post('/api/pull', (req: Request, res: Response) => {
      const { name } = req.body;
      // Simulate loading time
      setTimeout(() => {
        res.json({ status: 'success' });
      }, 1000);
    });
  }

  async start(): Promise<void> {
    return new Promise(resolve => {
      this.server = this.app.listen(this.port, () => {
        console.log(`Mock Ollama server started on port ${this.port}`);
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    return new Promise(resolve => {
      if (this.server) {
        this.server.close(() => {
          console.log(`Mock Ollama server stopped`);
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  setupCustomRoute(
    method: string,
    path: string,
    handler: (req: Request, res: Response) => void
  ): void {
    if (method.toLowerCase() === 'get') {
      this.app.get(path, handler);
    } else if (method.toLowerCase() === 'post') {
      this.app.post(path, handler);
    }
  }

  getUrl(): string {
    return `http://localhost:${this.port}`;
  }
}
