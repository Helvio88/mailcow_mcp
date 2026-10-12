/**
 * Mailbox API Tests
 * Verify the Mailcow endpoints and payloads used by MailboxAPI
 */

import { MailboxAPI } from '../../../src/api/mailboxes';
import { APIClient } from '../../../src/api/client';

describe('MailboxAPI', () => {
  let client: APIClient;
  let api: MailboxAPI;

  beforeEach(() => {
    client = { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() } as any;
    api = new MailboxAPI(client);
  });

  describe('getMailboxDetails', () => {
    it('should request the single-mailbox endpoint', async () => {
      (client.get as jest.Mock).mockResolvedValue({ username: 'john@example.com', domain: 'example.com' });

      const mailbox = await api.getMailboxDetails('john@example.com');

      expect(client.get).toHaveBeenCalledWith('/api/v1/get/mailbox/john%40example.com');
      expect(mailbox.username).toBe('john@example.com');
    });

    it('should throw when mailcow returns an empty object', async () => {
      (client.get as jest.Mock).mockResolvedValue({});

      await expect(api.getMailboxDetails('ghost@example.com')).rejects.toThrow('Mailbox not found');
    });
  });

  describe('deleteMailbox', () => {
    it('should post an array of usernames', async () => {
      (client.post as jest.Mock).mockResolvedValue([{ type: 'success', msg: ['mailbox_removed', 'john@example.com'] }]);

      await api.deleteMailbox('john@example.com');

      expect(client.post).toHaveBeenCalledWith('/api/v1/delete/mailbox', ['john@example.com']);
    });

    it('should throw when mailcow reports an error', async () => {
      (client.post as jest.Mock).mockResolvedValue([{ type: 'danger', msg: ['access_denied'] }]);

      await expect(api.deleteMailbox('john@example.com')).rejects.toThrow('access_denied');
    });
  });
});
