import { useState } from 'react';
import { Button } from '@/components/UI/Button';

interface ShippingStepProps {
  data: any;
  onNext: (data: any) => void;
  saving: boolean;
}

export default function ShippingStep({ data, onNext, saving }: ShippingStepProps) {
  const [shippingMode, setShippingMode] = useState(data?.shippingMode || '');

  const modes = [
    { id: 'manual', title: 'Manual Shipping', description: 'I handle shipping myself' },
    { id: 'partner', title: 'Fulfillment Partner', description: 'Use an automated fulfillment service' },
    { id: 'hybrid', title: 'Hybrid', description: 'Mix of manual and partner' },
  ];

  const handleNext = () => {
    if (!shippingMode) {
      alert('Please select a shipping mode');
      return;
    }
    onNext({ shippingMode });
  };

  return (
    <div className="space-y-6">
      <div>
        <p className="text-gray-600 mb-6">
          How do you want to handle order fulfillment?
        </p>
      </div>

      <div className="space-y-3">
        {modes.map((mode) => (
          <label
            key={mode.id}
            className={`flex items-center gap-4 p-4 border-2 rounded-lg cursor-pointer transition-all ${
              shippingMode === mode.id
                ? 'border-blue-600 bg-blue-50'
                : 'border-gray-200 hover:border-gray-300'
            }`}
          >
            <input
              type="radio"
              name="shippingMode"
              value={mode.id}
              checked={shippingMode === mode.id}
              onChange={(e) => setShippingMode(e.target.value)}
              className="w-5 h-5 text-blue-600"
            />
            <div>
              <p className="font-medium text-gray-900">{mode.title}</p>
              <p className="text-sm text-gray-600">{mode.description}</p>
            </div>
          </label>
        ))}
      </div>

      <div className="flex justify-end gap-4">
        <Button
          variant="primary"
          onClick={handleNext}
          disabled={saving || !shippingMode}
        >
          {saving ? 'Saving...' : 'Next'}
        </Button>
      </div>
    </div>
  );
}
