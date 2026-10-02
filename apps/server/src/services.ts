import { createAuth } from "@pasinpay/auth";
import { createDb } from "@pasinpay/db";

import { ENV } from "./env.server";

export const db = createDb(ENV);
export const auth = createAuth(ENV, db);
