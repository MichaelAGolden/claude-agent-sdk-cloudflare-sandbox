/**
 * @fileoverview Admin endpoints for Claude Agent SDK Server
 *
 * Provides administrative endpoints for server control like restart.
 *
 * @module routes/admin
 */

import { Express, Request, Response } from "express";

/**
 * Restart response payload.
 */
interface RestartResponse {
  status: "restarting";
  message: string;
}

/**
 * Handles restart requests.
 *
 * @description
 * Triggers a graceful shutdown of the server process, allowing the container's
 * restart loop (defined in Dockerfile) to restart the agent. This is called
 * when skills are uploaded or deleted to ensure the SDK picks up changes.
 *
 * @param req - Express request
 * @param res - Express response
 */
function restartHandler(req: Request, res: Response<RestartResponse>): void {
  console.log("[Agent] Restart requested - shutting down to reload skills...");

  res.json({
    status: "restarting",
    message: "Agent will restart to reload skills"
  });

  // Give time for response to be sent, then exit
  // The restart loop in the Dockerfile will restart the process
  setTimeout(() => {
    console.log("[Agent] Exiting for restart...");
    process.exit(0);
  }, 100);
}

/**
 * Registers admin routes on the Express app.
 *
 * @param app - The Express application
 *
 * @example
 * import { registerAdminRoutes } from './routes/admin';
 * registerAdminRoutes(app);
 */
export function registerAdminRoutes(app: Express): void {
  app.post("/restart", restartHandler);
}

export default registerAdminRoutes;
