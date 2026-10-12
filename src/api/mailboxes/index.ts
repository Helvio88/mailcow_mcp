import { APIClient } from '../client';
import {
  MailcowMailbox,
  ListMailboxesParams,
  CreateMailboxRequest,
  UpdateMailboxRequest,
  APIAction,
} from '../../types';
import { buildMailboxEndpoint } from '../endpoints';
import { assertMailcowSuccess } from '../errors';

export class MailboxAPI {
  constructor(private client: APIClient) {}

  async listMailboxes(params?: ListMailboxesParams): Promise<MailcowMailbox[]> {
    const response = await this.client.get<MailcowMailbox[]>(
      buildMailboxEndpoint(APIAction.LIST),
      { params }
    );
    
    // Handle different response formats
    if (Array.isArray(response)) {
      return response;
    } else if (response && typeof response === 'object') {
      // If response is an object, try to extract the array
      const mailboxes = (response as any).mailboxes || (response as any).data || response;
      return Array.isArray(mailboxes) ? mailboxes : [mailboxes];
    }
    
    return [];
  }

  async createMailbox(mailbox: CreateMailboxRequest): Promise<MailcowMailbox> {
    return this.client.post<MailcowMailbox>(
      buildMailboxEndpoint(APIAction.CREATE),
      mailbox
    );
  }

  async updateMailbox(mailboxId: string, updates: UpdateMailboxRequest): Promise<MailcowMailbox> {
    const payload = { ...updates, mailbox: mailboxId };
    return this.client.post<MailcowMailbox>(
      buildMailboxEndpoint(APIAction.UPDATE),
      payload
    );
  }

  async deleteMailbox(mailboxId: string): Promise<void> {
    // Mailcow expects a JSON array of usernames
    const response = await this.client.post<unknown>(
      buildMailboxEndpoint(APIAction.DELETE),
      [mailboxId]
    );
    assertMailcowSuccess(response);
  }

  async getMailboxDetails(mailboxId: string): Promise<MailcowMailbox> {
    // GET /api/v1/get/mailbox/{username} returns a single object, or {} when it does not exist
    const response = await this.client.get<MailcowMailbox | MailcowMailbox[]>(
      `${buildMailboxEndpoint(APIAction.GET)}/${encodeURIComponent(mailboxId)}`
    );
    const mailbox = Array.isArray(response)
      ? response.find((m) => m.username === mailboxId)
      : response;
    if (!mailbox || !mailbox.username) {
      throw new Error(`Mailbox not found: ${mailboxId}`);
    }
    return mailbox;
  }

  async setMailboxQuota(mailboxId: string, quota: number): Promise<MailcowMailbox> {
    return this.updateMailbox(mailboxId, { quota });
  }
} 