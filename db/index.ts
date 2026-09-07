import { getRuntimeEnv } from "../lib/database";

export function getDb() {
  return getRuntimeEnv().DB;
}
