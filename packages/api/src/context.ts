import type { Session } from "@pasinpay/auth";
import type { Database } from "@pasinpay/db";

export type Context = {
  session: Session | null;
  db: Database;
};
