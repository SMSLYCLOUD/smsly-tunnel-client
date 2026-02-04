/**
 * SMSLY Tunnel Client
 * 
 * WebSocket-based tunnel client that forwards requests
 * from the tunnel server to the local development server.
 */

import WebSocket from 'ws';
import http from 'http';
import chalk from 'chalk';
import ora, { Ora } from 'ora';
import { Inspector, InspectedRequest } from './inspector.js';

export interface TunnelClientOptions {
    localPort: number;
    serverUrl: string;
    subdomain?: string;
    inspect?: boolean;
    inspectorPort?: number;
}

interface TunnelMessage {
    type: 'connected' | 'request' | 'response' | 'error';
    tunnel_id?: string;
    subdomain?: string;
    public_url?: string;
    request_id?: string;
    method?: string;
    path?: string;
    headers?: Record<string, string>;
    body?: string;
    status?: number;
    error?: string;
    is_replay?: boolean;
}

export class TunnelClient {
    private ws: WebSocket | null = null;
    private spinner: Ora | null = null;
    private running = false;
    private requestCount = 0;
    private publicUrl: string | null = null;
    private inspector: Inspector | null = null;

    constructor(private options: TunnelClientOptions) {
        if (options.inspect) {
            this.inspector = new Inspector(options.inspectorPort || 4040);
        }
    }

    private printBanner(): void {
        console.log();
        console.log(chalk.bold.blue('╔═══════════════════════════════════════╗'));
        console.log(chalk.bold.blue('║') + '         SMSLY Tunnel Client           ' + chalk.bold.blue('║'));
        console.log(chalk.bold.blue('╚═══════════════════════════════════════╝'));
        console.log();
    }

    private printConnected(data: TunnelMessage): void {
        this.publicUrl = data.public_url || '';

        console.log(chalk.green('✓') + ' Tunnel established');
        console.log();
        console.log(chalk.bold('  Public URL:'));
        console.log(chalk.cyan(`  → ${this.publicUrl}`));
        console.log();
        console.log(chalk.dim(`  Forwarding to localhost:${this.options.localPort}`));
        console.log();
        console.log(chalk.dim('  Press Ctrl+C to stop'));
        console.log();
    }

    private printRequest(data: TunnelMessage): void {
        if (!this.options.inspect) return;

        this.requestCount++;
        const method = data.method || 'GET';
        const path = data.path || '/';
        const replay = data.is_replay ? chalk.yellow(' [REPLAY]') : '';

        const methodColor = {
            GET: chalk.green,
            POST: chalk.yellow,
            PUT: chalk.blue,
            DELETE: chalk.red,
            PATCH: chalk.magenta,
        }[method] || chalk.white;

        console.log(`  ${methodColor(method.padEnd(6))} ${path}${replay}`);
    }

    private async forwardRequest(data: TunnelMessage): Promise<TunnelMessage> {
        return new Promise((resolve) => {
            const startTime = Date.now();

            const headers: Record<string, string | undefined> = { ...data.headers };
            // Remove host header
            delete headers['host'];
            delete headers['Host'];

            const options: http.RequestOptions = {
                hostname: 'localhost',
                port: this.options.localPort,
                path: data.path,
                method: data.method,
                headers,
            };

            const req = http.request(options, (res) => {
                const chunks: Buffer[] = [];

                res.on('data', (chunk) => chunks.push(chunk));
                res.on('end', () => {
                    const body = Buffer.concat(chunks).toString('utf-8');
                    const responseTime = Date.now() - startTime;

                    if (this.options.inspect) {
                        const statusColor = res.statusCode! < 400 ? chalk.green : chalk.red;
                        console.log(chalk.dim(`         → ${statusColor(res.statusCode)} (${responseTime}ms)`));
                    }

                    resolve({
                        type: 'response',
                        request_id: data.request_id,
                        status: res.statusCode,
                        headers: res.headers as Record<string, string>,
                        body,
                    });
                });
            });

            req.on('error', (err) => {
                if (this.options.inspect) {
                    console.log(chalk.dim(`         → ${chalk.red('ERROR')} ${err.message}`));
                }

                resolve({
                    type: 'response',
                    request_id: data.request_id,
                    status: 502,
                    body: `Cannot connect to localhost:${this.options.localPort}: ${err.message}`,
                });
            });

            if (data.body) {
                req.write(data.body);
            }

            req.end();
        });
    }

    async connect(): Promise<void> {
        this.printBanner();
        this.running = true;

        // Start inspector if enabled
        if (this.inspector) {
            await this.inspector.start();
        }

        // Build WebSocket URL
        let wsUrl = this.options.serverUrl;
        if (this.options.subdomain) {
            wsUrl += `?subdomain=${this.options.subdomain}`;
        }

        this.spinner = ora('Connecting to tunnel server...').start();

        try {
            this.ws = new WebSocket(wsUrl);

            this.ws.on('open', () => {
                this.spinner?.succeed('Connected to tunnel server');
            });

            this.ws.on('message', async (rawData) => {
                try {
                    const data: TunnelMessage = JSON.parse(rawData.toString());

                    if (data.type === 'connected') {
                        this.printConnected(data);
                    } else if (data.type === 'request') {
                        this.printRequest(data);

                        // Log to inspector
                        if (this.inspector) {
                            this.inspector.logRequest({
                                id: data.request_id || '',
                                method: data.method || 'GET',
                                path: data.path || '/',
                                headers: data.headers || {},
                                body: data.body,
                                timestamp: new Date(),
                            });
                        }

                        const startTime = Date.now();
                        const response = await this.forwardRequest(data);

                        // Log response to inspector
                        if (this.inspector && data.request_id) {
                            this.inspector.logResponse(data.request_id, {
                                status: response.status || 502,
                                headers: response.headers || {},
                                body: response.body,
                                duration: Date.now() - startTime,
                            });
                        }

                        this.ws?.send(JSON.stringify(response));
                    } else if (data.error) {
                        console.log(chalk.red(`Error: ${data.error}`));
                        this.stop();
                    }
                } catch (err) {
                    console.error('Failed to parse message:', err);
                }
            });

            this.ws.on('close', () => {
                if (this.running) {
                    console.log(chalk.yellow('\nConnection closed'));
                }
                this.running = false;
            });

            this.ws.on('error', (err) => {
                this.spinner?.fail('Connection failed');
                console.error(chalk.red(`Error: ${err.message}`));
                this.running = false;
            });

            // Keep alive
            await new Promise<void>((resolve) => {
                const check = setInterval(() => {
                    if (!this.running) {
                        clearInterval(check);
                        resolve();
                    }
                }, 100);
            });

        } catch (err) {
            this.spinner?.fail('Failed to connect');
            throw err;
        }
    }

    stop(): void {
        this.running = false;
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        if (this.inspector) {
            this.inspector.stop();
        }
        console.log(chalk.dim('\nTunnel closed'));
    }
}
