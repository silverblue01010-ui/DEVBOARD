// Re-exports the generated Prisma client. Run `npm run db:generate` first —
// this requires network access to binaries.prisma.sh to fetch the query engine,
// which is not reachable from this build sandbox (see README "Known sandbox
// limitations"). In any normal dev/CI environment with outbound internet,
// `prisma generate` populates @prisma/client and this re-export resolves.
export * from "@prisma/client";
