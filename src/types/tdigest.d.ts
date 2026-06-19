declare module 'tdigest' {
  export class TDigest {
    constructor(compression?: number);
    push(value: number, count?: number): void;
    percentile(p: number): number;
    toArray(): Array<{ mean: number; n: number }>;
    size(): number;
    compress(): void;
    reset(): void;
  }
}
