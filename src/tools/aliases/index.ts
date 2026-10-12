/**
 * Alias Management Tools
 * MCP tools for managing Mailcow aliases and time-limited (spam) aliases
 */

import { BaseTool, ToolUtils } from '../base';
import { AliasAPI } from '../../api/aliases';
import {
  ToolInput,
  ToolContext,
  ToolHandlerResult,
  ToolCategory,
  MCPErrorCode,
  MailcowAlias,
  MailcowTimeLimitedAlias,
} from '../../types';
import { Logger } from '../../utils';

const EMAIL_PATTERN = '^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$';

const formatAlias = (alias: MailcowAlias) => ({
  id: alias.id,
  address: alias.address,
  goto: alias.goto,
  domain: alias.domain,
  active: alias.active === true || alias.active === 1,
  public_comment: alias.public_comment || undefined,
  private_comment: alias.private_comment || undefined,
  created: alias.created,
  modified: alias.modified,
});

const formatTimeLimitedAlias = (alias: MailcowTimeLimitedAlias) => ({
  address: alias.address,
  goto: alias.goto,
  description: alias.description || undefined,
  permanent: alias.permanent === 1,
  expires_at: alias.validity ? new Date(alias.validity * 1000).toISOString() : null,
  expired: alias.validity ? alias.validity * 1000 < Date.now() : false,
  created: alias.created,
});

abstract class AliasTool extends BaseTool {
  constructor(logger: Logger, protected aliasAPI: AliasAPI) {
    super(logger, {
      category: ToolCategory.ALIAS,
      version: '1.0.0',
      requiresAuth: true,
      rateLimited: true,
    });
  }

  /**
   * Shared permission and schema checks; returns an error result or null
   */
  protected precheck(
    input: ToolInput,
    context: ToolContext,
    permissions: string[]
  ): ToolHandlerResult | null {
    if (!this.validatePermissions(context, permissions)) {
      return {
        success: false,
        error: {
          code: MCPErrorCode.AUTHORIZATION_ERROR,
          message: `Permission denied: requires ${permissions[0]} permission`,
        },
      };
    }

    const validation = this.validateInput(input);
    if (!validation.valid) {
      return {
        success: false,
        error: {
          code: MCPErrorCode.INVALID_PARAMS,
          message: `Input validation failed: ${validation.errors.map(e => e.message).join(', ')}`,
        },
      };
    }
    return null;
  }

  protected invalid(message: string): ToolHandlerResult {
    return { success: false, error: { code: MCPErrorCode.INVALID_PARAMS, message } };
  }
}

/**
 * List aliases
 */
export class ListAliasesTool extends AliasTool {
  readonly name = 'list_aliases';
  readonly description = 'List aliases in the Mailcow server with optional filtering';
  readonly inputSchema = {
    type: 'object' as const,
    properties: {
      domain: {
        type: 'string' as const,
        description: 'Filter by domain',
      },
      goto: {
        type: 'string' as const,
        description: 'Only aliases that deliver to this address',
      },
      search: {
        type: 'string' as const,
        description: 'Search alias addresses and destinations (partial match)',
      },
      active_only: {
        type: 'boolean' as const,
        description: 'Only return active aliases',
      },
      limit: {
        type: 'number' as const,
        description: 'Maximum number of aliases to return',
        minimum: 1,
        maximum: 1000,
      },
    },
    additionalProperties: false,
  };

  async execute(input: ToolInput, context: ToolContext): Promise<ToolHandlerResult> {
    try {
      this.logExecution(input, context, true);
      const denied = this.precheck(input, context, ['aliases:read', 'read']);
      if (denied) return denied;

      const { domain, goto, search, active_only = false, limit = 100 } = input;
      const aliases = await this.aliasAPI.listAliases();

      let filtered = aliases;
      if (typeof domain === 'string') {
        filtered = filtered.filter(a => a.domain === domain);
      }
      if (typeof goto === 'string') {
        const target = goto.toLowerCase();
        filtered = filtered.filter(a =>
          a.goto.toLowerCase().split(',').map(g => g.trim()).includes(target)
        );
      }
      if (typeof search === 'string') {
        const term = search.toLowerCase();
        filtered = filtered.filter(a =>
          a.address.toLowerCase().includes(term) || a.goto.toLowerCase().includes(term)
        );
      }
      if (active_only) {
        filtered = filtered.filter(a => a.active === true || a.active === 1);
      }
      if (typeof limit === 'number' && limit > 0 && limit < filtered.length) {
        filtered = filtered.slice(0, limit);
      }

      return {
        success: true,
        result: ToolUtils.createJsonResult({
          total_aliases: aliases.length,
          filtered_aliases: filtered.length,
          aliases: filtered.map(formatAlias),
        }),
      };
    } catch (error) {
      return this.handleError(error as Error, context);
    }
  }
}

