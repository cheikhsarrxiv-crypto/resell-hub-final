import { useState } from 'react';
import { Button } from '@/components/UI/Button';

interface WelcomeStepProps {
  data: any;
  onNext: (data: any) => void;
  saving: boolean;
}

export default function WelcomeStep({ data, onNext, saving }: WelcomeStepProps) {
  const [businessName, setBusinessName] = useState(data?.businessName || '');
  const [businessType, setBusinessType] = useState(data?.businessType || '');

  const handleNext = () => {
    if (!businessName.trim() || !businessType) {
      alert('Please fill in all fields');
      return;
    }
    onNext({ businessName, businessType });
  };

  return (
    <div className="space-y-6">
      <div>
        <p className="text-gray-600 mb-6">
          Welcome! Let's set up your reselling business. We'll guide you through the setup process.
        </p>
      </div>

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Business Name
          </label>
          <input
            type="text"
            value={businessName}
            onChange={(e) => setBusinessName(e.target.value)}
            placeholder="e.g., My Reselling Shop"
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Business Type
          </label>
          <select
            value={businessType}
            onChange={(e) => setBusinessType(e.target.value)}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          >
            <option value="">Select business type</option>
            <option value="reseller">Reseller (Buy & Sell)</option>
            <option value="dropshipper">Dropshipper</option>
            <option value="hybrid">Hybrid (Both)</option>
          </select>
        </div>
      </div>

      <div className="flex justify-end gap-4">
        <Button
          variant="primary"
          onClick={handleNext}
          disabled={saving || !businessName || !businessType}
        >
          {saving ? 'Saving...' : 'Next'}
        </Button>
      </div>
    </div>
  );
}
