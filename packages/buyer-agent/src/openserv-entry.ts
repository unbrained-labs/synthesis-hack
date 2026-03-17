import "dotenv/config";
import { startOpenServAgent } from "./openserv.js";

startOpenServAgent().catch((err) => {
  console.error("OpenServ agent failed:", err);
  process.exit(1);
});
