import path from "node:path";
import { fileURLToPath } from "node:url";
import { JsonStore } from "./store.mjs";
import { loadMasterKey } from "./crypto.mjs";
import { createApp } from "./app.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = path.resolve(process.env.EVALHUB_DATA_DIR || path.join(root, "data"));
const store = await new JsonStore(path.join(dataDir, "evalhub.json")).init();
const key = await loadMasterKey(dataDir);
const app = createApp({ store, key, staticDir: path.join(root, "dist", "client") });
const port = Number(process.env.PORT || 8787);
const host = process.env.HOST || "127.0.0.1";
app.listen(port, host, () => console.log(`EvalHub is running at http://${host}:${port}`));
