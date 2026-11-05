import { emptyAddress, type ProfileAddresses, type StudentAddress } from './api';

// Bangladesh Agro-Meteorological Information Service: https://www.bamis.gov.bd/en/bmd/observed/spi/table/
// Keep these display names aligned with the API's address validation list.
export const BANGLADESH_DISTRICTS = [
  'Bagerhat', 'Bandarban', 'Barguna', 'Barishal', 'Bhola', 'Bogura',
  'Brahmanbaria', 'Chandpur', 'Chapai Nawabganj', 'Chattogram', 'Chuadanga',
  "Cox's Bazar", 'Cumilla', 'Dhaka', 'Dinajpur', 'Faridpur', 'Feni',
  'Gaibandha', 'Gazipur', 'Gopalganj', 'Habiganj', 'Jamalpur', 'Jashore',
  'Jhalokati', 'Jhenaidah', 'Joypurhat', 'Khagrachhari', 'Khulna',
  'Kishoreganj', 'Kurigram', 'Kushtia', 'Lakshmipur', 'Lalmonirhat',
  'Madaripur', 'Magura', 'Manikganj', 'Meherpur', 'Moulvibazar', 'Munshiganj',
  'Mymensingh', 'Naogaon', 'Narail', 'Narayanganj', 'Narsingdi', 'Natore',
  'Netrokona', 'Nilphamari', 'Noakhali', 'Pabna', 'Panchagarh', 'Patuakhali',
  'Pirojpur', 'Rajbari', 'Rajshahi', 'Rangamati', 'Rangpur', 'Satkhira',
  'Shariatpur', 'Sherpur', 'Sirajganj', 'Sunamganj', 'Sylhet', 'Tangail',
  'Thakurgaon',
] as const;

function normalizeAddress(value: unknown): StudentAddress {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const text = (key: keyof StudentAddress) => typeof source[key] === 'string' ? source[key] as string : '';
  const district = text('district');
  return {
    ...emptyAddress,
    streetAddress: text('streetAddress'),
    postOffice: text('postOffice'),
    policeStation: text('policeStation'),
    district: BANGLADESH_DISTRICTS.some(name => name === district) ? district : '',
  };
}

export function normalizeProfileAddresses(value: unknown): ProfileAddresses {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  return { permanent: normalizeAddress(source.permanent), current: normalizeAddress(source.current) };
}

export function addressesMatch(value: ProfileAddresses): boolean {
  return Object.keys(emptyAddress).every(key => value.permanent[key as keyof StudentAddress] === value.current[key as keyof StudentAddress]);
}

export function hasAddress(value: StudentAddress): boolean {
  return Object.values(value).some(part => part.trim().length > 0);
}
