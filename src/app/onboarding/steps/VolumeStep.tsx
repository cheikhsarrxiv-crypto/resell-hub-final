import { useState } from 'react';
import { DashboardButton } from '@/components/dashboard/DashboardButton';

interface VolumeStepProps {
  data: any;
  onNext: (data: any) => void;
  saving: boolean;
}

export default function VolumeStep({ data, onNext, saving }: VolumeStepProps) {
  const [productVolume, setProductVolume] = useState(data?.productVolume || '');
  const [formError, setFormError] = useState<string | null>(null);

  const volumes = [
    { id: '1-10', label: '1 - 10 products' },
    { id: '10-100', label: '10 - 100 products' },
    { id: '100-1000', label: '100 - 1,000 products' },
    { id: '1000+', label: '1,000+ products' },
  ];

  const handleNext = () => {
    if (!productVolume) {
      setFormError('Please select a volume range.');
      return;
    }
    setFormError(null);
    onNext({ productVolume });
  };

  return (
    <div className="space-y-6">
      <div>
        <p className="text-gray-400 mb-6">
          How many products do you plan to list approximately?
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {volumes.map((volume) => (
          <button
            key={volume.id}
            onClick={() => setProductVolume(volume.id)}
            className={`p-4 border rounded-lg text-left transition-colors ${
              productVolume === volume.id
                ? 'border-[#FF5A1F]/50 bg-[#FF5A1F]/[0.06]'
                : 'border-white/10 hover:border-white/20'
            }`}
          >
            <p className="font-medium text-white">{volume.label}</p>
          </button>
        ))}
      </div>

      {formError && <p className="text-sm text-red-400">{formError}</p>}

      <div className="flex justify-end gap-4">
        <DashboardButton
          variant="primary"
          onClick={handleNext}
          disabled={saving || !productVolume}
        >
          {saving ? 'Saving...' : 'Next'}
        </DashboardButton>
      </div>
    </div>
  );
}
