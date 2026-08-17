import { useState } from 'react';
import { Button } from '@/components/UI/Button';

interface ImportStepProps {
  data: any;
  onNext: (data: any) => void;
  saving: boolean;
}

export default function ImportStep({ data, onNext, saving }: ImportStepProps) {
  const [importMethod, setImportMethod] = useState(data?.importMethod || '');

  const methods = [
    { id: 'manual', title: 'Manual Input', description: 'Add products one by one' },
    { id: 'csv', title: 'CSV Upload', description: 'Import from spreadsheet' },
    { id: 'api', title: 'API Integration', description: 'Connect to your supplier' },
  ];

  const handleNext = () => {
    if (!importMethod) {
      alert('Please select an import method');
      return;
    }
    onNext({ importMethod });
  };

  return (
    <div className="space-y-6">
      <div>
        <p className="text-gray-600 mb-6">
          How would you like to import your products?
        </p>
      </div>

      <div className="space-y-3">
        {methods.map((method) => (
          <label
            key={method.id}
            className={`flex items-center gap-4 p-4 border-2 rounded-lg cursor-pointer transition-all ${
              importMethod === method.id
                ? 'border-blue-600 bg-blue-50'
                : 'border-gray-200 hover:border-gray-300'
            }`}
          >
            <input
              type="radio"
              name="importMethod"
              value={method.id}
              checked={importMethod === method.id}
              onChange={(e) => setImportMethod(e.target.value)}
              className="w-5 h-5 text-blue-600"
            />
            <div>
              <p className="font-medium text-gray-900">{method.title}</p>
              <p className="text-sm text-gray-600">{method.description}</p>
            </div>
          </label>
        ))}
      </div>

      <div className="flex justify-end gap-4">
        <Button
          variant="primary"
          onClick={handleNext}
          disabled={saving || !importMethod}
        >
          {saving ? 'Saving...' : 'Next'}
        </Button>
      </div>
    </div>
  );
}
