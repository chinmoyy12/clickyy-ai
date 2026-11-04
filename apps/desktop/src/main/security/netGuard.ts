import type { RoutingPolicy } from '@shared/settings';
import { isLoopbackHost } from './url';

export class OfflinePolicyError extends Error {
  constructor(host: string) {
    super(`Strict Offline mode blocked a request to ${host}`);
    this.name = 'OfflinePolicyError';
  }
}

export interface NetActivity { active: boolean; host: string; purpose: string }

/**
 * Single choke point for outbound HTTP. In Strict Offline mode only loopback
 * hosts are reachable. Every remote request is reported so the UI can show
 * when the cloud is in use.
 */
export class NetGuard {
  private inflight = 0;
  constructor(
    private policy: () => RoutingPolicy,
    private report: (a: NetActivity) => void = () => {},
    private impl: typeof fetch = globalThis.fetch.bind(globalThis),
  ) {}

  check(url: string | URL): URL {
    const u = typeof url === 'string' ? new URL(url) : url;
    if (!isLoopbackHost(u.hostname) && this.policy() === 'strict_offline') throw new OfflinePolicyError(u.hostname);
    return u;
  }

  fetchFor(purpose: string): typeof fetch {
    return (async (input: RequestInfo | URL, init?: RequestInit) => {
      const raw = typeof input === 'string' || input instanceof URL ? input : input.url;
      const u = this.check(raw);
      const remote = !isLoopbackHost(u.hostname);
      if (remote) {
        this.inflight++;
        this.report({ active: true, host: u.hostname, purpose });
      }
      try {
        return await this.impl(input, init);
      } finally {
        if (remote && --this.inflight === 0) this.report({ active: false, host: u.hostname, purpose });
      }
    }) as typeof fetch;
  }
}
