import { useState } from 'react';
import { DashboardButton } from '@/components/dashboard/DashboardButton';

interface WelcomeStepProps {
  data: any;
  onNext: (data: any) => void;
  saving: boolean;
}

const fieldClass =
  'w-full bg-white/[0.04] border border-white/10 rounded-lg px-4 py-2.5 text-white placeholder:text-gray-600 focus:outline-none focus:ring-1 focus:ring-[#FF5A1F]/50 focus:border-[#FF5A1F]/50';

export default function WelcomeStep({ data, onNext, saving }: WelcomeStepProps) {
  const [businessName, setBusinessName] = useState(data?.businessName || '');
  const [businessType, setBusinessType] = useState(data?.businessType || '');
  const [formError, setFormError] = useState<string | null>(null);

  const handleNext = () => {
    if (!businessName.trim() || !businessType) {
      setFormError('Please fill in all fields.');
      return;
    }
    setFormError(null);
    onNext({ businessName, businessType });
  };

  return (
    <div className="space-y-6">
      <div>
        <p className="text-gray-400 mb-6">
          Welcome! Let's set up your reselling business. We'll guide you through the setup process.
        </p>
      </div>

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-400 mb-2">
            Business Name
          </label>
          <input
            type="text"
            value={businessName}
            onChange={(e) => setBusinessName(e.target.value)}
            placeholder="e.g., My Reselling Shop"
            className={fieldClass}
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-400 mb-2">
            Business Type
          </label>
          <select
            value={businessType}
            onChange={(e) => setBusinessType(e.target.value)}
            className={fieldClass}
          >
            <option value="" className="bg-[#0d0d10]">Select business type</option>
            <option value="reseller" className="bg-[#0d0d10]">Reseller (Buy & Sell)</option>
            <option value="dropshipper" className="bg-[#0d0d10]">Dropshipper</option>
            <option value="hybrid" className="bg-[#0d0d10]">Hybrid (Both)</option>
          </select>
        </div>
      </div>

      {formError && <p className="text-sm text-red-400">{formError}</p>}

      <div className="flex justify-end gap-4">
        <DashboardButton
          variant="primary"
          onClick={handleNext}
          disabled={saving || !businessName || !businessType}
        >
          {saving ? 'Saving...' : 'Next'}
        </DashboardButton>
      </div>
    </div>
  );
}
