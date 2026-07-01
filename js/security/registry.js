// Caches the backend registry (module/event/stage vocabulary + bounds) so forms
// are populated from the server, never hardcoded in the frontend.
import { api } from "./api.js";

let cache = null;

export async function getRegistry() {
  if (!cache) cache = await api.get("/registry");
  return cache;
}

export function invalidate() { cache = null; }
