/**
 * Alias Management Tools Tests
 */

import {
  ListAliasesTool,
  CreateAliasTool,
  DeleteAliasTool,
  ListTimeLimitedAliasesTool,
  CreateTimeLimitedAliasTool,
  DeleteTimeLimitedAliasTool,
} from '../../../src/tools/aliases';
import { AliasAPI } from '../../../src/api/aliases';
import { Logger } from '../../../src/utils';
import { ToolContext, MailcowAlias, MCPErrorCode } from '../../../src/types';

jest.mock('../../../src/tools/validation', () => ({
  validateToolInput: jest.fn(),
  validateToolSchema: jest.fn(() => ({ valid: true, errors: [], warnings: [] }))
}));

describe('Alias Management Tools', () => {
  let logger: Logger;
  let aliasAPI: AliasAPI;
  let context: ToolContext;

  const sampleAliases: MailcowAlias[] = [
    { id: 1, address: 'sales@example.com', goto: 'john@example.com', domain: 'example.com', active: 1, created: '2023-01-01', modified: null },
    { id: 2, address: 'info@test.org', goto: 'jane@test.org,john@example.com', domain: 'test.org', active: 0, created: '2023-01-02', modified: null },
  ];

  const prepare = <T extends object>(tool: T): T => {
    jest.spyOn(tool as any, 'validatePermissions').mockReturnValue(true);
    jest.spyOn(tool as any, 'validateInput').mockReturnValue({ valid: true, errors: [], warnings: [] });
    return tool;
  };

  const parse = (result: any) => JSON.parse(result.result.content[0].text);

  beforeEach(() => {
    logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() } as any;
    aliasAPI = {
      listAliases: jest.fn(),
      createAlias: jest.fn(),
      deleteAlias: jest.fn(),
      getAliasDetails: jest.fn(),
      listTimeLimitedAliases: jest.fn(),
      createTimeLimitedAlias: jest.fn(),
      deleteTimeLimitedAlias: jest.fn(),
    } as any;
    context = {
      requestId: 'test-request-123',
      userId: 'test-user',
      timestamp: new Date(),
      permissions: ['aliases:read', 'aliases:write', 'aliases:delete'],
      accessLevel: 'read-write',
      metadata: {}
    };
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  describe('ListAliasesTool', () => {
    it('should list and filter aliases', async () => {
      const tool = prepare(new ListAliasesTool(logger, aliasAPI));
      (aliasAPI.listAliases as jest.Mock).mockResolvedValue(sampleAliases);

      const all = parse(await tool.execute({}, context));
      expect(tool.name).toBe('list_aliases');
      expect(all.total_aliases).toBe(2);

      const byGoto = parse(await tool.execute({ goto: 'john@example.com' }, context));
      expect(byGoto.filtered_aliases).toBe(2);

      const active = parse(await tool.execute({ active_only: true }, context));
      expect(active.aliases.map((a: any) => a.address)).toEqual(['sales@example.com']);
    });

    it('should handle permission denial', async () => {
      const tool = new ListAliasesTool(logger, aliasAPI);
      jest.spyOn(tool as any, 'validatePermissions').mockReturnValue(false);
      const result = await tool.execute({}, context);
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe(MCPErrorCode.AUTHORIZATION_ERROR);
    });
  });

  describe('CreateAliasTool', () => {
    it('should create an alias', async () => {
      const tool = prepare(new CreateAliasTool(logger, aliasAPI));
      (aliasAPI.createAlias as jest.Mock).mockResolvedValue(sampleAliases[0]);

      const result = await tool.execute({ address: 'sales@example.com', goto: 'john@example.com' }, context);

      expect(result.success).toBe(true);
      expect(aliasAPI.createAlias).toHaveBeenCalledWith(expect.objectContaining({ address: 'sales@example.com', goto: 'john@example.com', active: true }));
      expect(parse(result).alias.id).toBe(1);
    });
  });

  describe('DeleteAliasTool', () => {
    it('should require confirmation', async () => {
      const tool = prepare(new DeleteAliasTool(logger, aliasAPI));
      const result = await tool.execute({ alias: 'sales@example.com', confirm: false }, context);
      expect(result.success).toBe(false);
      expect(aliasAPI.deleteAlias).not.toHaveBeenCalled();
    });

    it('should delete by resolved id', async () => {
      const tool = prepare(new DeleteAliasTool(logger, aliasAPI));
      (aliasAPI.getAliasDetails as jest.Mock).mockResolvedValue(sampleAliases[0]);
      const result = await tool.execute({ alias: 'sales@example.com', confirm: true }, context);
      expect(result.success).toBe(true);
      expect(aliasAPI.deleteAlias).toHaveBeenCalledWith(1);
    });

    it('should report not found', async () => {
      const tool = prepare(new DeleteAliasTool(logger, aliasAPI));
      (aliasAPI.getAliasDetails as jest.Mock).mockRejectedValue(new Error('Alias not found'));
      const result = await tool.execute({ alias: 'ghost@example.com', confirm: true }, context);
      expect(result.error?.code).toBe(MCPErrorCode.RESOURCE_NOT_FOUND);
    });
  });

  describe('Time-limited alias tools', () => {
    const tla = { address: 'abc@example.com', goto: 'john@example.com', validity: 1, created: '2023-01-01', modified: null };

    it('should list and hide expired when asked', async () => {
      const tool = prepare(new ListTimeLimitedAliasesTool(logger, aliasAPI));
      (aliasAPI.listTimeLimitedAliases as jest.Mock).mockResolvedValue([tla]);
      const result = parse(await tool.execute({ mailbox: 'john@example.com', include_expired: false }, context));
      expect(result.total_aliases).toBe(1);
      expect(result.aliases).toHaveLength(0);
    });

    it('should create with validity hours', async () => {
      const tool = prepare(new CreateTimeLimitedAliasTool(logger, aliasAPI));
      (aliasAPI.createTimeLimitedAlias as jest.Mock).mockResolvedValue({ ...tla, validity: 4102444800 });
      const result = await tool.execute({ mailbox: 'john@example.com', validity_hours: 6 }, context);
      expect(aliasAPI.createTimeLimitedAlias).toHaveBeenCalledWith(expect.objectContaining({ username: 'john@example.com', validity: 6 }));
      expect(parse(result).alias.address).toBe('abc@example.com');
    });

    it('should delete by address', async () => {
      const tool = prepare(new DeleteTimeLimitedAliasTool(logger, aliasAPI));
      const result = await tool.execute({ address: 'abc@example.com' }, context);
      expect(result.success).toBe(true);
      expect(aliasAPI.deleteTimeLimitedAlias).toHaveBeenCalledWith('abc@example.com');
    });
  });
});
