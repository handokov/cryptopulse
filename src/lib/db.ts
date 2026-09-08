import { PrismaClient } from '@prisma/client'
import { PrismaLibSQL } from '@prisma/adapter-libsql'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

/**
 * Dual-mode Prisma client:
 * - Local development: plain client over DATABASE_URL (SQLite file at
 *   db/custom.db) — unchanged behavior, no external services needed.
 * - Production (Vercel + Turso): when TURSO_DATABASE_URL is set, attach the
 *   libSQL driver adapter instead. Serverless platforms have no persistent
 *   filesystem, so the hosted database lives on Turso (libSQL cloud).
 *
 * Neither constructor opens an eager connection, so importing this module is
 * safe during build even before credentials exist.
 */
function createPrismaClient(): PrismaClient {
  const tursoUrl = process.env.TURSO_DATABASE_URL
  if (tursoUrl) {
    // @prisma/adapter-libsql v6.19+ takes the libSQL Config directly and
    // creates the underlying client itself.
    return new PrismaClient({
      adapter: new PrismaLibSQL({
        url: tursoUrl,
        authToken: process.env.TURSO_AUTH_TOKEN,
      }),
    })
  }
  return new PrismaClient({
    log: process.env.NODE_ENV === 'production' ? undefined : ['query'],
  })
}

export const db = globalForPrisma.prisma ?? createPrismaClient()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db
