import { useState } from 'react';
import { Button } from '@/components/UI/Button';

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
        <p className="text-gray-600 mb-6">
          Ready to connect your marketplace accounts? You can do this now or skip it for later.
        </p>
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
        <p className="text-sm text-blue-900">
          Connecting your marketplace accounts allows us to automatically sync your inventory and orders
          across platforms.
        </p>
      </div>

      <div className="space-y-3">
        <div className="p-4 border rounded-lg">
          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={connectionsSetup}
              onChange={(e) => setConnectionsSetup(e.target.checked)}
              className="w-5 h-5 text-blue-600 rounded"
            />
            <span className="text-gray-900">I want to connect my marketplace accounts now</span>
          </label>
        </div>
      </div>

      {connectionsSetup && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
          <p className="text-sm text-yellow-900">
            You'll be able to connect your accounts after completing this setup.
          </p>
        </div>
      )}

      <div className="flex justify-end gap-4">
        <Button variant="primary" onClick={handleNext} disabled={saving}>
          {saving ? 'Saving...' : 'Next'}
        </Button>
      </div>
    </div>
  );
}
