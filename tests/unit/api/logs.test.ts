import { APIClient } from '../../../src/api/client';
import { LogsAPI } from '../../../src/api/logs';

describe('LogsAPI', () => {
  let get: jest.Mock;
  let logsAPI: LogsAPI;

  beforeEach(() => {
    get = jest.fn();
    logsAPI = new LogsAPI({ get } as unknown as APIClient);
  });

  it('uses Mailcow source/count routes and normalizes syslog entries', async () => {
    get.mockResolvedValue([
      {
        time: '1700000000',
        priority: 'info',
        program: 'postfix/qmgr',
        message: 'queue item removed',
      },
    ]);

    const logs = await logsAPI.getLogs({ service: 'postfix', limit: 5 });

    expect(get).toHaveBeenCalledWith('/api/v1/get/logs/postfix/5');
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      level: 'info',
      service: 'postfix/qmgr',
      message: 'queue item removed',
    });
    expect(logs[0].timestamp).toEqual(new Date(1700000000 * 1000));
  });

  it('aggregates supported sources and tolerates unavailable routes', async () => {
    get.mockImplementation(async (endpoint: string) => {
      if (endpoint.includes('/cron/')) {
        throw new Error('API Error 404: route not found');
      }
      if (endpoint.includes('/postfix/')) {
        return [{
          time: '1700000000',
          priority: 'warning',
          message: 'delivery deferred',
        }];
      }
      return {};
    });

    const logs = await logsAPI.getLogs({ limit: 5 });

    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      level: 'warn',
      service: 'postfix',
      message: 'delivery deferred',
    });
    expect(get).not.toHaveBeenCalledWith('/api/v1/get/logs/5');
  });

  it('combines access sources and redacts request payloads', async () => {
    get.mockImplementation(async (endpoint: string) => {
      if (endpoint.includes('/api/')) {
        return [{
          time: 1700000000,
          method: 'POST',
          uri: '/api/v1/edit/domain',
          remote: '192.0.2.10',
          data: 'sensitive request body',
        }];
      }
      return {};
    });

    const logs = await logsAPI.getAccessLogs({ limit: 5 });

    expect(get).toHaveBeenCalledTimes(6);
    expect(logs[0].message).toBe(
      'POST /api/v1/edit/domain from 192.0.2.10'
    );
    expect(logs[0].details?.data).toBe('[REDACTED]');
  });

  it('applies time sorting and offset after normalizing entries', async () => {
    get.mockResolvedValue([
      { time: 1700000000, message: 'older event', priority: 'info' },
      { time: 1700000100, message: 'newer failure', priority: 'error' },
    ]);

    const logs = await logsAPI.getLogs({
      service: 'dovecot',
      limit: 1,
      offset: 1,
    });

    expect(get).toHaveBeenCalledWith('/api/v1/get/logs/dovecot/2');
    expect(logs).toHaveLength(1);
    expect(logs[0].message).toBe('older event');
  });

  it('maps the rspamd alias to rspamd-history', async () => {
    get.mockResolvedValue({});

    await logsAPI.getLogs({ service: 'rspamd', limit: 5 });

    expect(get).toHaveBeenCalledWith('/api/v1/get/logs/rspamd-history/5');
  });
});
