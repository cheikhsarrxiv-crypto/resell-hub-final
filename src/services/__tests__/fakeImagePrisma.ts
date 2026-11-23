/**
 * In-memory stand-in for the slice of Prisma that StorageService.updateImageOrder
 * and the real security helpers use. Test helper only (not a *.test.ts file, so
 * Vitest never collects it). No database, no network.
 *
 * It is deliberately a little faithful where the security property depends on it:
 *  - productImage.update() is LAZY (like a real PrismaPromise): nothing is
 *    written until the promise is awaited / passed to $transaction;
 *  - update() filters on every field of `where` (id AND productId when given)
 *    and throws a "not found" error when nothing matches (like P2025);
 *  - $transaction([...]) runs the writes in order and rolls everything back if
 *    any of them throws;
 *  - `writes` counts the writes that were really executed.
 */
export interface FakeImage {
  id: string;
  productId: string;
  order: number;
  isMain: boolean;
}
export interface FakeProduct {
  id: string;
  workspaceId: string;
}
export interface FakeWorkspace {
  id: string;
  userId: string;
}

export function createFakePrisma() {
  const state = {
    users: new Map<string, { id: string; emailVerified: Date | null }>(),
    workspaces: new Map<string, FakeWorkspace>(),
    products: new Map<string, FakeProduct>(),
    images: new Map<string, FakeImage>(),
    writes: 0,
    findManyCalls: [] as any[],
    updateWheres: [] as any[],
    /** when set, productImage.findMany returns exactly these ids (to simulate a race after the check) */
    forceFindManyIds: null as string[] | null,
  };

  const snapshot = () => new Map([...state.images].map(([k, v]) => [k, { ...v }]));

  const lazy = <T>(run: () => T) => {
    const op: any = {
      __run: run,
      then(resolve: (v: T) => unknown, reject: (e: unknown) => unknown) {
        return Promise.resolve().then(run).then(resolve, reject);
      },
    };
    return op as Promise<T> & { __run: () => T };
  };

  const prisma: any = {
    user: {
      findUnique: async ({ where }: any) => state.users.get(where.id) ?? null,
    },
    workspace: {
      findFirst: async ({ where }: any) => {
        const ws = state.workspaces.get(where.id);
        return ws && (where.userId === undefined || ws.userId === where.userId) ? { ...ws } : null;
      },
    },
    product: {
      findUnique: async ({ where }: any) => {
        const p = state.products.get(where.id);
        return p ? { ...p } : null;
      },
    },
    productImage: {
      findMany: async (args: any) => {
        state.findManyCalls.push(args);
        const where = args.where ?? {};
        let rows = [...state.images.values()];
        if (state.forceFindManyIds) {
          rows = rows.filter((r) => state.forceFindManyIds!.includes(r.id));
        } else {
          if (where.id?.in) rows = rows.filter((r) => where.id.in.includes(r.id));
          if (where.productId !== undefined) rows = rows.filter((r) => r.productId === where.productId);
          if (where.product?.workspaceId !== undefined) {
            rows = rows.filter((r) => state.products.get(r.productId)?.workspaceId === where.product.workspaceId);
          }
        }
        return rows.map((r) => ({ id: r.id }));
      },
      update: (args: any) =>
        lazy(() => {
          state.updateWheres.push(args.where);
          const row = state.images.get(args.where.id);
          if (!row || (args.where.productId !== undefined && row.productId !== args.where.productId)) {
            throw new Error('An operation failed because it depends on one or more records that were required but not found. Record to update not found.');
          }
          row.order = args.data.order;
          row.isMain = args.data.isMain;
          state.writes += 1;
          return { ...row };
        }),
    },
    $transaction: async (ops: any[]) => {
      const before = snapshot();
      const writesBefore = state.writes;
      try {
        const results = [];
        for (const op of ops) results.push(await op);
        return results;
      } catch (error) {
        state.images = before;
        state.writes = writesBefore;
        throw error;
      }
    },
  };

  const reset = () => {
    state.users.clear();
    state.workspaces.clear();
    state.products.clear();
    state.images.clear();
    state.writes = 0;
    state.findManyCalls = [];
    state.updateWheres = [];
    state.forceFindManyIds = null;
  };

  /** Two isolated workspaces, each owned by its own verified user, each with one product and three images. */
  const seedTwoWorkspaces = () => {
    reset();
    for (const key of ['A', 'B']) {
      state.users.set(`user-${key}`, { id: `user-${key}`, emailVerified: new Date() });
      state.workspaces.set(`ws-${key}`, { id: `ws-${key}`, userId: `user-${key}` });
      state.products.set(`prod-${key}`, { id: `prod-${key}`, workspaceId: `ws-${key}` });
      [1, 2, 3].forEach((n) =>
        state.images.set(`img-${key}${n}`, { id: `img-${key}${n}`, productId: `prod-${key}`, order: n - 1, isMain: n === 1 })
      );
    }
    // a second product in workspace A, to test "another product of the same workspace"
    state.products.set('prod-A2', { id: 'prod-A2', workspaceId: 'ws-A' });
    state.images.set('img-A2-1', { id: 'img-A2-1', productId: 'prod-A2', order: 0, isMain: true });
  };

  /** Plain copy of the image table, for before / after comparisons. */
  const imagesSnapshot = () => Object.fromEntries([...state.images].map(([k, v]) => [k, { ...v }]));

  return { prisma, state, seedTwoWorkspaces, imagesSnapshot, reset };
}

export const fake = createFakePrisma();
