import { fileURLToPath } from 'url';
import path from 'path';

const base = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const { streamResponse } = await import(path.join(base, 'dist/streaming.js'));
const { getInFlightManager } = await import(path.join(base, 'dist/utils/in-flight-manager.js'));

function makeUpstream(chunks) {
  let i = 0;
  return {
    status: 200,
    headers: new Map([['content-type', 'application/json']]),
    body: {
      getReader() {
        return {
          async read() {
            if (i >= chunks.length) return { done: true, value: undefined };
            const buf = Buffer.from(chunks[i++], 'utf8');
            return { done: false, value: new Uint8Array(buf) };
          },
          cancel() {
            /* noop */
          },
        };
      },
    },
  };
}

function makeClient() {
  let ended = false;
  return {
    headersSent: false,
    writableEnded: false,
    setHeader() {},
    write(chunk) {
      // console.log to stdout so test runner can capture
      process.stdout.write(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString());
      return true;
    },
    end() {
      this.writableEnded = true;
      this.headersSent = true;
    },
    once(_ev, cb) {
      setTimeout(cb, 0);
    },
    status(_s) {
      return this;
    },
    json(obj) {
      process.stdout.write(JSON.stringify(obj) + '\n');
    },
  };
}

async function run() {
  const inflight = getInFlightManager();
  const id = `test-${Date.now()}`;
  inflight.addStreamingRequest(id, 'local-server', 'test-model');

  const chunks = ['{"response":"hello"}\n', '{"response":" world"}\n', '{"done":true}\n'];
  const upstream = makeUpstream(chunks);
  const client = makeClient();

  console.log('Starting stream test with id', id);
  await streamResponse(
    upstream,
    client,
    undefined,
    (duration, tokensGenerated, tokensPrompt, chunkData) => {
      console.log('\nStream complete callback:', {
        duration,
        tokensGenerated,
        tokensPrompt,
        chunkData,
      });
    },
    chunkCount => {
      console.log('\nonChunk callback, chunkCount=', chunkCount);
    },
    undefined,
    id
  );

  const prog = inflight.getStreamingRequestProgress(id);
  console.log('Final progress from InFlightManager:', prog);
}

run().catch(e => {
  console.error('Test failed', e);
  process.exit(1);
});
