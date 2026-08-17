import { Button } from '@/components/UI/Button';

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
      <div className="py-12">
        <div className="text-6xl mb-6">🎉</div>
        <h2 className="text-2xl font-bold text-gray-900 mb-3">
          You're all set!
        </h2>
        <p className="text-gray-600 mb-8">
          Your reselling business is now ready. Let's start selling!
        </p>
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-lg p-6 mb-6">
        <h3 className="font-medium text-gray-900 mb-3">What's next?</h3>
        <ul className="text-left space-y-2 text-sm text-gray-700">
          <li>✅ Create your first product</li>
          <li>✅ Set up marketplace connections</li>
          <li>✅ Create listings</li>
          <li>✅ Start selling!</li>
        </ul>
      </div>

      <div className="flex justify-center gap-4">
        <Button
          variant="primary"
          size="lg"
          onClick={handleNext}
          disabled={saving}
        >
          {saving ? 'Finishing...' : 'Go to Dashboard'}
        </Button>
      </div>
    </div>
  );
}
