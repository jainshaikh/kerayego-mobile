import { useState } from 'react';
import { Linking, View, type StyleProp, type ViewStyle } from 'react-native';

import { AppButton, AppText } from '../../../components/ui';
import { useTheme } from '../../../theme';
import { CODE_BY_MESSAGE } from '../phoneVerification';

interface GetCodeOnWhatsAppProps {
  // The send result's messageUsUrl (a wa.me link with the message prefilled).
  url: string;
  // True when the code wasn't sent (codeSent: false): this is the way to get it.
  primary: boolean;
  style?: StyleProp<ViewStyle>;
}

// "Get the code on WhatsApp" on the code steps of phone sign-in
// (PhoneSignInFlow) and in-app verification (PhoneVerificationFlow): opens
// WhatsApp with "Send my KerayeGo code" to KerayeGo's number; the backend
// replies with the 6-digit code, typed into the same code field.
export function GetCodeOnWhatsApp({ url, primary, style }: GetCodeOnWhatsAppProps) {
  const { spacing, colors } = useTheme();
  const [openFailed, setOpenFailed] = useState(false);

  const open = async () => {
    setOpenFailed(false);
    try {
      await Linking.openURL(url);
    } catch {
      setOpenFailed(true);
    }
  };

  return (
    <View style={style}>
      <AppButton title={CODE_BY_MESSAGE.BUTTON} variant={primary ? 'primary' : 'outline'} onPress={() => void open()} />
      <AppText variant="caption" muted style={{ marginTop: spacing.xs, textAlign: 'center' }}>
        {CODE_BY_MESSAGE.HELP}
      </AppText>
      {openFailed ? (
        <AppText variant="caption" color={colors.danger} style={{ marginTop: spacing.xs, textAlign: 'center' }}>
          {CODE_BY_MESSAGE.OPEN_FAILED}
        </AppText>
      ) : null}
    </View>
  );
}
