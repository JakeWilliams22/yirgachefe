# Proxy Mode Setup

This guide explains how to set up the demo quota proxy on Cloudflare Pages.

## How It Works

The app now supports two modes:
1. **Demo Quota Mode**: Users can try the app using your shared API key (with budget protection)
2. **User API Key Mode**: Users bring their own Anthropic API key

When the demo quota is exhausted, users are automatically prompted to use their own API key.

## Cloudflare Pages Setup

### 1. Deploy to Cloudflare Pages

Your existing Cloudflare Pages deployment will automatically pick up the new `/functions/api/proxy.ts` endpoint.

### 2. Set Environment Variable

In your Cloudflare Pages dashboard:

1. Go to your project
2. Navigate to **Settings** → **Environment variables**
3. Add a new variable:
   - **Variable name**: `ANTHROPIC_API_KEY`
   - **Value**: Your Anthropic API key (starts with `sk-ant-`)
   - **Environment**: Production (and Preview if desired)
4. Click **Save**

### 3. Redeploy

After adding the environment variable:
- Trigger a new deployment (push to git or use "Retry deployment")
- The proxy endpoint will be available at `/api/proxy`

## API Endpoints

### `GET /api/proxy` - Check Quota Status
Returns the current quota availability (fast, free check):

```json
{
  "available": true,
  "message": "Demo quota available."
}
```

### `POST /api/proxy` - Proxy API Requests
Forwards requests to Anthropic API (same format as direct API calls).

## How Budget Protection Works

The proxy uses a simple in-memory flag to track budget exhaustion:

1. When Anthropic returns a 429 (rate limit) or 402 (billing) error, the flag is set
2. Subsequent requests immediately return 402 without calling Anthropic
3. The status endpoint (`GET /api/proxy`) returns the flag state instantly
4. Flag resets when the Cloudflare Worker restarts (happens automatically)

This means:
- ✅ Your API key is never exposed to users
- ✅ Once budget hits, no more calls are made
- ✅ No database needed
- ✅ Instant status checks (no API call cost)
- ⚠️ Flag resets on worker restart (fine for this use case)

## Testing Locally

To test the proxy locally with Wrangler:

```bash
# Install Wrangler (if not already installed)
npm install -g wrangler

# Create a .dev.vars file for local development
echo "ANTHROPIC_API_KEY=your-api-key-here" > .dev.vars

# Run local dev server
npx wrangler pages dev dist --compatibility-date=2025-01-01
```

## Cost Management

With your $50 budget on Anthropic:
- Average run costs ~$2-3
- You can support ~15-25 users before exhaustion
- Consider increasing budget or setting up usage alerts in Anthropic Console

## Monitoring

Check your Anthropic usage:
1. Go to https://console.anthropic.com/settings/usage
2. Set up billing alerts if desired

## Security Notes

- The proxy only forwards to Anthropic's API
- No user data is logged or stored
- API key is only accessible server-side
- CORS is open to allow any origin (fine for public demo)
