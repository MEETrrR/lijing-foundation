module.exports = function assist(_request, response) {
  response.status(503).json({ error: "ai_not_configured", message: "AI is not configured for this public demo" });
};
