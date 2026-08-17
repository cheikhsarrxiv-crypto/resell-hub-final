/**
 * Stock Race Condition Test
 * 
 * This test reproduces the race condition scenario:
 * - Product has stock = 1
 * - Two orders arrive simultaneously
 * - Expected: Only one succeeds, one fails
 * - Stock should never go negative
 * 
 * REQUIRES: Database migration applied + StockService implemented
 */

import { StockService } from '@/services/StockService';
import prisma from '@/lib/prisma';

export async function testStockRaceCondition() {
  console.log('\n🧪 TESTING: Stock Race Condition\n');

  let testsPassed = 0;
  let testsFailed = 0;

  try {
    // SETUP: Create test product with stock = 1
    console.log('1. Creating test product with stock = 1...');
    const workspace = await prisma.workspace.create({
      data: {
        name: 'Test Workspace - Stock Race',
        country: 'US',
        user: {
          connect: {
            id: 'test-user-id', // Will use existing user or fail
          },
        },
      },
    });

    const product = await prisma.product.create({
      data: {
        workspaceId: workspace.id,
        sku: 'RACE-TEST-001',
        title: 'Race Condition Test Product',
        description: 'For testing stock race conditions',
        quantity: 1, // CRITICAL: Only 1 item available
        purchasePrice: 10,
        sellingPrice: 20,
      },
    });

    console.log(`   ✓ Product created: ${product.id} with stock = ${product.quantity}`);

    // TEST 1: Simultaneous stock reservations
    console.log('\n2. Simulating two simultaneous orders...');
    
    const reservation1 = StockService.reserveStock(product.id, workspace.id, 1);
    const reservation2 = StockService.reserveStock(product.id, workspace.id, 1);

    const [result1, result2] = await Promise.all([reservation1, reservation2]);

    console.log(`   Order 1: ${result1.success ? '✓ SUCCESS' : '✗ FAILED'} - ${result1.message}`);
    console.log(`   Order 2: ${result2.success ? '✓ SUCCESS' : '✗ FAILED'} - ${result2.message}`);

    // VERIFY: Exactly one should succeed
    const successCount = (result1.success ? 1 : 0) + (result2.success ? 1 : 0);
    if (successCount === 1) {
      console.log('   ✓ PASS: Exactly one order succeeded');
      testsPassed++;
    } else {
      console.log(`   ✗ FAIL: Expected 1 success, got ${successCount}`);
      testsFailed++;
    }

    // VERIFY: Stock is not negative
    const finalProduct = await prisma.product.findUnique({
      where: { id: product.id },
    });

    console.log(`\n3. Verifying final stock level...`);
    console.log(`   Final stock: ${finalProduct?.quantity}`);

    if ((finalProduct?.quantity || 0) >= 0) {
      console.log('   ✓ PASS: Stock is not negative');
      testsPassed++;
    } else {
      console.log('   ✗ FAIL: Stock went negative!');
      testsFailed++;
    }

    if ((finalProduct?.quantity || 0) === 0) {
      console.log('   ✓ PASS: Stock correctly decreased by 1');
      testsPassed++;
    } else {
      console.log(`   ✗ FAIL: Stock should be 0, got ${finalProduct?.quantity}`);
      testsFailed++;
    }

    // TEST 2: Multiple simultaneous attempts
    console.log(`\n4. Testing with 5 simultaneous attempts (stock was 1, now 0)...`);

    await prisma.product.update({
      where: { id: product.id },
      data: { quantity: 1 }, // Reset to 1
    });

    const attempts = Array(5)
      .fill(null)
      .map(() => StockService.reserveStock(product.id, workspace.id, 1));

    const results = await Promise.all(attempts);
    const successesInBatch = results.filter((r) => r.success).length;

    console.log(`   Attempts: 5, Successes: ${successesInBatch}`);

    if (successesInBatch === 1) {
      console.log('   ✓ PASS: Only 1 of 5 succeeded');
      testsPassed++;
    } else {
      console.log(`   ✗ FAIL: Expected 1 success, got ${successesInBatch}`);
      testsFailed++;
    }

    const afterBatch = await prisma.product.findUnique({
      where: { id: product.id },
    });

    if ((afterBatch?.quantity || 0) === 0) {
      console.log('   ✓ PASS: Stock correctly at 0');
      testsPassed++;
    } else {
      console.log(`   ✗ FAIL: Stock should be 0, got ${afterBatch?.quantity}`);
      testsFailed++;
    }

    // TEST 3: Stock release
    console.log(`\n5. Testing stock release...`);

    const release = await StockService.releaseStock(product.id, workspace.id, 1);
    console.log(`   Release: ${release.success ? '✓ SUCCESS' : '✗ FAILED'}`);

    const afterRelease = await prisma.product.findUnique({
      where: { id: product.id },
    });

    if ((afterRelease?.quantity || 0) === 1) {
      console.log('   ✓ PASS: Stock correctly restored to 1');
      testsPassed++;
    } else {
      console.log(`   ✗ FAIL: Stock should be 1, got ${afterRelease?.quantity}`);
      testsFailed++;
    }

    // CLEANUP
    console.log(`\n6. Cleaning up test data...`);
    await prisma.product.delete({ where: { id: product.id } });
    await prisma.workspace.delete({ where: { id: workspace.id } });
    console.log('   ✓ Cleanup complete');

    // SUMMARY
    console.log(`\n${'='.repeat(50)}`);
    console.log(`TEST SUMMARY: ${testsPassed} passed, ${testsFailed} failed`);
    console.log(`${'='.repeat(50)}\n`);

    return {
      success: testsFailed === 0,
      passed: testsPassed,
      failed: testsFailed,
    };
  } catch (error) {
    console.error('\n❌ TEST ERROR:', error);
    return {
      success: false,
      passed: testsPassed,
      failed: testsFailed + 1,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// Export for use in test runners
export default testStockRaceCondition;
