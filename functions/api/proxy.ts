/**
 * Cloudflare Pages Function to proxy Anthropic API requests.
 * Protects server-side API key and handles budget exhaustion gracefully.
 */

interface Env {
  ANTHROPIC_API_KEY: string;
}

// In-memory flag for budget exhaustion (resets on worker restart)
let budgetExhausted = false;

/**
 * GET /api/proxy - Returns quota status
 */
export const onRequestGet: PagesFunction<Env> = async () => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  return new Response(
    JSON.stringify({
      available: !budgetExhausted,
      message: budgetExhausted
        ? 'Demo quota exhausted. Please use your own API key.'
        : 'Demo quota available.',
    }),
    {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        ...corsHeaders,
      },
    }
  );
};

/**
 * POST /api/proxy - Forwards requests to Anthropic API
 */
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { request, env } = context;

  // CORS headers for browser requests
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  // Handle preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // Check if budget already exhausted
  if (budgetExhausted) {
    return new Response(
      JSON.stringify({
        error: {
          type: 'budget_exhausted',
          message: 'Demo quota exhausted. Please use your own API key.',
        },
      }),
      {
        status: 402, // Payment Required
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders,
        },
      }
    );
  }

  try {
    // Forward request to Anthropic
    const body = await request.json();

    const anthropicResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });

    // Check for billing/rate limit errors
    if (!anthropicResponse.ok) {
      const errorData = await anthropicResponse.json().catch(() => ({}));

      // Check for billing errors (insufficient credits, overloaded_error with billing)
      if (
        anthropicResponse.status === 429 ||
        anthropicResponse.status === 402 ||
        (errorData.error?.type &&
         ['insufficient_quota', 'rate_limit_error', 'overloaded_error'].includes(errorData.error.type))
      ) {
        console.log('Budget exhausted, setting flag');
        budgetExhausted = true;

        return new Response(
          JSON.stringify({
            error: {
              type: 'budget_exhausted',
              message: 'Demo quota exhausted. Please use your own API key.',
            },
          }),
          {
            status: 402,
            headers: {
              'Content-Type': 'application/json',
              ...corsHeaders,
            },
          }
        );
      }

      // Forward other errors as-is
      return new Response(JSON.stringify(errorData), {
        status: anthropicResponse.status,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders,
        },
      });
    }

    // Check if response is streaming
    const contentType = anthropicResponse.headers.get('content-type');
    if (contentType?.includes('text/event-stream')) {
      // Forward streaming response
      return new Response(anthropicResponse.body, {
        status: anthropicResponse.status,
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          ...corsHeaders,
        },
      });
    }

    // Forward JSON response
    const responseData = await anthropicResponse.json();
    return new Response(JSON.stringify(responseData), {
      status: anthropicResponse.status,
      headers: {
        'Content-Type': 'application/json',
        ...corsHeaders,
      },
    });
  } catch (error) {
    console.error('Proxy error:', error);
    return new Response(
      JSON.stringify({
        error: {
          type: 'proxy_error',
          message: 'Internal proxy error',
        },
      }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders,
        },
      }
    );
  }
};
