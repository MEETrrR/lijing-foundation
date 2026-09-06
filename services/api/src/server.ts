const { createBackendServer } = require("./bootstrap/http-api.ts");

const port = Number(process.env.PORT ?? 4400);
const host = process.env.HOST ?? "127.0.0.1";
const { server } = createBackendServer();

server.listen(port, host, () => {
  console.log(`lijing api listening on http://${host}:${port}`);
});

module.exports = { server };
