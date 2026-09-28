import { getAddress, ZeroAddress } from 'ethers';
import { formatPrivacyAddress, parsePrivacyAddress } from '../privacy/address';

export const normalizeRecipient = (value: string, privacy: boolean) => {
  if (privacy) return formatPrivacyAddress(parsePrivacyAddress(value));
  const address = getAddress(value.trim());
  if (address === ZeroAddress) throw new Error('不能发送到零地址');
  return address;
};
