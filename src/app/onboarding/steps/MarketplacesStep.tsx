import { useState } from 'react';
import { Button } from '@/components/UI/Button';

interface MarketplacesStepProps {
  data: any;
  onNext: (data: any) => void;
  saving: boolean;
}

export default function MarketplacesStep({ data, onNext, saving }: MarketplacesStepProps) {
  const [selectedMarketplaces, setSelectedMarketplaces] = useState<string[]>(
    data?.marketplaces || []
  );

  const marketplaces = [
    { id: 'vinted', name: 'Vinted', description: 'Popular for fashion and second-hand' },
    { id: 'ebay', name: 'eBay', description: 'Largest e-commerce marketplace' },
    { id: 'depop', name: 'Depop', description: 'Fashion-focused social marketplace' },
    { id: 'etsy', name: 'Etsy', description: 'Handmade and vintage items' },
  ];

  const toggleMarketplace = (id: string) => {
    setSelectedMarketplaces((prev) =>
      prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id]
    );
  };

  const handleNext = () => {
    if (selectedMarketplaces.length === 0) {
      alert('Please select at least one marketplace');
      return;
    }
    onNext({ marketplaces: selectedMarketplaces });
  };

  return (
    <div className="space-y-6">
      <div>
        <p className="text-gray-600 mb-6">
          Which marketplaces do you want to sell on? You can add more later.
        </p>
      </div>

      <div className="space-y-3">
        {marketplaces.map((marketplace) => (
          <label key={marketplace.id} className="flex items-center gap-4 p-4 border rounded-lg cursor-pointer hover:bg-gray-50">
            <input
              type="checkbox"
              checked={selectedMarketplaces.includes(marketplace.id)}
              onChange={() => toggleMarketplace(marketplace.id)}
              className="w-5 h-5 text-blue-600 rounded"
            />
            <div className="flex-1">
              <p className="font-medium text-gray-900">{marketplace.name}</p>
              <p className="text-sm text-gray-600">{marketplace.description}</p>
            </div>
          </label>
        ))}
      </div>

      <div className="flex justify-end gap-4">
        <Button
          variant="primary"
          onClick={handleNext}
          disabled={saving || selectedMarketplaces.length === 0}
        >
          {saving ? 'Saving...' : 'Next'}
        </Button>
      </div>
    </div>
  );
}
