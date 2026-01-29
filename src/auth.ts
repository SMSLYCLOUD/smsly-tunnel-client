/**
 * SMSLY Tunnel Authentication
 * 
 * CLI authentication with API tokens for premium features.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import chalk from 'chalk';

const CONFIG_DIR = path.join(os.homedir(), '.smsly');
const CONFIG_FILE = path.join(CONFIG_DIR, 'tunnel-config.json');

export interface TunnelConfig {
  apiToken?: string;
  defaultSubdomain?: string;
  serverUrl?: string;
  inspectorPort?: number;
}

export class AuthManager {
  private config: TunnelConfig = {};

  constructor() {
    this.load();
  }

  private ensureConfigDir(): void {
    if (!fs.existsSync(CONFIG_DIR)) {
      fs.mkdirSync(CONFIG_DIR, { recursive: true });
    }
  }

  load(): void {
    try {
      if (fs.existsSync(CONFIG_FILE)) {
        const data = fs.readFileSync(CONFIG_FILE, 'utf-8');
        this.config = JSON.parse(data);
      }
    } catch (err) {
      console.error(chalk.yellow('Warning: Could not load config'));
    }
  }

  save(): void {
    try {
      this.ensureConfigDir();
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(this.config, null, 2));
    } catch (err) {
      console.error(chalk.red('Error: Could not save config'));
    }
  }

  getToken(): string | undefined {
    return this.config.apiToken;
  }

  setToken(token: string): void {
    this.config.apiToken = token;
    this.save();
  }

  getDefaultSubdomain(): string | undefined {
    return this.config.defaultSubdomain;
  }

  setDefaultSubdomain(subdomain: string): void {
    this.config.defaultSubdomain = subdomain;
    this.save();
  }

  getServerUrl(): string {
    return this.config.serverUrl || 'wss://tunnel.smsly.cloud/ws/tunnel';
  }

  setServerUrl(url: string): void {
    this.config.serverUrl = url;
    this.save();
  }

  getInspectorPort(): number {
    return this.config.inspectorPort || 4040;
  }

  setInspectorPort(port: number): void {
    this.config.inspectorPort = port;
    this.save();
  }

  isAuthenticated(): boolean {
    return !!this.config.apiToken;
  }

  logout(): void {
    delete this.config.apiToken;
    this.save();
  }

  getConfig(): TunnelConfig {
    return { ...this.config };
  }
}

export async function login(token: string): Promise<boolean> {
  const auth = new AuthManager();
  
  // Validate token with server
  try {
    const response = await fetch('https://tunnel.smsly.cloud/api/v1/auth/validate/', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    if (response.ok) {
      auth.setToken(token);
      console.log(chalk.green('✓ Logged in successfully'));
      return true;
    } else {
      console.log(chalk.red('✗ Invalid token'));
      return false;
    }
  } catch (err) {
    // For local development, accept any token
    auth.setToken(token);
    console.log(chalk.green('✓ Token saved (offline mode)'));
    return true;
  }
}

export async function logout(): Promise<void> {
  const auth = new AuthManager();
  auth.logout();
  console.log(chalk.dim('Logged out'));
}

export async function whoami(): Promise<void> {
  const auth = new AuthManager();
  
  if (!auth.isAuthenticated()) {
    console.log(chalk.yellow('Not logged in'));
    console.log(chalk.dim('Run: smsly-tunnel login <token>'));
    return;
  }

  try {
    const response = await fetch('https://tunnel.smsly.cloud/api/v1/auth/me/', {
      headers: {
        'Authorization': `Bearer ${auth.getToken()}`,
      },
    });

    if (response.ok) {
      const data = await response.json();
      console.log(chalk.bold('Logged in as:'), data.email || data.username);
      console.log(chalk.dim('Tier:'), data.tier || 'free');
    } else {
      console.log(chalk.yellow('Token may be expired'));
    }
  } catch (err) {
    console.log(chalk.dim('Could not verify token (offline)'));
  }
}
