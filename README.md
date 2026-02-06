# SMSLY Tunnel Client

Expose your local development server to the internet with a public URL.

## Installation

```bash
npm install -g @smsly/tunnel
```

## Usage

### Basic Usage

```bash
# Expose port 3000
smsly-tunnel 3000

# Output:
# ╔═══════════════════════════════════════╗
# ║         SMSLY Tunnel Client           ║
# ╚═══════════════════════════════════════╝
#
# ✓ Tunnel established
#
#   Public URL:
#   → https://abc123.tunnel.smsly.cloud
#
#   Forwarding to localhost:3000
#
#   Press Ctrl+C to stop
```

### Custom Subdomain

```bash
smsly-tunnel 3000 --subdomain myapp
# → https://myapp.tunnel.smsly.cloud
```

### Inspect Mode

See all incoming requests in real-time:

```bash
smsly-tunnel 3000 --inspect

# Output:
# POST   /webhooks/smsly
#        → 200 (45ms)
# GET    /api/health
#        → 200 (12ms)
```

## Options

| Option | Description |
|--------|-------------|
| `--subdomain <name>` | Custom subdomain |
| `--inspect` | Show incoming requests |
| `--server <url>` | Custom tunnel server |
| `--local` | Use local dev server |

## Use Cases

- **Webhook Testing**: Test SMSLY SMS/Voice callbacks locally
- **Share Work**: Let teammates preview your local changes
- **Mobile Testing**: Test on real devices before deploying

## License

MIT
