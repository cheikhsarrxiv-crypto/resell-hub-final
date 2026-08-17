import { auth } from '@/auth';
import prisma from '@/lib/prisma';

export async function getCurrentWorkspace() {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      throw new Error('Not authenticated');
    }

    // Get first workspace for user
    const workspace = await prisma.workspace.findFirst({
      where: { userId: session.user.id },
      include: {
        subscription: {
          include: { plan: true },
        },
      },
    });

    if (!workspace) {
      throw new Error('No workspace found');
    }

    return workspace;
  } catch (error) {
    throw error;
  }
}

export async function getCurrentWorkspaceId(): Promise<string> {
  const workspace = await getCurrentWorkspace();
  return workspace.id;
}

export async function getUserWorkspaces() {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      throw new Error('Not authenticated');
    }

    return prisma.workspace.findMany({
      where: { userId: session.user.id },
      include: {
        subscription: {
          include: { plan: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  } catch (error) {
    throw error;
  }
}
