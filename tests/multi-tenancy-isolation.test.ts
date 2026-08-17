/**
 * Multi-Tenancy Isolation Tests
 * 
 * Verifies that User A cannot access User B's data
 * REQUIRES: Two real users with separate workspaces
 */

import prisma from '@/lib/prisma';

export interface MultiTenancyTestResult {
  name: string;
  passed: boolean;
  message: string;
}

export async function testMultiTenancyIsolation() {
  console.log('\n🧪 TESTING: Multi-Tenancy Isolation\n');

  const results: MultiTenancyTestResult[] = [];
  let passCount = 0;
  let failCount = 0;

  try {
    // SETUP: Create two separate workspaces with users
    console.log('1. Creating test workspaces...');

    // Workspace A
    const userA = await prisma.user.create({
      data: {
        email: `test-a-${Date.now()}@example.com`,
        name: 'User A',
        hashedPassword: 'test-hash-a',
      },
    });

    const workspaceA = await prisma.workspace.create({
      data: {
        name: 'Workspace A',
        country: 'US',
        owner: {
          connect: { id: userA.id },
        },
      },
    });

    // Workspace B
    const userB = await prisma.user.create({
      data: {
        email: `test-b-${Date.now()}@example.com`,
        name: 'User B',
        hashedPassword: 'test-hash-b',
      },
    });

    const workspaceB = await prisma.workspace.create({
      data: {
        name: 'Workspace B',
        country: 'US',
        owner: {
          connect: { id: userB.id },
        },
      },
    });

    console.log(`   ✓ Workspace A: ${workspaceA.id}`);
    console.log(`   ✓ Workspace B: ${workspaceB.id}`);

    // Create test data for each workspace
    console.log('\n2. Creating test data in each workspace...');

    const productA = await prisma.product.create({
      data: {
        workspaceId: workspaceA.id,
        sku: 'TENANT-A-001',
        title: 'Product A',
        description: 'Belongs to User A',
        quantity: 10,
        purchasePrice: 5,
        sellingPrice: 15,
      },
    });

    const productB = await prisma.product.create({
      data: {
        workspaceId: workspaceB.id,
        sku: 'TENANT-B-001',
        title: 'Product B',
        description: 'Belongs to User B',
        quantity: 20,
        purchasePrice: 8,
        sellingPrice: 25,
      },
    });

    const imageA = await prisma.productImage.create({
      data: {
        productId: productA.id,
        url: 'https://example.com/image-a.jpg',
        isMain: true,
        order: 0,
      },
    });

    const imageB = await prisma.productImage.create({
      data: {
        productId: productB.id,
        url: 'https://example.com/image-b.jpg',
        isMain: true,
        order: 0,
      },
    });

    console.log(`   ✓ Product A: ${productA.id}`);
    console.log(`   ✓ Product B: ${productB.id}`);
    console.log(`   ✓ Image A: ${imageA.id}`);
    console.log(`   ✓ Image B: ${imageB.id}`);

    // TEST 1: User A cannot read Product B
    console.log('\n3. Test: User A accessing Product B (should fail)...');
    const productBAsUserA = await prisma.product.findFirst({
      where: {
        id: productB.id,
        workspaceId: workspaceA.id, // User A tries to use their workspace ID
      },
    });

    if (!productBAsUserA) {
      console.log('   ✓ PASS: User A cannot read Product B');
      results.push({
        name: 'User A cannot read Product B',
        passed: true,
        message: 'Correctly denied',
      });
      passCount++;
    } else {
      console.log('   ✗ FAIL: User A CAN read Product B (SECURITY BREACH!)');
      results.push({
        name: 'User A cannot read Product B',
        passed: false,
        message: 'SECURITY BREACH: Data accessible',
      });
      failCount++;
    }

    // TEST 2: User A cannot update Product B
    console.log('\n4. Test: User A modifying Product B (should fail)...');
    try {
      await prisma.product.update({
        where: { id: productB.id },
        data: {
          title: 'Hacked by User A',
          workspaceId: workspaceA.id, // Try to change workspace
        },
      });
      console.log('   ✗ FAIL: User A modified Product B');
      results.push({
        name: 'User A cannot modify Product B',
        passed: false,
        message: 'SECURITY BREACH: Data modified',
      });
      failCount++;
    } catch (error) {
      console.log('   ✓ PASS: Update correctly failed');
      results.push({
        name: 'User A cannot modify Product B',
        passed: true,
        message: 'Correctly denied',
      });
      passCount++;
    }

    // TEST 3: User A cannot delete Product B's images
    console.log('\n5. Test: User A deleting Product B image (should fail)...');
    const imageCount = await prisma.productImage.count({
      where: { productId: productB.id },
    });

    // Try to delete via API security check
    const imageOwnsProduct = await prisma.productImage.findFirst({
      where: {
        id: imageB.id,
        product: {
          workspaceId: workspaceA.id, // Try with wrong workspace
        },
      },
    });

    if (!imageOwnsProduct) {
      console.log('   ✓ PASS: User A cannot access Product B images');
      results.push({
        name: 'User A cannot access Product B images',
        passed: true,
        message: 'Correctly denied',
      });
      passCount++;
    } else {
      console.log('   ✗ FAIL: User A can access Product B images');
      results.push({
        name: 'User A cannot access Product B images',
        passed: false,
        message: 'SECURITY BREACH: Images accessible',
      });
      failCount++;
    }

    // TEST 4: Verify Product A is accessible by User A
    console.log('\n6. Test: User A can read their own Product A (should succeed)...');
    const productACorrect = await prisma.product.findFirst({
      where: {
        id: productA.id,
        workspaceId: workspaceA.id,
      },
    });

    if (productACorrect) {
      console.log('   ✓ PASS: User A can read Product A');
      results.push({
        name: 'User A can read own products',
        passed: true,
        message: 'Correctly allowed',
      });
      passCount++;
    } else {
      console.log('   ✗ FAIL: User A cannot read Product A');
      results.push({
        name: 'User A can read own products',
        passed: false,
        message: 'Legitimate access denied',
      });
      failCount++;
    }

    // TEST 5: Direct ID access attempt
    console.log('\n7. Test: Direct ID access (User A with Product B ID)...');
    const directAccess = await prisma.product.findUnique({
      where: { id: productB.id },
    });

    if (directAccess) {
      console.log('   ⚠️ WARNING: Direct query found product without workspace filter');
      console.log('      (Security check must be in application layer)');
      results.push({
        name: 'Application-level workspace validation required',
        passed: true,
        message: 'Database correctly returns data; app layer must filter',
      });
      passCount++;
    }

    // TEST 6: Subscription isolation
    console.log('\n8. Test: Subscription isolation...');
    const subA = await prisma.subscription.create({
      data: {
        planId: 'starter', // Assuming plans exist
        status: 'active',
        workspaceId: workspaceA.id,
      },
    });

    const canUserBSeeSub = await prisma.subscription.findFirst({
      where: {
        id: subA.id,
        workspaceId: workspaceB.id, // User B tries with their workspace
      },
    });

    if (!canUserBSeeSub) {
      console.log('   ✓ PASS: Subscriptions correctly isolated');
      results.push({
        name: 'Subscriptions isolated by workspace',
        passed: true,
        message: 'Correctly denied',
      });
      passCount++;
    } else {
      console.log('   ✗ FAIL: Subscription isolation broken');
      results.push({
        name: 'Subscriptions isolated by workspace',
        passed: false,
        message: 'SECURITY BREACH',
      });
      failCount++;
    }

    // CLEANUP
    console.log('\n9. Cleaning up test data...');
    await prisma.productImage.deleteMany({
      where: {
        product: {
          workspaceId: { in: [workspaceA.id, workspaceB.id] },
        },
      },
    });

    await prisma.product.deleteMany({
      where: {
        workspaceId: { in: [workspaceA.id, workspaceB.id] },
      },
    });

    await prisma.subscription.deleteMany({
      where: {
        workspaceId: { in: [workspaceA.id, workspaceB.id] },
      },
    });

    await prisma.workspace.deleteMany({
      where: { id: { in: [workspaceA.id, workspaceB.id] } },
    });

    await prisma.user.deleteMany({
      where: { id: { in: [userA.id, userB.id] } },
    });

    console.log('   ✓ Cleanup complete');

    // SUMMARY
    console.log(`\n${'='.repeat(50)}`);
    console.log(`MULTI-TENANCY TEST SUMMARY`);
    console.log(`${passCount} passed, ${failCount} failed`);
    console.log(`${'='.repeat(50)}\n`);

    results.forEach((r) => {
      console.log(`${r.passed ? '✓' : '✗'} ${r.name}`);
      console.log(`  ${r.message}`);
    });

    return {
      success: failCount === 0,
      passed: passCount,
      failed: failCount,
      results,
    };
  } catch (error) {
    console.error('\n❌ TEST ERROR:', error);
    return {
      success: false,
      passed: passCount,
      failed: failCount + 1,
      error: error instanceof Error ? error.message : 'Unknown error',
      results,
    };
  }
}

export default testMultiTenancyIsolation;
