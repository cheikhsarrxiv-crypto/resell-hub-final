/**
 * Rate Limiter Tests
 * Tests réels sans dépendances externes
 */

import { rateLimiter, RateLimitResult } from '@/lib/ratelimit';

interface TestResult {
  name: string;
  passed: boolean;
  message: string;
}

async function testRateLimiter(): Promise<{
  passed: number;
  failed: number;
  total: number;
  results: TestResult[];
}> {
  const results: TestResult[] = [];
  let passed = 0;
  let failed = 0;

  console.log('\n🧪 RATE LIMITER TESTS\n');

  // Test 1: First request succeeds
  console.log('Test 1: First login attempt...');
  const test1 = await rateLimiter.checkLogin('user@example.com');
  if (test1.success && test1.remaining === 4) {
    console.log('  ✓ PASS - First request allowed, remaining: 4');
    results.push({
      name: 'First login attempt succeeds',
      passed: true,
      message: 'Request allowed, remaining: 4',
    });
    passed++;
  } else {
    console.log('  ✗ FAIL - First request should succeed');
    results.push({
      name: 'First login attempt succeeds',
      passed: false,
      message: `Got remaining: ${test1.remaining}`,
    });
    failed++;
  }

  // Test 2: Multiple requests within limit
  console.log('\nTest 2: 4 more login attempts (within 5-per-15min limit)...');
  const user = 'user2@example.com';
  let allWithinLimit = true;
  for (let i = 0; i < 4; i++) {
    const result = await rateLimiter.checkLogin(user);
    if (!result.success || result.remaining < 0) {
      allWithinLimit = false;
      break;
    }
    console.log(`  Attempt ${i + 1}: success=${result.success}, remaining=${result.remaining}`);
  }

  if (allWithinLimit) {
    console.log('  ✓ PASS - All 4 requests allowed');
    results.push({
      name: 'Multiple requests within limit',
      passed: true,
      message: '4 requests allowed successfully',
    });
    passed++;
  } else {
    console.log('  ✗ FAIL - Requests incorrectly limited');
    results.push({
      name: 'Multiple requests within limit',
      passed: false,
      message: 'One or more requests blocked',
    });
    failed++;
  }

  // Test 3: Rate limit exceeded (6th request)
  console.log('\nTest 3: Exceed limit (6th login attempt should fail)...');
  const user3 = 'user3@example.com';
  for (let i = 0; i < 5; i++) {
    await rateLimiter.checkLogin(user3);
  }
  const limitExceeded = await rateLimiter.checkLogin(user3);
  
  if (!limitExceeded.success && limitExceeded.remaining === 0) {
    console.log(`  ✓ PASS - Request blocked, status=429, remaining=0`);
    results.push({
      name: 'Rate limit exceeded (429)',
      passed: true,
      message: 'Request properly blocked after limit',
    });
    passed++;
  } else {
    console.log(`  ✗ FAIL - Request should be blocked`);
    results.push({
      name: 'Rate limit exceeded (429)',
      passed: false,
      message: `Got success=${limitExceeded.success}, remaining=${limitExceeded.remaining}`,
    });
    failed++;
  }

  // Test 4: API rate limit (different type)
  console.log('\nTest 4: API rate limit (different from login)...');
  const apiUser = 'api-user-123';
  const apiLimit1 = await rateLimiter.checkAPI(apiUser);
  if (apiLimit1.success && apiLimit1.limit === 100) {
    console.log(`  ✓ PASS - API limit is 100 (not confused with login limit of 5)`);
    results.push({
      name: 'Different rate limit types',
      passed: true,
      message: 'API limit is 100, separate from login',
    });
    passed++;
  } else {
    console.log(`  ✗ FAIL - API limit should be 100`);
    results.push({
      name: 'Different rate limit types',
      passed: false,
      message: `Got limit=${apiLimit1.limit}`,
    });
    failed++;
  }

  // Test 5: Signup rate limit by IP
  console.log('\nTest 5: Signup rate limit (3 per hour by IP)...');
  const ip = '192.168.1.1';
  let signupOk = true;
  
  // First 3 should succeed
  for (let i = 0; i < 3; i++) {
    const result = await rateLimiter.checkSignup(ip);
    if (!result.success) {
      signupOk = false;
      break;
    }
  }
  
  // 4th should fail
  const signupFail = await rateLimiter.checkSignup(ip);
  
  if (signupOk && !signupFail.success) {
    console.log(`  ✓ PASS - 3 succeeded, 4th blocked`);
    results.push({
      name: 'Signup rate limit (3/hour)',
      passed: true,
      message: '3 requests allowed, 4th blocked',
    });
    passed++;
  } else {
    console.log(`  ✗ FAIL - Signup limit not working correctly`);
    results.push({
      name: 'Signup rate limit (3/hour)',
      passed: false,
      message: `signup_ok=${signupOk}, signup_fail_success=${signupFail.success}`,
    });
    failed++;
  }

  // Test 6: Reset time is in future
  console.log('\nTest 6: Reset time calculation...');
  const user6 = 'user6@example.com';
  const before = Date.now();
  const limitedResult = await rateLimiter.checkLogin(user6); // Use up limit
  for (let i = 0; i < 5; i++) {
    await rateLimiter.checkLogin(user6);
  }
  const blockedResult = await rateLimiter.checkLogin(user6);
  const resetTime = blockedResult.resetAt.getTime();
  
  if (resetTime > before + 800000) { // 15 minutes = 900000ms
    console.log(`  ✓ PASS - Reset time is ~15 minutes in future`);
    results.push({
      name: 'Rate limit reset time correct',
      passed: true,
      message: `Reset time: ${Math.floor((resetTime - before) / 1000)}s in future`,
    });
    passed++;
  } else {
    console.log(`  ✗ FAIL - Reset time calculation wrong`);
    results.push({
      name: 'Rate limit reset time correct',
      passed: false,
      message: `Reset time: ${Math.floor((resetTime - before) / 1000)}s`,
    });
    failed++;
  }

  // Test 7: Upload rate limit
  console.log('\nTest 7: Upload rate limit (50 per hour)...');
  const uploader = 'user-uploader-123';
  const uploadResult = await rateLimiter.checkUpload(uploader);
  if (uploadResult.success && uploadResult.limit === 50) {
    console.log(`  ✓ PASS - Upload limit is 50/hour`);
    results.push({
      name: 'Upload rate limit (50/hour)',
      passed: true,
      message: 'Upload limit correctly configured',
    });
    passed++;
  } else {
    console.log(`  ✗ FAIL - Upload limit should be 50`);
    results.push({
      name: 'Upload rate limit (50/hour)',
      passed: false,
      message: `Got limit=${uploadResult.limit}`,
    });
    failed++;
  }

  // Test 8: Stripe rate limit
  console.log('\nTest 8: Stripe rate limit (50 per hour)...');
  const stripeUser = 'stripe-user-123';
  const stripeResult = await rateLimiter.checkStripe(stripeUser);
  if (stripeResult.success && stripeResult.limit === 50) {
    console.log(`  ✓ PASS - Stripe limit is 50/hour`);
    results.push({
      name: 'Stripe rate limit (50/hour)',
      passed: true,
      message: 'Stripe limit correctly configured',
    });
    passed++;
  } else {
    console.log(`  ✗ FAIL - Stripe limit should be 50`);
    results.push({
      name: 'Stripe rate limit (50/hour)',
      passed: false,
      message: `Got limit=${stripeResult.limit}`,
    });
    failed++;
  }

  // Summary
  const total = passed + failed;
  console.log(`\n${'='.repeat(50)}`);
  console.log(`RATE LIMITER TEST SUMMARY`);
  console.log(`${passed}/${total} tests passed, ${failed}/${total} failed`);
  console.log(`${'='.repeat(50)}\n`);

  return {
    passed,
    failed,
    total,
    results,
  };
}

export default testRateLimiter;
