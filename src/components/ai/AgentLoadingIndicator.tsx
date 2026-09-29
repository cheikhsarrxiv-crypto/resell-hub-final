/**
 * Deliberately generic — "the agent is thinking", never a claim about
 * which backend operation is in flight (e.g. "Searching eBay…"), since
 * the frontend has no way to know that from a plain JSON response until
 * it actually resolves (see Phase 11 audit §9/§11: no streaming today).
 */
export function AgentLoadingIndicator() {
  return (
    <div
      role="status"
      aria-label="L'Agent réfléchit"
      className="mr-auto max-w-[85%] sm:max-w-[70%] rounded-2xl px-4 py-2.5 bg-white/[0.05] border border-white/[0.08] flex items-center gap-1.5"
    >
      <span className="w-1.5 h-1.5 rounded-full bg-gray-400 landing-pulse" />
      <span className="w-1.5 h-1.5 rounded-full bg-gray-400 landing-pulse" style={{ animationDelay: '0.15s' }} />
      <span className="w-1.5 h-1.5 rounded-full bg-gray-400 landing-pulse" style={{ animationDelay: '0.3s' }} />
    </div>
  );
}

export default AgentLoadingIndicator;
