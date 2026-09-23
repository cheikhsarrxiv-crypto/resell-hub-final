interface AgentErrorBannerProps {
  message: string;
}

/** Always a plain-language message (see mapAgentErrorToMessage) — never a raw backend error, status code, or stack trace. */
export function AgentErrorBanner({ message }: AgentErrorBannerProps) {
  return (
    <div
      role="alert"
      className="mx-4 sm:mx-6 mb-3 rounded-xl px-4 py-2.5 text-sm bg-red-500/10 border border-red-500/20 text-red-300 shrink-0"
    >
      {message}
    </div>
  );
}

export default AgentErrorBanner;
