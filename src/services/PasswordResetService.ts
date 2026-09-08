import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import prisma from '@/lib/prisma';
import { EmailService } from './EmailService';
import { getAppUrl } from '@/lib/env';

/**
 * Password Reset Service
 * Secure token-based password reset — mirrors EmailVerificationService's
 * token lifecycle (random token, SHA-256 hash stored, upsert-by-userId,
 * expiry + single-use, constant-time comparison).
 */

interface ResetTokenResult {
  success: boolean;
  message: string;
  token?: string;
}

interface ResetPasswordResult {
  success: boolean;
  message: string;
}

export class PasswordResetService {
  /**
   * Token expiration time (1 hour)
   */
  private static readonly TOKEN_EXPIRY_MS = 60 * 60 * 1000;

  /**
   * Generate secure reset token
   * Cryptographically secure random token
   */
  static generateToken(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  /**
   * Create a password reset token for a user and email the reset link.
   * A new request always invalidates any previously issued token
   * (upsert on the unique userId column).
   */
  static async createResetToken(
    userId: string,
    email: string
  ): Promise<ResetTokenResult> {
    try {
      const token = this.generateToken();
      const hashedToken = crypto.createHash('sha256').update(token).digest('hex');
      const expiresAt = new Date(Date.now() + this.TOKEN_EXPIRY_MS);

      await prisma.passwordResetToken.upsert({
        where: { userId },
        update: {
          hashedToken,
          expiresAt,
          createdAt: new Date(),
        },
        create: {
          userId,
          hashedToken,
          expiresAt,
        },
      });

      console.log('[PasswordReset] Reset token created');

      const appUrl = getAppUrl();
      const resetUrl = `${appUrl}/reset-password?token=${token}&userId=${userId}`;
      const emailResult = await EmailService.sendPasswordResetEmail(email, resetUrl);

      if (!emailResult.success) {
        console.error('[PasswordReset] Failed to send reset email:', emailResult.error);
      }

      return {
        success: true,
        message: 'Reset token created',
        token, // Returned for the email link only — never logged, never persisted raw.
      };
    } catch (error) {
      console.error('[PasswordReset] Token creation failed:', error);
      return {
        success: false,
        message: 'Failed to create reset token',
      };
    }
  }

  /**
   * Reset a user's password using a token.
   * Token is validated against its hash + expiration, then deleted
   * (single-use) regardless of outcome once consumed successfully.
   */
  static async resetPassword(
    userId: string,
    token: string,
    newPassword: string
  ): Promise<ResetPasswordResult> {
    try {
      const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

      const tokenRecord = await prisma.passwordResetToken.findUnique({
        where: { userId },
      });

      if (!tokenRecord) {
        return {
          success: false,
          message: 'Invalid or expired reset link',
        };
      }

      if (new Date() > tokenRecord.expiresAt) {
        await prisma.passwordResetToken.delete({ where: { userId } });
        return {
          success: false,
          message: 'Invalid or expired reset link',
        };
      }

      if (!this.timingSafeCompare(hashedToken, tokenRecord.hashedToken)) {
        return {
          success: false,
          message: 'Invalid or expired reset link',
        };
      }

      const hashedPassword = await bcrypt.hash(newPassword, 10);
      const now = new Date();

      await prisma.user.update({
        where: { id: userId },
        data: {
          password: hashedPassword,
          // Stamps the moment the password changed so any JWT session
          // issued before this instant can be invalidated (see
          // src/auth.ts's jwt callback).
          passwordChangedAt: now,
        },
      });

      // Single-use: delete the token now that it has been consumed.
      await prisma.passwordResetToken.delete({ where: { userId } });

      console.log('[PasswordReset] Password reset completed');

      return {
        success: true,
        message: 'Password has been reset successfully',
      };
    } catch (error) {
      console.error('[PasswordReset] Reset failed:', error);
      return {
        success: false,
        message: 'Failed to reset password',
      };
    }
  }

  /**
   * Timing-safe string comparison
   * Prevents timing attacks
   */
  private static timingSafeCompare(a: string, b: string): boolean {
    if (a.length !== b.length) {
      return false;
    }

    let result = 0;
    for (let i = 0; i < a.length; i++) {
      result |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }

    return result === 0;
  }
}
