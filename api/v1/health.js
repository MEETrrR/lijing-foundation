module.exports = function health(_request, response) {
  response.status(200).json({ status: "ok", ai_configured: false });
};
