import { AppSheet } from '../../../components/ui';
import { useAuth } from '../../../auth/auth-context';
import type { User } from '../../../types/api.types';
import { PhoneVerificationFlow } from './PhoneVerificationFlow';

interface ChangePhoneSheetProps {
  visible: boolean;
  // The number shown in step 1 (the account's current one, or empty).
  initialPhone: string;
  // Verify the current number (true) or change it (false) — only the title.
  verifyCurrent: boolean;
  onClose: () => void;
  onVerified: (user: User) => void;
}

// The profile's way to add, change or verify the mobile number: the same
// WhatsApp send-code → verify flow as the blocking gate, in a sheet (× and
// tap-outside close it). The number changes only once a code proves it.
export function ChangePhoneSheet({ visible, initialPhone, verifyCurrent, onClose, onVerified }: ChangePhoneSheetProps) {
  const { replaceUser } = useAuth();

  return (
    <AppSheet
      visible={visible}
      onClose={onClose}
      title={verifyCurrent ? 'Verify your number' : 'Change mobile number'}
      subtitle="We'll send a 6-digit code on WhatsApp"
    >
      <PhoneVerificationFlow
        initialPhone={initialPhone}
        onVerified={(user) => {
          replaceUser(user);
          onVerified(user);
        }}
      />
    </AppSheet>
  );
}
