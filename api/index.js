const { createBackendHandler, createDefaultServices } = require("../services/api/src/bootstrap/http-api.ts");

const services = createDefaultServices({ env: process.env });
const handle = createBackendHandler(services);

module.exports = (request, response) => handle(request, response);
