export type SmsGatewaySettings = {
  username: string;
  apiKey: string;
  senderName: string;
  enabled: boolean;
};

export const DEFAULT_SMS_GATEWAY_SETTINGS: SmsGatewaySettings = {
  username: '',
  apiKey: '',
  senderName: '',
  enabled: true,
};

export function normalizeSmsGatewaySettings(
  value?: Partial<SmsGatewaySettings> | null,
): SmsGatewaySettings {
  const input = value || {};
  return {
    username: typeof input.username === 'string' ? input.username.trim() : '',
    apiKey: typeof input.apiKey === 'string' ? input.apiKey.trim() : '',
    senderName: typeof input.senderName === 'string' ? input.senderName.trim() : '',
    enabled: typeof input.enabled === 'boolean' ? input.enabled : DEFAULT_SMS_GATEWAY_SETTINGS.enabled,
  };
}