/**
 * Create an alias
 */
export class CreateAliasTool extends AliasTool {
  readonly name = 'create_alias';
  readonly description = 'Create an alias that forwards mail to one or more addresses';
  readonly inputSchema = {
    type: 'object' as const,
    properties: {
      address: {
        type: 'string' as const,
        description: 'Alias address (e.g. sales@example.com, or @example.com for a catch-all)',
      },
      goto: {
        type: 'string' as const,
        description: 'Destination address(es), comma separated',
      },
      active: {
        type: 'boolean' as const,
        description: 'Whether the alias should be active (default true)',
      },
      sogo_visible: {
        type: 'boolean' as const,
        description: 'Show the alias as a sender identity in SOGo',
      },
      public_comment: {
        type: 'string' as const,
        description: 'Public comment',
        maxLength: 255,
      },
      private_comment: {
        type: 'string' as const,
        description: 'Private comment',
        maxLength: 255,
      },
    },
    required: ['address', 'goto'],
    additionalProperties: false,
  };

  async execute(input: ToolInput, context: ToolContext): Promise<ToolHandlerResult> {
    try {
      this.logExecution(input, context, true);
      const denied = this.precheck(input, context, ['aliases:write', 'write']);
      if (denied) return denied;

      const { address, goto, active, sogo_visible, public_comment, private_comment } = input;
      if (typeof address !== 'string' || typeof goto !== 'string') {
        return this.invalid('address and goto must be strings');
      }

      const alias = await this.aliasAPI.createAlias({
        address,
        goto,
        active: typeof active === 'boolean' ? active : true,
        sogo_visible: typeof sogo_visible === 'boolean' ? sogo_visible : undefined,
        public_comment: typeof public_comment === 'string' ? public_comment : undefined,
        private_comment: typeof private_comment === 'string' ? private_comment : undefined,
      });

      return {
        success: true,
        result: ToolUtils.createJsonResult({
          message: `Alias '${alias.address}' created successfully`,
          alias: formatAlias(alias),
        }),
      };
    } catch (error) {
      return this.handleError(error as Error, context);
    }
  }
}

/**
 * Delete an alias
 */
export class DeleteAliasTool extends AliasTool {
  readonly name = 'delete_alias';
  readonly description = 'Delete an alias. Put its address or numeric id in alias and set confirm to true';
  readonly inputSchema = {
    type: 'object' as const,
    properties: {
      alias: {
        type: 'string' as const,
        description: 'Alias address or numeric id to delete',
      },
      confirm: {
        type: 'boolean' as const,
        description: 'Confirmation that you want to delete the alias',
      },
    },
    required: ['alias', 'confirm'],
    additionalProperties: false,
  };

  async execute(input: ToolInput, context: ToolContext): Promise<ToolHandlerResult> {
    try {
      this.logExecution(input, context, true);
      const denied = this.precheck(input, context, ['aliases:delete', 'write']);
      if (denied) return denied;

      const { alias, confirm } = input;
      if (typeof alias !== 'string') return this.invalid('alias must be a string');
      if (confirm !== true) {
        return this.invalid('Alias deletion requires explicit confirmation (confirm: true)');
      }

      let existing: MailcowAlias;
      try {
        existing = await this.aliasAPI.getAliasDetails(alias);
      } catch {
        return {
          success: false,
          error: { code: MCPErrorCode.RESOURCE_NOT_FOUND, message: `Alias '${alias}' not found` },
        };
      }

      await this.aliasAPI.deleteAlias(existing.id);

      return {
        success: true,
        result: ToolUtils.createJsonResult({
          message: `Alias '${existing.address}' deleted successfully`,
          deleted_alias: formatAlias(existing),
        }),
      };
    } catch (error) {
      return this.handleError(error as Error, context);
    }
  }
}

/**
 * List time-limited aliases for a mailbox
 */
export class ListTimeLimitedAliasesTool extends AliasTool {
  readonly name = 'list_time_limited_aliases';
  readonly description = 'List the time-limited (temporary/spam) aliases of a mailbox';
  readonly inputSchema = {
    type: 'object' as const,
    properties: {
      mailbox: {
        type: 'string' as const,
        description: 'Mailbox username (email address)',
        pattern: EMAIL_PATTERN,
      },
      include_expired: {
        type: 'boolean' as const,
        description: 'Include aliases that have already expired (default true)',
      },
    },
    required: ['mailbox'],
    additionalProperties: false,
  };

