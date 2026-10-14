import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { signUpSchema } from '@/lib/validations';
import prisma from '@/lib/prisma';
import { rateLimiter, RateLimiterService } from '@/lib/ratelimit';
import { EmailVerificationService } from '@/services/EmailVerificationService';
import { isReservedAdminEmail } from '@/lib/admin';
import { provisionUser } from '@/lib/auth/provisionUser';

export async function POST(request: NextRequest) {
  try {
    // Rate limit by IP (signup: 3 per hour)
    const clientIP = RateLimiterService.getClientIP(request);
    const rateLimitResult = await rateLimiter.checkSignup(clientIP);
    
    if (!rateLimitResult.success) {
      return NextResponse.json(
        {
          error: 'Too many signup attempts. Please try again later.',
          retryAfter: Math.ceil((rateLimitResult.resetAt.getTime() - Date.now()) / 1000),
        },
        {
          status: 429,
          headers: {
            'Retry-After': Math.ceil((rateLimitResult.resetAt.getTime() - Date.now()) / 1000).toString(),
            'X-RateLimit-Limit': rateLimitResult.limit.toString(),
            'X-RateLimit-Remaining': rateLimitResult.remaining.toString(),
            'X-RateLimit-Reset': rateLimitResult.resetAt.toISOString(),
          },
        }
      );
    }

    const data = await request.json();

    // Validate input
    const result = signUpSchema.safeParse(data);
    if (!result.success) {
      return NextResponse.json(
        { error: 'Invalid input', details: result.error.errors },
        { status: 400 }
      );
    }

    // SECURITY: Block self-registration of the reserved admin email(s) —
    // otherwise anyone could sign up as ADMIN_EMAIL and inherit admin
    // access. Same error/status as an existing account so the response
    // doesn't reveal that this particular email is the reserved one.
    if (isReservedAdminEmail(result.data.email)) {
      return NextResponse.json(
        { error: 'User already exists' },
        { status: 400 }
      );
    }

    // Check if user exists
    const existingUser = await prisma.user.findUnique({
      where: { email: result.data.email },
    });

    if (existingUser) {
      return NextResponse.json(
        { error: 'User already exists' },
        { status: 400 }
      );
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(result.data.password, 10);

    // Create user + free subscription + default workspace, atomically —
    // the same shared provisioning Google sign-in uses (see
    // src/lib/auth/provisionUser.ts). preVerifiedEmail: false — the
    // existing email verification flow below still runs unchanged.
    const { user, workspace } = await provisionUser({
      email: result.data.email,
      password: hashedPassword,
      name: result.data.name,
      country: result.data.country,
      preVerifiedEmail: false,
    });

    // Send email verification link. The account is already created at this
    // point and must stay created regardless of what happens here — never
    // turn an email-delivery problem into a failed signup (no 500, no
    // rollback). The result is still inspected (audit fix) so a failed
    // send is at least loud in the server logs instead of being silently
    // treated as if the email had gone out.
    const verificationResult = await EmailVerificationService.createVerificationToken(user.id, user.email);
    if (!verificationResult.success) {
      console.error(
        `[Signup] Account ${user.id} created, but the verification email could not be sent:`,
        verificationResult.error ?? verificationResult.message
      );
    }

    return NextResponse.json(
      {
        success: true,
        message: 'User created successfully',
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
        },
        workspace: {
          id: workspace.id,
          name: workspace.name,
          slug: workspace.slug,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    // Signup race fix — the findUnique check above has a real TOCTOU
    // window: two concurrent requests for the same email can both pass it
    // and both reach provisionUser, whose own tx.user.create then hits
    // the real User_email_key constraint for the losing request. That is
    // the exact same "User already exists" outcome the check above
    // already returns a clean 400 for — never a server failure. Matches
    // this project's own established P2002-disambiguation convention
    // (see src/services/ProductService.ts's own target-based check):
    // never assumes every P2002 here is the email conflict — only one
    // whose meta.target actually names it.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const target = error.meta?.target;
      const fields = Array.isArray(target) ? target : typeof target === 'string' ? [target] : [];
      if (fields.includes('email')) {
        return NextResponse.json(
          { error: 'User already exists' },
          { status: 400 }
        );
      }
    }

    console.error('Signup error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
