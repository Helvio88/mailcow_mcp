/**
 * Alias API Tests
 * Verify the Mailcow endpoints and payloads used by AliasAPI
 */

import { AliasAPI } from '../../../src/api/aliases';
import { APIClient } from '../../../src/api/client';

describe('AliasAPI', () => {
  let client: APIClient;
  let api: AliasAPI;
  const alias = { id: 7, address: 'sales@example.com', goto: 'john@example.com', domain: 'example.com', active: 1 };

  beforeEach(() => {
    client = { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() } as any;
    api = new AliasAPI(client);
  });

  it('should list all aliases', async () => {
    (client.get as jest.Mock).mockResolvedValue([alias]);
    await expect(api.listAliases()).resolves.toEqual([alias]);
    expect(client.get).toHaveBeenCalledWith('/api/v1/get/alias/all');
  });

  it('should treat an empty object as no aliases', async () => {
    (client.get as jest.Mock).mockResolvedValue({});
    await expect(api.listAliases()).resolves.toEqual([]);
  });

  it('should create an alias and return it', async () => {
    (client.post as jest.Mock).mockResolvedValue([{ type: 'success', msg: ['alias_added'] }]);
    (client.get as jest.Mock).mockResolvedValue([alias]);

    const created = await api.createAlias({ address: 'sales@example.com', goto: 'john@example.com' });

    expect(client.post).toHaveBeenCalledWith('/api/v1/add/alias', {
      address: 'sales@example.com',
      goto: 'john@example.com',
      active: 1,
    });
    expect(created.id).toBe(7);
  });

  it('should surface mailcow errors on create', async () => {
    (client.post as jest.Mock).mockResolvedValue([{ type: 'danger', msg: ['is_alias_or_mailbox', 'sales@example.com'] }]);
    await expect(api.createAlias({ address: 'sales@example.com', goto: 'x@example.com' })).rejects.toThrow('is_alias_or_mailbox');
  });

  it('should delete aliases by id array', async () => {
    (client.post as jest.Mock).mockResolvedValue([{ type: 'success' }]);
    await api.deleteAlias(7);
    expect(client.post).toHaveBeenCalledWith('/api/v1/delete/alias', ['7']);
  });

  it('should find an alias by address or id', async () => {
    (client.get as jest.Mock).mockResolvedValue([alias]);
    await expect(api.getAliasDetails('SALES@example.com')).resolves.toEqual(alias);
    await expect(api.getAliasDetails(7)).resolves.toEqual(alias);
    await expect(api.getAliasDetails('nope@example.com')).rejects.toThrow('Alias not found');
  });

  describe('time-limited aliases', () => {
    const tla = { address: 'abc123@example.com', goto: 'john@example.com', validity: 1900000000, created: '2026-01-01' };

    it('should list by mailbox', async () => {
      (client.get as jest.Mock).mockResolvedValue([tla]);
      await expect(api.listTimeLimitedAliases('john@example.com')).resolves.toEqual([tla]);
      expect(client.get).toHaveBeenCalledWith('/api/v1/get/time_limited_aliases/john%40example.com');
    });

    it('should create one and return the new address', async () => {
      (client.get as jest.Mock).mockResolvedValueOnce([]).mockResolvedValueOnce([tla]);
      (client.post as jest.Mock).mockResolvedValue([{ type: 'success' }]);

      const created = await api.createTimeLimitedAlias({ username: 'john@example.com', validity: 6, description: 'test' });

      expect(client.post).toHaveBeenCalledWith('/api/v1/add/time_limited_alias', {
        username: 'john@example.com',
        domain: 'example.com',
        validity: 6,
        description: 'test',
      });
      expect(created?.address).toBe('abc123@example.com');
    });

    it('should delete by address array', async () => {
      (client.post as jest.Mock).mockResolvedValue([{ type: 'success' }]);
      await api.deleteTimeLimitedAlias('abc123@example.com');
      expect(client.post).toHaveBeenCalledWith('/api/v1/delete/time_limited_alias', ['abc123@example.com']);
    });
  });
});
