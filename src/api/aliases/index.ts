import { APIClient } from '../client';
import {
  MailcowAlias,
  MailcowTimeLimitedAlias,
  CreateAliasRequest,
  CreateTimeLimitedAliasRequest,
  UpdateAliasRequest,
  APIAction,
} from '../../types';
import { buildAliasEndpoint, buildTimeLimitedAliasEndpoint } from '../endpoints';
import { assertMailcowSuccess } from '../errors';

const toArray = <T>(response: T | T[] | null | undefined): T[] => {
  if (Array.isArray(response)) return response;
  if (response && typeof response === 'object' && Object.keys(response).length > 0) {
    return [response];
  }
  return [];
};

export class AliasAPI {
  constructor(private client: APIClient) {}

  async listAliases(): Promise<MailcowAlias[]> {
    const response = await this.client.get<MailcowAlias[] | MailcowAlias>(
      `${buildAliasEndpoint(APIAction.LIST)}/all`
    );
    return toArray(response);
  }

  async createAlias(alias: CreateAliasRequest): Promise<MailcowAlias> {
    const payload: Record<string, unknown> = {
      address: alias.address,
      goto: alias.goto,
      active: alias.active === false ? 0 : 1,
    };
    if (alias.sogo_visible !== undefined) payload.sogo_visible = alias.sogo_visible ? 1 : 0;
    if (alias.public_comment !== undefined) payload.public_comment = alias.public_comment;
    if (alias.private_comment !== undefined) payload.private_comment = alias.private_comment;

    const response = await this.client.post<unknown>(buildAliasEndpoint(APIAction.CREATE), payload);
    assertMailcowSuccess(response);
    return this.getAliasDetails(alias.address);
  }

  async updateAlias(aliasId: string | number, updates: UpdateAliasRequest): Promise<void> {
    const attr: Record<string, unknown> = {};
    if (updates.goto !== undefined) attr.goto = updates.goto;
    if (updates.active !== undefined) attr.active = updates.active ? 1 : 0;
    const response = await this.client.post<unknown>(buildAliasEndpoint(APIAction.UPDATE), {
      items: [String(aliasId)],
      attr,
    });
    assertMailcowSuccess(response);
  }

  /**
   * Delete aliases by numeric id (mailcow's delete endpoint takes ids, not addresses)
   */
  async deleteAlias(aliasIds: string | number | Array<string | number>): Promise<void> {
    const ids = (Array.isArray(aliasIds) ? aliasIds : [aliasIds]).map(String);
    const response = await this.client.post<unknown>(buildAliasEndpoint(APIAction.DELETE), ids);
    assertMailcowSuccess(response);
  }

  /**
   * Find an alias by address or numeric id
   */
  async getAliasDetails(aliasId: string | number): Promise<MailcowAlias> {
    const key = String(aliasId).toLowerCase();
    const aliases = await this.listAliases();
    const alias = aliases.find(
      (a) => String(a.id) === key || a.address?.toLowerCase() === key
    );
    if (!alias) {
      throw new Error(`Alias not found: ${aliasId}`);
    }
    return alias;
  }

  async getUserAliases(username: string): Promise<MailcowAlias[]> {
    const aliases = await this.listAliases();
    return aliases.filter((a) =>
      a.goto.split(',').map((g) => g.trim()).includes(username)
    );
  }

  async listTimeLimitedAliases(mailbox: string): Promise<MailcowTimeLimitedAlias[]> {
    const response = await this.client.get<MailcowTimeLimitedAlias[] | MailcowTimeLimitedAlias>(
      `${buildTimeLimitedAliasEndpoint(APIAction.LIST)}/${encodeURIComponent(mailbox)}`
    );
    return toArray(response);
  }

  /**
   * Create a time-limited alias and return it. Mailcow generates the address,
   * so the new alias is found by diffing the mailbox's list before and after.
   */
  async createTimeLimitedAlias(
    request: CreateTimeLimitedAliasRequest
  ): Promise<MailcowTimeLimitedAlias | undefined> {
    const before = new Set(
      (await this.listTimeLimitedAliases(request.username)).map((a) => a.address)
    );
    const payload: Record<string, unknown> = {
      username: request.username,
      domain: request.domain ?? request.username.split('@')[1],
      validity: request.validity ?? 24,
    };
    if (request.description !== undefined) payload.description = request.description;
    if (request.permanent !== undefined) payload.permanent = request.permanent ? 1 : 0;

    const response = await this.client.post<unknown>(
      buildTimeLimitedAliasEndpoint(APIAction.CREATE),
      payload
    );
    assertMailcowSuccess(response);

    const after = await this.listTimeLimitedAliases(request.username);
    return after.find((a) => !before.has(a.address));
  }

  async deleteTimeLimitedAlias(addresses: string | string[]): Promise<void> {
    const list = Array.isArray(addresses) ? addresses : [addresses];
    const response = await this.client.post<unknown>(
      buildTimeLimitedAliasEndpoint(APIAction.DELETE),
      list
    );
    assertMailcowSuccess(response);
  }
}
