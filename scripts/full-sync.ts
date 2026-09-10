import { getRuntimeEnv } from "../lib/database";
import { syncShiprocketOrders } from "../lib/shiprocket";

let page: number | undefined;
let imported = 0;
do {
  const result = await syncShiprocketOrders(getRuntimeEnv(), "full", "CLI full migration", {
    startPage: page,
    maxPages: 4,
  });
  imported += result.synced;
  page = result.hasMore ? result.nextPage : undefined;
  console.log(JSON.stringify({ imported, nextPage: page || null, totalPages: result.totalPages }));
} while (page);
