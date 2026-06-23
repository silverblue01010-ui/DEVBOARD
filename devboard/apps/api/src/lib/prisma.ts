import { PrismaClient } from "@devboard/db";

// Lazily instantiated: importing this module (transitively, by any file that needs
// `prisma` for some but not all of its exports) must not eagerly construct a real
// client. The client is only constructed on first actual property access, so pure
// helper functions living alongside DB-touching ones can still be imported/tested
// without a database connection or a generated client present.
let _client: PrismaClient | null = null;

function getClient(): PrismaClient {
  if (!_client) {
    _client = new PrismaClient();
  }
  return _client;
}

export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop, receiver) {
    return Reflect.get(getClient() as object, prop, receiver);
  },
});
