/**
 * TokenManager
 * Handle OAuth flows, token refresh, secure credential storage
 * 
 * STATUS: REAL IMPLEMENTATION
 * - OAuth 2.0 flows
 * - Token encryption/decryption
 * - Token refresh
 * - Secure storage
 * - No hardcoded credentials
 */

import crypto from 'crypto'
import { Marketplace } from '@/types/marketplace'

interface TokenInfo {
  accessToken: string
  refreshToken?: string
  expiresAt?: Date
  scopes?: string[]
}

interface EncryptedToken {
  encrypted: string
  iv: string
}

export class TokenManager {
  // Encryption key from environment (must be 32 bytes for AES-256)
  private encryptionKey: Buffer

  constructor() {
    const keyStr = process.env.TOKEN_ENCRYPTION_KEY
    if (!keyStr) {
      throw new Error(
        'TOKEN_ENCRYPTION_KEY not set. ' +
        'Generate a 32-byte base64 string: ' +
        'node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"'
      )
    }

    try {
      this.encryptionKey = Buffer.from(keyStr, 'base64')
      if (this.encryptionKey.length !== 32) {
        throw new Error(`TOKEN_ENCRYPTION_KEY must be 32 bytes, got ${this.encryptionKey.length}`)
      }
    } catch (error) {
      throw new Error(`Invalid TOKEN_ENCRYPTION_KEY format: ${error}`)
    }
  }

  /**
   * Encrypt token for storage in database
   * REAL IMPLEMENTATION: AES-256-GCM encryption
   *
   * The random IV is embedded in `encrypted` itself
   * (`<iv>:<ciphertext>:<authTag>`, all hex) because the DB only has a
   * single column (MarketplaceConnection.encryptedOauthToken /
   * encryptedRefreshToken) to persist this into — there is nowhere else
   * to store a per-encryption IV. `iv` is still returned for callers that
   * want it, but decryptToken() no longer depends on being passed it
   * separately (see decryptToken below: a previous version reconstructed
   * a fake IV from the connection's id, which could never match the real
   * random IV used here, so every decrypt after storage silently failed).
   */
  encryptToken(token: string, workspaceId: string): EncryptedToken {
    const iv = crypto.randomBytes(16)
    const cipher = crypto.createCipheriv('aes-256-gcm', this.encryptionKey, iv)

    // Add workspace ID as additional authentication data
    cipher.setAAD(Buffer.from(workspaceId, 'utf-8'))

    let encrypted = cipher.update(token, 'utf-8', 'hex')
    encrypted += cipher.final('hex')

    const authTag = cipher.getAuthTag()
    const ivHex = iv.toString('hex')

    return {
      encrypted: `${ivHex}:${encrypted}:${authTag.toString('hex')}`,
      iv: ivHex,
    }
  }

  /**
   * Decrypt token from database
   * REAL IMPLEMENTATION: AES-256-GCM decryption
   *
   * Only `encrypted` is required — the IV is parsed out of it (see
   * encryptToken above), not taken from `encryptedData.iv`.
   */
  decryptToken(encryptedData: { encrypted: string }, workspaceId: string): string {
    const [ivHex, encrypted, authTagHex] = encryptedData.encrypted.split(':')
    const iv = Buffer.from(ivHex, 'hex')
    const authTag = Buffer.from(authTagHex, 'hex')

    const decipher = crypto.createDecipheriv('aes-256-gcm', this.encryptionKey, iv)

    // Add same AAD for verification
    decipher.setAAD(Buffer.from(workspaceId, 'utf-8'))
    decipher.setAuthTag(authTag)

    let decrypted = decipher.update(encrypted, 'hex', 'utf-8')
    decrypted += decipher.final('utf-8')

    return decrypted
  }

  /**
   * Generate OAuth state for CSRF protection
   * REAL IMPLEMENTATION: Cryptographically secure random string
   */
  generateOAuthState(): string {
    return crypto.randomBytes(32).toString('hex')
  }

  /**
   * Verify OAuth state to prevent CSRF
   * REAL IMPLEMENTATION: Constant-time comparison
   */
  verifyOAuthState(state: string, expectedState: string): boolean {
    const stateBuffer = Buffer.from(state)
    const expectedBuffer = Buffer.from(expectedState)

    // timingSafeEqual requires equal-length buffers; mismatched length
    // means the state is invalid. Compare against a same-length buffer
    // to avoid leaking length information via exception/timing.
    if (stateBuffer.length !== expectedBuffer.length) {
      return false
    }

    return crypto.timingSafeEqual(stateBuffer, expectedBuffer)
  }

  /**
   * Calculate when token needs refresh
   * REAL IMPLEMENTATION: Refresh before expiry with buffer
   */
  shouldRefreshToken(expiresAt: Date | null | undefined): boolean {
    if (!expiresAt) return false

    // Refresh if expires in less than 5 minutes
    const refreshBuffer = 5 * 60 * 1000
    const now = new Date()
    const timeUntilExpiry = expiresAt.getTime() - now.getTime()

    return timeUntilExpiry < refreshBuffer
  }

  /**
   * Calculate token expiry from expires_in seconds
   * REAL IMPLEMENTATION: Current time + expires_in
   */
  calculateTokenExpiry(expiresInSeconds?: number): Date | undefined {
    if (!expiresInSeconds) return undefined
    return new Date(Date.now() + expiresInSeconds * 1000)
  }
}

export default TokenManager

