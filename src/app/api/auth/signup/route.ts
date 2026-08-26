import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { signUpSchema } from '@/lib/validations';
import prisma from '@/lib/prisma';
import { rateLimiter, RateLimiterService } from '@/lib/ratelimit';
import { EmailVerificationService } from '@/services/EmailVerificationService';
import { isReservedAdminEmail } from '@/lib/admin';

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

    // Create user
    const user = await prisma.user.create({
      data: {
        email: result.data.email,
        password: hashedPassword,
        name: result.data.name,
        country: result.data.country,
      },
    });

    // Create free subscription
    const freePlan = await prisma.plan.findUnique({
      where: { name: 'free' },
    });

    if (!freePlan) {
      throw new Error('Free plan not found');
    }

    const subscription = await prisma.subscription.create({
      data: {
        planId: freePlan.id,
        status: 'active',
      },
    });

    // Create default workspace
    const workspace = await prisma.workspace.create({
      data: {
        name: `${user.name}'s Workspace`,
        slug: user.email.split('@')[0].toLowerCase().replace(/\./g, '-'),
        userId: user.id,
        subscriptionId: subscription.id,
        country: user.country || 'FR',
      },
    });

    // Send email verification link (best-effort — signup already succeeded)
    await EmailVerificationService.createVerificationToken(user.id, user.email);

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
    console.error('Signup error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
