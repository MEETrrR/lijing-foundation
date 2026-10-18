import { ensureDatabaseTunnel } from "./ensure-database-tunnel.mjs";

await ensureDatabaseTunnel();
await import("../apps/user_client/server.mjs");
