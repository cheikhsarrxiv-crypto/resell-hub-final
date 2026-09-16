import { useState } from 'react';
import { DashboardButton } from '@/components/dashboard/DashboardButton';

interface ImportStepProps {
  data: any;
  onNext: (data: any) => void;
  saving: boolean;
}

export default function ImportStep({ data, onNext, saving }: ImportStepProps) {
  const [importMethod, setImportMethod] = useState(data?.importMethod || '');
  const [formError, setFormError] = useState<string | null>(null);

  const methods = [
    { id: 'manual', title: 'Manual Input', description: 'Add products one by one' },
    { id: 'csv', title: 'CSV Upload', description: 'Import from spreadsheet' },
    { id: 'api', title: 'API Integration', description: 'Connect to your supplier' },
  ];

  const handleNext = () => {
    if (!importMethod) {
      setFormError('Please select an import method.');
      return;
    }
    setFormError(null);
    onNext({ importMethod });
  };

  return (
    <div className="space-y-6">
      <div>
        <p className="text-gray-400 mb-6">
          How would you like to import your products?
        </p>
      </div>

      <div className="space-y-3">
        {methods.map((method) => (
          <label
            key={method.id}
            className={`flex items-center gap-4 p-4 border rounded-lg cursor-pointer transition-colors ${
              importMethod === method.id
                ? 'border-[#FF5A1F]/50 bg-[#FF5A1F]/[0.06]'
                : 'border-white/10 hover:border-white/20'
            }`}
          >
            <input
              type="radio"
              name="importMethod"
              value={method.id}
              checked={importMethod === method.id}
              onChange={(e) => setImportMethod(e.target.value)}
              className="w-4 h-4 accent-[#FF5A1F]"
            />
            <div>
              <p className="font-medium text-white">{method.title}</p>
              <p className="text-sm text-gray-500">{method.description}</p>
            </div>
          </label>
        ))}
      </div>

      {formError && <p className="text-sm text-red-400">{formError}</p>}

      <div className="flex justify-end gap-4">
        <DashboardButton
          variant="primary"
          onClick={handleNext}
          disabled={saving || !importMethod}
        >
          {saving ? 'Saving...' : 'Next'}
        </DashboardButton>
      </div>
    </div>
  );
}
