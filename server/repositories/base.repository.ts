import type { NeonDatabase } from "drizzle-orm/neon-serverless";
import type * as schema from "@shared/schema";

export class BaseRepository {
  constructor(protected db: NeonDatabase<typeof schema>) {}
}
