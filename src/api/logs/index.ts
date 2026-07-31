import { APIClient } from '../client';
import { MailcowLogEntry, LogFilter, APIAction } from '../../types';
import { buildLogEndpoint } from '../endpoints';

type RawLogEntry = Record<string, unknown>;

const LOG_SOURCES = [
  'acme',
  'api',
  'autodiscover',
  'cron',
  'dovecot',
  'netfilter',
  'postfix',
  'ratelimited',
  'rspamd-history',
  'sasl',
  'sogo',
  'ui',
  'watchdog',
] as const;

const ACCESS_LOG_SOURCES = [
  'api',
  'ui',
  'autodiscover',
  'sasl',
  'netfilter',
  'dovecot',
] as const;

const SERVICE_ALIASES: Record<string, string> = {
  rspamd: 'rspamd-history',
  access: 'access',
  performance: 'watchdog',
};

const SENSITIVE_DETAIL_KEY =
  /^(?:authorization|cookie|data|key|password|passwd|secret|token|x-api-key)$/i;

export class LogsAPI {
  constructor(private client: APIClient) {}

  async getLogs(params: LogFilter = {}): Promise<MailcowLogEntry[]> {
    const requestedService = params.service?.toLowerCase();

    if (requestedService === 'access') {
      return this.fetchSources(ACCESS_LOG_SOURCES, params);
    }

    const source = requestedService
      ? SERVICE_ALIASES[requestedService] || requestedService
      : undefined;

    return this.fetchSources(source ? [source] : LOG_SOURCES, params);
  }

  async getAccessLogs(params: LogFilter = {}): Promise<MailcowLogEntry[]> {
    return this.fetchSources(ACCESS_LOG_SOURCES, params);
  }

  async getErrorLogs(params: LogFilter = {}): Promise<MailcowLogEntry[]> {
    if (params.service?.toLowerCase() === 'access') {
      return this.fetchSources(ACCESS_LOG_SOURCES, {
        ...params,
        level: 'error',
      });
    }

    return this.fetchSources(
      params.service
        ? [SERVICE_ALIASES[params.service.toLowerCase()] || params.service.toLowerCase()]
        : LOG_SOURCES,
      { ...params, level: 'error' }
    );
  }

  async getPerformanceLogs(params: LogFilter = {}): Promise<MailcowLogEntry[]> {
    return this.fetchSources(['watchdog'], params);
  }

  private async fetchSources(
    sources: readonly string[],
    params: LogFilter
  ): Promise<MailcowLogEntry[]> {
    const offset = Math.max(0, params.offset || 0);
    const limit = Math.max(1, params.limit || 100);
    const count = Math.min(10000, offset + limit);
    const baseEndpoint = buildLogEndpoint(APIAction.LIST);

    const results = await Promise.allSettled(
      sources.map(async source => {
        const response = await this.client.get<unknown>(
          `${baseEndpoint}/${encodeURIComponent(source)}/${count}`
        );
        return this.normalizeResponse(response, source);
      })
    );

    const successful = results.filter(
      (result): result is PromiseFulfilledResult<MailcowLogEntry[]> =>
        result.status === 'fulfilled'
    );

    if (successful.length === 0) {
      const firstFailure = results.find(
        (result): result is PromiseRejectedResult => result.status === 'rejected'
      );
      throw firstFailure?.reason instanceof Error
        ? firstFailure.reason
        : new Error('No supported Mailcow log endpoint responded');
    }

    let logs = successful.flatMap(result => result.value);

    if (params.level) {
      logs = logs.filter(log => log.level === params.level);
    }
    if (params.start_time) {
      logs = logs.filter(log => log.timestamp >= params.start_time!);
    }
    if (params.end_time) {
      logs = logs.filter(log => log.timestamp <= params.end_time!);
    }

    return logs
      .sort((left, right) => right.timestamp.getTime() - left.timestamp.getTime())
      .slice(offset, offset + limit);
  }

  private normalizeResponse(
    response: unknown,
    source: string
  ): MailcowLogEntry[] {
    if (Array.isArray(response)) {
      return response
        .filter(this.isRawLogEntry)
        .map((entry, index) => this.normalizeEntry(entry, source, index));
    }

    if (this.isRawLogEntry(response) && Object.keys(response).length > 0) {
      return [this.normalizeEntry(response, source, 0)];
    }

    return [];
  }

