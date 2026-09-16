import { Check } from 'lucide-react';
import { DashboardButton } from '@/components/dashboard/DashboardButton';

interface FinishStepProps {
  data: any;
  onNext: (data: any) => void;
  onPrevious?: () => void;
  saving: boolean;
  isLastStep: boolean;
}

export default function FinishStep({ onNext, saving, isLastStep }: FinishStepProps) {
  const handleNext = () => {
    onNext({});
  };

  return (
    <div className="space-y-6 text-center">
      <div className="py-8">
        <h2 className="text-2xl font-semibold text-white mb-3">
          You're all set
        </h2>
        <p className="text-gray-400 mb-8">
          Your reselling business is now ready. Let's start selling!
        </p>
      </div>

      <div className="bg-white/[0.03] border border-white/10 rounded-lg p-6 mb-6 text-left">
        <h3 className="font-medium text-white mb-3">What's next</h3>
        <ul className="space-y-2 text-sm text-gray-400">
          {['Create your first product', 'Set up marketplace connections', 'Create listings', 'Start selling'].map(
            (item) => (
              <li key={item} className="flex items-center gap-2">
                <Check className="w-4 h-4 text-emerald-400 shrink-0" />
                {item}
              </li>
            )
          )}
        </ul>
      </div>

      <div className="flex justify-center gap-4">
        <DashboardButton
          variant="primary"
          size="lg"
          onClick={handleNext}
          disabled={saving}
        >
          {saving ? 'Finishing...' : 'Go to Dashboard'}
        </DashboardButton>
      </div>
    </div>
  );
}
