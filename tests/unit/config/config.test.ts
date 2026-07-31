import { ConfigManager } from '../../../src/config/config';

describe('ConfigManager secret handling', () => {
  const originalEnvironment = process.env;

  beforeEach(() => {
    process.env = {
      ...originalEnvironment,
      MAILCOW_API_URL: 'https://mail.example.test',
      MAILCOW_API_KEY: 'test-api-key-with-enough-characters-to-validate',
      MAILCOW_API_ACCESS_TYPE: 'read-only',
    };
  });

  afterEach(() => {
    process.env = originalEnvironment;
  });

  it('does not retain API key values in configuration source metadata', async () => {
    const manager = new ConfigManager();

    const result = await manager.loadConfig();

    expect(result.success).toBe(true);
    expect(manager.getSources()[0].config.api?.key).toBe('[REDACTED]');
    expect(JSON.stringify(manager.getSources())).not.toContain(
      process.env.MAILCOW_API_KEY
    );
  });
});
