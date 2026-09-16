import { useState } from 'react';
import { DashboardButton } from '@/components/dashboard/DashboardButton';

interface ShippingStepProps {
  data: any;
  onNext: (data: any) => void;
  saving: boolean;
}

export default function ShippingStep({ data, onNext, saving }: ShippingStepProps) {
  const [shippingMode, setShippingMode] = useState(data?.shippingMode || '');
  const [formError, setFormError] = useState<string | null>(null);

  const modes = [
    { id: 'manual', title: 'Manual Shipping', description: 'I handle shipping myself' },
    { id: 'partner', title: 'Fulfillment Partner', description: 'Use an automated fulfillment service' },
    { id: 'hybrid', title: 'Hybrid', description: 'Mix of manual and partner' },
  ];

  const handleNext = () => {
    if (!shippingMode) {
      setFormError('Please select a shipping mode.');
      return;
    }
    setFormError(null);
    onNext({ shippingMode });
  };

  return (
    <div className="space-y-6">
      <div>
        <p className="text-gray-400 mb-6">
          How do you want to handle order fulfillment?
        </p>
      </div>

      <div className="space-y-3">
        {modes.map((mode) => (
          <label
            key={mode.id}
            className={`flex items-center gap-4 p-4 border rounded-lg cursor-pointer transition-colors ${
              shippingMode === mode.id
                ? 'border-[#FF5A1F]/50 bg-[#FF5A1F]/[0.06]'
                : 'border-white/10 hover:border-white/20'
            }`}
          >
            <input
              type="radio"
              name="shippingMode"
              value={mode.id}
              checked={shippingMode === mode.id}
              onChange={(e) => setShippingMode(e.target.value)}
              className="w-4 h-4 accent-[#FF5A1F]"
            />
            <div>
              <p className="font-medium text-white">{mode.title}</p>
              <p className="text-sm text-gray-500">{mode.description}</p>
            </div>
          </label>
        ))}
      </div>

      {formError && <p className="text-sm text-red-400">{formError}</p>}

      <div className="flex justify-end gap-4">
        <DashboardButton
          variant="primary"
          onClick={handleNext}
          disabled={saving || !shippingMode}
        >
          {saving ? 'Saving...' : 'Next'}
        </DashboardButton>
      </div>
    </div>
  );
}
