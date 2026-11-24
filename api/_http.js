// Shared safety wrapper for Vercel API handlers: private responses are never
// cached, and unexpected implementation/Firestore errors never reach clients.
export function withApiSafety(handler, label = 'api') {
  return async function safeApiHandler(req, res) {
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    try {
      return await handler(req, res);
    } catch (error) {
      console.error(`[${label}] request failed:`, error?.stack || error?.message || error);
      if (res.headersSent) return res.end?.();
      return res.status(500).json({
        success: false,
        message: 'The request could not be completed. Please try again.',
      });
    }
  };
}
