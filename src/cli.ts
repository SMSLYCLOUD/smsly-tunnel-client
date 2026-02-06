#!/usr/bin/env node
/**
 * SMSLY Tunnel CLI
 * 
 * Expose your local development server to the internet.
 * 
 * Usage:
 *   smsly-tunnel 3000
 *   smsly-tunnel 3000 --subdomain myapp
 *   smsly-tunnel 3000 --inspect
 *   smsly-tunnel tcp 5432
 *   smsly-tunnel login <token>
 *   smsly-tunnel whoami
 */

import { Command } from 'commander';
import { TunnelClient } from './client.js';
import { AuthManager, login, logout, whoami } from './auth.js';

const program = new Command();
const auth = new AuthManager();

program
    .name('smsly-tunnel')
    .description('Expose local servers to public URLs via SMSLY Tunnel')
    .version('1.0.0');

// Main HTTP tunnel command
program
    .command('http', { isDefault: true })
    .argument('<port>', 'Local port to tunnel', parseInt)
    .option('-s, --subdomain <name>', 'Custom subdomain (Pro/Team)')
    .option('-i, --inspect', 'Show incoming requests & open inspector UI')
    .option('--server <url>', 'Tunnel server URL')
    .option('--local', 'Use local development server')
    .action(async (port: number, options) => {
        const serverUrl = options.local
            ? 'ws://localhost:8080/ws/tunnel'
            : options.server || auth.getServerUrl();

        // Add auth token to URL if available
        let wsUrl = serverUrl;
        if (auth.isAuthenticated()) {
            const separator = serverUrl.includes('?') ? '&' : '?';
            wsUrl = `${serverUrl}${separator}token=${auth.getToken()}`;
        }

        const client = new TunnelClient({
            localPort: port,
            serverUrl: wsUrl,
            subdomain: options.subdomain || auth.getDefaultSubdomain(),
            inspect: options.inspect || false,
            inspectorPort: auth.getInspectorPort(),
        });

        // Handle graceful shutdown
        process.on('SIGINT', () => {
            client.stop();
            process.exit(0);
        });

        await client.connect();
    });

// TCP tunnel command (Team tier)
program
    .command('tcp')
    .description('Create TCP tunnel for databases (Team tier)')
    .argument('<port>', 'Local port to tunnel', parseInt)
    .option('--server <url>', 'Tunnel server URL')
    .action(async (port: number, options) => {
        if (!auth.isAuthenticated()) {
            console.log('TCP tunnels require authentication.');
            console.log('Run: smsly-tunnel login <token>');
            process.exit(1);
        }

        console.log(`TCP tunnels coming soon!`);
        console.log(`Will forward: tcp.tunnel.smsly.cloud:XXXXX → localhost:${port}`);
    });

// Auth commands
program
    .command('login')
    .description('Login with API token')
    .argument('<token>', 'API token from dashboard')
    .action(async (token: string) => {
        await login(token);
    });

program
    .command('logout')
    .description('Logout and clear saved token')
    .action(async () => {
        await logout();
    });

program
    .command('whoami')
    .description('Show current user info')
    .action(async () => {
        await whoami();
    });

// Config commands
program
    .command('config')
    .description('View or set configuration')
    .option('--subdomain <name>', 'Set default subdomain')
    .option('--inspector-port <port>', 'Set inspector port', parseInt)
    .option('--server <url>', 'Set default server URL')
    .option('--show', 'Show current config')
    .action((options) => {
        if (options.subdomain) {
            auth.setDefaultSubdomain(options.subdomain);
            console.log(`Default subdomain: ${options.subdomain}`);
        }
        if (options.inspectorPort) {
            auth.setInspectorPort(options.inspectorPort);
            console.log(`Inspector port: ${options.inspectorPort}`);
        }
        if (options.server) {
            auth.setServerUrl(options.server);
            console.log(`Server URL: ${options.server}`);
        }
        if (options.show || Object.keys(options).length === 0) {
            console.log(JSON.stringify(auth.getConfig(), null, 2));
        }
    });

// Subdomain management
program
    .command('subdomains')
    .description('Manage reserved subdomains (Pro/Team)')
    .option('--list', 'List reserved subdomains')
    .option('--reserve <name>', 'Reserve a subdomain')
    .option('--release <name>', 'Release a subdomain')
    .action(async (options) => {
        if (!auth.isAuthenticated()) {
            console.log('Subdomain management requires authentication.');
            console.log('Run: smsly-tunnel login <token>');
            process.exit(1);
        }

        const baseUrl = 'https://tunnel.smsly.cloud/api/v1';
        const headers = {
            'Authorization': `Bearer ${auth.getToken()}`,
            'Content-Type': 'application/json',
        };

        if (options.list || (!options.reserve && !options.release)) {
            try {
                const res = await fetch(`${baseUrl}/subdomains/`, { headers });
                const data = await res.json();
                console.log('Reserved subdomains:');
                if (data.subdomains?.length) {
                    data.subdomains.forEach((s: any) => {
                        console.log(`  - ${s.subdomain}.tunnel.smsly.cloud`);
                    });
                } else {
                    console.log('  (none)');
                }
                console.log(`Limit: ${data.limit === -1 ? 'unlimited' : data.limit}`);
            } catch (err) {
                console.log('Could not fetch subdomains');
            }
        }

        if (options.reserve) {
            try {
                const res = await fetch(`${baseUrl}/subdomains/`, {
                    method: 'POST',
                    headers,
                    body: JSON.stringify({ subdomain: options.reserve }),
                });
                if (res.ok) {
                    console.log(`✓ Reserved: ${options.reserve}.tunnel.smsly.cloud`);
                } else {
                    const err = await res.json();
                    console.log(`✗ ${err.error}`);
                }
            } catch (err) {
                console.log('Could not reserve subdomain');
            }
        }

        if (options.release) {
            try {
                const res = await fetch(`${baseUrl}/subdomains/${options.release}/`, {
                    method: 'DELETE',
                    headers,
                });
                if (res.ok) {
                    console.log(`✓ Released: ${options.release}`);
                } else {
                    const err = await res.json();
                    console.log(`✗ ${err.error}`);
                }
            } catch (err) {
                console.log('Could not release subdomain');
            }
        }
    });

program.parse();
