import { useState } from 'react';
import { DashboardButton } from '@/components/dashboard/DashboardButton';
import { availableMarketplaces, comingSoonMarketplaces } from './marketplaceAvailability';

interface MarketplacesStepProps {
  data: any;
  onNext: (data: any) => void;
  saving: boolean;
}

export default function MarketplacesStep({ data, onNext, saving }: MarketplacesStepProps) {
  const [selectedMarketplaces, setSelectedMarketplaces] = useState<string[]>(
    data?.marketplaces || []
  );
  const [formError, setFormError] = useState<string | null>(null);

  const toggleMarketplace = (id: string) => {
    setSelectedMarketplaces((prev) =>
      prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id]
    );
  };

  const handleNext = () => {
    if (selectedMarketplaces.length === 0) {
      setFormError('Please select at least one marketplace.');
      return;
    }
    setFormError(null);
    onNext({ marketplaces: selectedMarketplaces });
  };

  return (
    <div className="space-y-6">
      <div>
        <p className="text-gray-400 mb-6">
          Which marketplaces do you want to sell on? You can add more later.
        </p>
      </div>

      <div className="space-y-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Available now</p>
        {availableMarketplaces.map((marketplace) => (
          <label
            key={marketplace.id}
            className="flex items-center gap-4 p-4 border border-white/10 rounded-lg cursor-pointer hover:bg-white/[0.03]"
          >
            <input
              type="checkbox"
              checked={selectedMarketplaces.includes(marketplace.id)}
              onChange={() => toggleMarketplace(marketplace.id)}
              className="w-4 h-4 accent-[#FF5A1F] rounded"
            />
            <div className="flex-1">
              <p className="font-medium text-white">{marketplace.name}</p>
              <p className="text-sm text-gray-500">{marketplace.description}</p>
            </div>
          </label>
        ))}

        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 pt-4">
          Waiting on official partner access
        </p>
        {comingSoonMarketplaces.map((marketplace) => (
          <div
            key={marketplace.id}
            className="flex items-center gap-4 p-4 border border-white/10 rounded-lg bg-white/[0.02] opacity-70 cursor-not-allowed"
            title="Not connectable yet — waiting on official partner/API access"
          >
            <input type="checkbox" checked={false} disabled className="w-4 h-4 rounded" />
            <div className="flex-1">
              <p className="font-medium text-gray-300">{marketplace.name}</p>
              <p className="text-sm text-gray-600">{marketplace.description} — not connectable yet</p>
            </div>
          </div>
        ))}
      </div>

      {formError && <p className="text-sm text-red-400">{formError}</p>}

      <div className="flex justify-end gap-4">
        <DashboardButton
          variant="primary"
          onClick={handleNext}
          disabled={saving || selectedMarketplaces.length === 0}
        >
          {saving ? 'Saving...' : 'Next'}
        </DashboardButton>
      </div>
    </div>
  );
}
