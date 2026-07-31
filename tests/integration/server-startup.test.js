#!/usr/bin/env node

/**
 * Integration Test: Server Startup
 * Verifies a real MCP initialization handshake, tool discovery, and tool calls
 * using the supported SDK client.
 */

const path = require('path');
const assert = require('assert/strict');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');

const serverPath = path.join(__dirname, '../../dist/index.js');
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [serverPath, '--port', '3001'],
  stderr: 'pipe',
  env: {
    MAILCOW_API_URL: 'https://test.example.com',
    MAILCOW_API_KEY: 'test-api-key-with-enough-characters-to-pass-validation',
    MAILCOW_API_ACCESS_TYPE: 'read-only',
    MCP_SERVER_PORT: '3001',
    LOG_LEVEL: 'error',
  },
});
const client = new Client({ name: 'mailcow-mcp-integration-test', version: '1.0.0' });

async function withTimeout(promise, label, milliseconds = 10000) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} timed out after ${milliseconds}ms`)),
          milliseconds
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function run() {
  let stderr = '';
  transport.stderr.on('data', chunk => {
    stderr += chunk.toString();
  });

  try {
    await withTimeout(client.connect(transport), 'MCP initialization');

    const serverVersion = client.getServerVersion();
    assert.equal(serverVersion.name, 'mailcow-mcp');
    assert.equal(serverVersion.version, '0.1.3');

    const toolsResult = await withTimeout(client.listTools(), 'tools/list');
    const toolNames = toolsResult.tools.map(tool => tool.name);
    assert.ok(toolNames.length > 2, 'expected API tools to be registered');
    assert.ok(toolNames.includes('health_check'));
    assert.ok(toolNames.includes('get_config'));
    assert.ok(toolNames.includes('list_domains'));

    const healthResult = await withTimeout(
      client.callTool({ name: 'health_check', arguments: {} }),
      'health_check'
    );
    assert.notEqual(healthResult.isError, true);
    const health = JSON.parse(healthResult.content[0].text);
    assert.equal(health.status, 'healthy');
    assert.equal(health.server.version, '0.1.3');

    const configResult = await withTimeout(
      client.callTool({ name: 'get_config', arguments: {} }),
      'get_config'
    );
    assert.notEqual(configResult.isError, true);
    const config = JSON.parse(configResult.content[0].text);
    assert.equal(config.server.port, 3001);
    assert.equal(config.server.requestTimeout, 60000);
    assert.equal(config.api.timeout, 60000);
    assert.equal(config.api.hasKey, true);
    assert.equal(Object.hasOwn(config.api, 'key'), false);

    const forbiddenWriteResult = await withTimeout(
      client.callTool({ name: 'flush_queue', arguments: { confirm: true } }),
      'read-only permission check'
    );
    assert.equal(
      forbiddenWriteResult.isError,
      true,
      'read-only configuration must reject write operations'
    );

    assert.equal(stderr, '', `server wrote unexpected stderr: ${stderr}`);
    console.log(
      `✅ MCP initialized; ${toolsResult.tools.length} tools listed; tool calls and read-only enforcement succeeded`
    );
  } finally {
    await client.close();
  }
}

run().catch(error => {
  console.error(`❌ ${error.stack || error.message}`);
  process.exitCode = 1;
});
