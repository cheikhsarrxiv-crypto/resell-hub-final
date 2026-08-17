import { useState } from 'react';
import { Button } from '@/components/UI/Button';

interface VolumeStepProps {
  data: any;
  onNext: (data: any) => void;
  saving: boolean;
}

export default function VolumeStep({ data, onNext, saving }: VolumeStepProps) {
  const [productVolume, setProductVolume] = useState(data?.productVolume || '');

  const volumes = [
    { id: '1-10', label: '1 - 10 products', icon: '📦' },
    { id: '10-100', label: '10 - 100 products', icon: '📦📦' },
    { id: '100-1000', label: '100 - 1,000 products', icon: '📦📦📦' },
    { id: '1000+', label: '1,000+ products', icon: '📦📦📦📦' },
  ];

  const handleNext = () => {
    if (!productVolume) {
      alert('Please select a volume range');
      return;
    }
    onNext({ productVolume });
  };

  return (
    <div className="space-y-6">
      <div>
        <p className="text-gray-600 mb-6">
          How many products do you plan to list approximately?
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {volumes.map((volume) => (
          <button
            key={volume.id}
            onClick={() => setProductVolume(volume.id)}
            className={`p-4 border-2 rounded-lg text-center transition-all ${
              productVolume === volume.id
                ? 'border-blue-600 bg-blue-50'
                : 'border-gray-200 hover:border-gray-300'
            }`}
          >
            <div className="text-2xl mb-2">{volume.icon}</div>
            <p className="font-medium text-gray-900">{volume.label}</p>
          </button>
        ))}
      </div>

      <div className="flex justify-end gap-4">
        <Button
          variant="primary"
          onClick={handleNext}
          disabled={saving || !productVolume}
        >
          {saving ? 'Saving...' : 'Next'}
        </Button>
      </div>
    </div>
  );
}