  async execute(input: ToolInput, context: ToolContext): Promise<ToolHandlerResult> {
    try {
      this.logExecution(input, context, true);
      const denied = this.precheck(input, context, ['aliases:read', 'read']);
      if (denied) return denied;

      const { mailbox, include_expired = true } = input;
      if (typeof mailbox !== 'string') return this.invalid('mailbox must be a string');

      const aliases = (await this.aliasAPI.listTimeLimitedAliases(mailbox)).map(formatTimeLimitedAlias);
      const shown = include_expired ? aliases : aliases.filter(a => !a.expired);

      return {
        success: true,
        result: ToolUtils.createJsonResult({
          mailbox,
          total_aliases: aliases.length,
          aliases: shown,
        }),
      };
    } catch (error) {
      return this.handleError(error as Error, context);
    }
  }
}

/**
 * Create a time-limited alias
 */
export class CreateTimeLimitedAliasTool extends AliasTool {
  readonly name = 'create_time_limited_alias';
  readonly description = 'Create a temporary alias with a random address that delivers to a mailbox until it expires';
  readonly inputSchema = {
    type: 'object' as const,
    properties: {
      mailbox: {
        type: 'string' as const,
        description: 'Mailbox username (email address) that receives the mail',
        pattern: EMAIL_PATTERN,
      },
      domain: {
        type: 'string' as const,
        description: 'Domain for the generated address (defaults to the mailbox domain)',
      },
      validity_hours: {
        type: 'number' as const,
        description: 'Hours until the alias expires (default 24)',
        minimum: 1,
        maximum: 87600,
      },
      description: {
        type: 'string' as const,
        description: 'Note describing what the alias is for',
        maxLength: 255,
      },
      permanent: {
        type: 'boolean' as const,
        description: 'Never expire the alias',
      },
    },
    required: ['mailbox'],
    additionalProperties: false,
  };

  async execute(input: ToolInput, context: ToolContext): Promise<ToolHandlerResult> {
    try {
      this.logExecution(input, context, true);
      const denied = this.precheck(input, context, ['aliases:write', 'write']);
      if (denied) return denied;

      const { mailbox, domain, validity_hours, description, permanent } = input;
      if (typeof mailbox !== 'string') return this.invalid('mailbox must be a string');

      const alias = await this.aliasAPI.createTimeLimitedAlias({
        username: mailbox,
        domain: typeof domain === 'string' ? domain : undefined,
        validity: typeof validity_hours === 'number' ? validity_hours : undefined,
        description: typeof description === 'string' ? description : undefined,
        permanent: typeof permanent === 'boolean' ? permanent : undefined,
      });

      return {
        success: true,
        result: ToolUtils.createJsonResult({
          message: alias
            ? `Time-limited alias '${alias.address}' created for ${mailbox}`
            : `Time-limited alias created for ${mailbox}`,
          alias: alias ? formatTimeLimitedAlias(alias) : undefined,
        }),
      };
    } catch (error) {
      return this.handleError(error as Error, context);
    }
  }
}

/**
 * Delete a time-limited alias
 */
export class DeleteTimeLimitedAliasTool extends AliasTool {
  readonly name = 'delete_time_limited_alias';
  readonly description = 'Delete a time-limited (temporary/spam) alias. Put its address in address and set confirm to true';
  readonly inputSchema = {
    type: 'object' as const,
    properties: {
      address: {
        type: 'string' as const,
        description: 'Time-limited alias address to delete',
        pattern: EMAIL_PATTERN,
      },
      confirm: {
        type: 'boolean' as const,
        description: 'Confirmation that you want to delete the time-limited alias',
      },
    },
    required: ['address', 'confirm'],
    additionalProperties: false,
  };

  async execute(input: ToolInput, context: ToolContext): Promise<ToolHandlerResult> {
    try {
      this.logExecution(input, context, true);
      const denied = this.precheck(input, context, ['aliases:delete', 'write']);
      if (denied) return denied;

      const { address, confirm } = input;
      if (typeof address !== 'string') return this.invalid('address must be a string');
      if (confirm !== true) {
        return this.invalid('Time-limited alias deletion requires explicit confirmation (confirm: true)');
      }

      await this.aliasAPI.deleteTimeLimitedAlias(address);

      return {
        success: true,
        result: ToolUtils.createJsonResult({
          message: `Time-limited alias '${address}' deleted successfully`,
        }),
      };
    } catch (error) {
      return this.handleError(error as Error, context);
    }
  }
}

// Export all alias tools
export const AliasTools = {
  ListAliasesTool,
  CreateAliasTool,
  DeleteAliasTool,
  ListTimeLimitedAliasesTool,
  CreateTimeLimitedAliasTool,
  DeleteTimeLimitedAliasTool,
};
