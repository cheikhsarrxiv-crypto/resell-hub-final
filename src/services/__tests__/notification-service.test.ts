/**
 * Proves the createNotification() fix: it now writes a real row to the
 * Notification table (resolving workspaceId -> its owning user's id via
 * Workspace.userId, since Notification.userId points at User, not
 * Workspace) instead of only console.log-ing, while never throwing —
 * a notification must never fail the business operation that triggered it.
 *
 * Real PostgreSQL (no mocked DB), same convention as the other service
 * tests in this suite (describe.skipIf(!dbAvailable)).
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import prisma from '@/lib/prisma';
import { NotificationService } from '@/services/NotificationService';

const testPrisma = new PrismaClient();

let dbAvailable = true;
try {
  await testPrisma.$queryRaw`SELECT 1`;
} catch {
  dbAvailable = false;
}

const createdUserIds: string[] = [];

async function createWorkspace() {
  const user = await testPrisma.user.create({
    data: {
      email: `notification-test-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`,
      name: 'Notification Test User',
      password: 'not-used',
    },
  });
  createdUserIds.push(user.id);

  const workspace = await testPrisma.workspace.create({
    data: {
      name: 'Notification Test Workspace',
      slug: `notification-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      userId: user.id,
    },
  });

  return { user, workspace };
}

describe.skipIf(!dbAvailable)('NotificationService.createNotification — real PostgreSQL', () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    for (const id of createdUserIds.splice(0)) {
      // Notification rows cascade-delete with the user (onDelete: Cascade).
      await testPrisma.user.delete({ where: { id } }).catch(() => {});
    }
  });

  it('creates exactly one Notification row, attributed to the workspace owner', async () => {
    const { user, workspace } = await createWorkspace();

    await NotificationService.createNotification(
      workspace.id,
      'new_order',
      'New Order Received',
      'Order for Widget - €29'
    );

    const rows = await testPrisma.notification.findMany({ where: { userId: user.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      userId: user.id,
      type: 'new_order',
      title: 'New Order Received',
      message: 'Order for Widget - €29',
      isRead: false,
    });
  });

  it('two separate calls create two independent rows, not duplicates of one another', async () => {
    const { user, workspace } = await createWorkspace();

    await NotificationService.createNotification(workspace.id, 'new_order', 'Order 1', 'First order');
    await NotificationService.createNotification(workspace.id, 'order_shipped', 'Order 1 Shipped', 'Shipped');

    const rows = await testPrisma.notification.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(rows).toHaveLength(2);
    expect(rows[0].type).toBe('new_order');
    expect(rows[1].type).toBe('order_shipped');
  });

  it('does not throw and creates no row when the workspace does not exist', async () => {
    await expect(
      NotificationService.createNotification(
        'does-not-exist-workspace-id',
        'new_order',
        'Title',
        'Message'
      )
    ).resolves.toBeUndefined(); // must resolve, never throw

    const rows = await testPrisma.notification.findMany({ where: { title: 'Title' } });
    expect(rows).toHaveLength(0);
  });

  it('does not throw when the database write itself fails', async () => {
    const { workspace } = await createWorkspace();
    vi.spyOn(prisma.notification, 'create').mockRejectedValueOnce(new Error('db unavailable'));

    await expect(
      NotificationService.createNotification(workspace.id, 'new_order', 'Title', 'Message')
    ).resolves.toBeUndefined(); // the business operation calling this must never see an error
  });
});
