let prisma = null;
let prismaPromise = null;

/**
 * Returns the shared PrismaClient instance. Always await this call — it is
 * async so that concurrent callers during the first initialization never
 * create more than one client (the promise is reused).
 */
async function getPrisma() {
  if (prisma) return prisma;
  if (prismaPromise) return prismaPromise;

  prismaPromise = (async () => {
    const { PrismaClient } = require('../generated/prisma/client');
    const { PrismaPg } = require('@prisma/adapter-pg');
    const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
    prisma = new PrismaClient({ adapter });
    return prisma;
  })();

  return prismaPromise;
}

module.exports = { getPrisma };
