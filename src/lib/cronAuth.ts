/**
 * Shared auth check for Vercel Cron endpoints.
 *
 * Verifies the caller supplied the exact CRON_SECRET configured for this
 * deployment via the standard `Authorization: Bearer <secret>` header
 * (the header Vercel Cron Jobs send when CRON_SECRET is set on the
 * project). Fails closed if CRON_SECRET isn't configured at all, and
 * never logs or returns the secret itself.
 */
import crypto from 'crypto'
import { NextRequest } from 'next/server'

export function verifyCronSecret(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET
  if (!expected) return false

  const authHeader = req.headers.get('authorization') || ''
  const provided = authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : ''

  const expectedBuf = Buffer.from(expected)
  const providedBuf = Buffer.from(provided)

  if (expectedBuf.length !== providedBuf.length) return false
  return crypto.timingSafeEqual(expectedBuf, providedBuf)
}
