import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, errorResponse } from '@/lib/security';
import { FulfillmentService } from '@/services/FulfillmentService';

// This route reads the authenticated session (via headers()/cookies()
// under the hood), so it must never be statically rendered or cached —
// each response is specific to the requesting user.
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    // Partners are global (not workspace-scoped) rows and the dashboard
    // calls this endpoint without a workspaceId, so the existing
    // session + verified-email check (requireAuth) is the compatible
    // gate here. The service returns only the public allowlist
    // (id, name, country) — never apiKey / apiUrl / webhookUrl.
    await requireAuth();

    const partners = await FulfillmentService.getAvailablePartners();

    return NextResponse.json({
      success: true,
      partners,
    });
  } catch (error) {
    console.error('Error fetching partners:', error);
    const message = error instanceof Error ? error.message : '';
    // Auth failures keep their real status (401 / 403); anything else stays
    // the generic 500 this route always returned.
    if (message === 'Unauthorized' || message === 'Email verification required') {
      return errorResponse(error);
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
