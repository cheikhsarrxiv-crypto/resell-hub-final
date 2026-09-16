import { useState } from 'react';
import { DashboardButton } from '@/components/dashboard/DashboardButton';

interface ConnectionsStepProps {
  data: any;
  onNext: (data: any) => void;
  saving: boolean;
}

export default function ConnectionsStep({ data, onNext, saving }: ConnectionsStepProps) {
  const [connectionsSetup, setConnectionsSetup] = useState(data?.connectionsSetup || false);

  const handleNext = () => {
    onNext({ connectionsSetup });
  };

  return (
    <div className="space-y-6">
      <div>
        <p className="text-gray-400 mb-6">
          Ready to connect your marketplace accounts? You can do this now or skip it for later.
        </p>
      </div>

      <div className="bg-white/[0.03] border border-white/10 rounded-lg p-4 mb-6">
        <p className="text-sm text-gray-400">
          Connecting your marketplace accounts allows us to automatically sync your inventory and orders
          across platforms.
        </p>
      </div>

      <div className="space-y-3">
        <div className="p-4 border border-white/10 rounded-lg">
          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={connectionsSetup}
              onChange={(e) => setConnectionsSetup(e.target.checked)}
              className="w-4 h-4 accent-[#FF5A1F] rounded"
            />
            <span className="text-white">I want to connect my marketplace accounts now</span>
          </label>
        </div>
      </div>

      {connectionsSetup && (
        <div className="bg-amber-500/[0.06] border border-amber-500/20 rounded-lg p-4">
          <p className="text-sm text-amber-200/80">
            You'll be able to connect your accounts after completing this setup.
          </p>
        </div>
      )}

      <div className="flex justify-end gap-4">
        <DashboardButton variant="primary" onClick={handleNext} disabled={saving}>
          {saving ? 'Saving...' : 'Next'}
        </DashboardButton>
      </div>
    </div>
  );
}