  private normalizeEntry(
    entry: RawLogEntry,
    source: string,
    index: number
  ): MailcowLogEntry {
    const timestamp = this.parseTimestamp(
      entry.time ?? entry.timestamp ?? entry.datetime
    );
    const message = this.buildMessage(entry, source);
    const level = this.normalizeLevel(
      entry.priority ?? entry.level ?? entry.type ?? entry.lvl,
      message
    );
    const service = this.asString(entry.program ?? entry.service) || source;

    return {
      id:
        this.asString(entry.id) ||
        `${source}-${timestamp.getTime()}-${index}`,
      timestamp,
      level,
      service,
      message,
      details: this.sanitizeDetails(entry),
    };
  }

  private parseTimestamp(value: unknown): Date {
    if (typeof value === 'number' || (typeof value === 'string' && /^\d+$/.test(value))) {
      const numericValue = Number(value);
      const milliseconds = numericValue < 1_000_000_000_000
        ? numericValue * 1000
        : numericValue;
      const timestamp = new Date(milliseconds);
      return Number.isNaN(timestamp.getTime()) ? new Date(0) : timestamp;
    }

    if (typeof value === 'string') {
      const timestamp = new Date(value);
      return Number.isNaN(timestamp.getTime()) ? new Date(0) : timestamp;
    }

    return new Date(0);
  }

  private normalizeLevel(
    rawLevel: unknown,
    message: string
  ): MailcowLogEntry['level'] {
    const level = this.asString(rawLevel)?.toLowerCase();

    if (level && /^(?:err|error|crit|critical|alert|emerg|fatal)$/.test(level)) {
      return 'error';
    }
    if (level && /^(?:warn|warning)$/.test(level)) {
      return 'warn';
    }
    if (level === 'debug') {
      return 'debug';
    }
    if (level && /^(?:info|notice)$/.test(level)) {
      return 'info';
    }

    if (/\b(?:error|fail(?:ed|ure)?|fatal|critical|denied|unauthorized)\b/i.test(message)) {
      return 'error';
    }
    if (/\b(?:warn(?:ing)?|timeout|deferred)\b/i.test(message)) {
      return 'warn';
    }

    return 'info';
  }

  private buildMessage(entry: RawLogEntry, source: string): string {
    const directMessage = this.asString(entry.message ?? entry.msg);
    if (directMessage) {
      return directMessage;
    }

    switch (source) {
      case 'api':
        return [
          this.asString(entry.method) || 'API',
          this.asString(entry.uri) || 'request',
          this.asString(entry.remote) && `from ${this.asString(entry.remote)}`,
        ].filter(Boolean).join(' ');
      case 'ui':
        return [
          this.asString(entry.task ?? entry.call ?? entry.type) || 'UI event',
          this.asString(entry.user) && `by ${this.asString(entry.user)}`,
          this.asString(entry.remote) && `from ${this.asString(entry.remote)}`,
        ].filter(Boolean).join(' ');
      case 'sasl':
        return [
          this.asString(entry.service) || 'SASL authentication',
          this.asString(entry.username) && `for ${this.asString(entry.username)}`,
          this.asString(entry.real_rip) && `from ${this.asString(entry.real_rip)}`,
        ].filter(Boolean).join(' ');
      case 'autodiscover':
        return [
          this.asString(entry.service) || 'Autodiscover access',
          this.asString(entry.user) && `by ${this.asString(entry.user)}`,
          this.asString(entry.ip) && `from ${this.asString(entry.ip)}`,
        ].filter(Boolean).join(' ');
      case 'ratelimited':
        return [
          'Rate limit event',
          this.asString(entry.user ?? entry.from) &&
            `for ${this.asString(entry.user ?? entry.from)}`,
        ].filter(Boolean).join(' ');
      case 'watchdog':
        return [
          this.asString(entry.service) || 'Watchdog',
          entry.hpnow !== undefined && entry.hptotal !== undefined &&
            `health ${String(entry.hpnow)}/${String(entry.hptotal)}`,
        ].filter(Boolean).join(' ');
      default:
        return `${source} log event`;
    }
  }

  private sanitizeDetails(entry: RawLogEntry): Record<string, unknown> {
    return Object.fromEntries(
      Object.entries(entry).map(([key, value]) => [
        key,
        SENSITIVE_DETAIL_KEY.test(key) ? '[REDACTED]' : value,
      ])
    );
  }

  private asString(value: unknown): string | undefined {
    if (typeof value === 'string' && value.length > 0) {
      return value;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }
    return undefined;
  }

  private isRawLogEntry(value: unknown): value is RawLogEntry {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}
