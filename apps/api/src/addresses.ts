// Bangladesh's 64 districts (BAMIS/BMD; DGHS spelling for Khagrachhari).
// https://www.bamis.gov.bd/en/bmd/observed/spi/table/
// Keep these names in sync with the web address form.
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

export type Address = {
  streetAddress: string;
  postOffice: string;
  policeStation: string;
  district: string;
};
export type ProfileAddresses = { permanent: Address; current: Address };

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function normalizeAddress(value: unknown): Address {
  const source = object(value);
  const text = (key: string) => typeof source[key] === 'string' ? source[key] as string : '';
  const district = text('district');
  return {
    streetAddress: text('streetAddress'), postOffice: text('postOffice'),
    policeStation: text('policeStation'),
    district: BANGLADESH_DISTRICTS.some(name => name === district) ? district : '',
  };
}

export function normalizeAddresses(value: unknown): ProfileAddresses {
  const source = object(value);
  return { permanent: normalizeAddress(source.permanent), current: normalizeAddress(source.current) };
}

/** Merge nested patches against the latest row while preserving omitted fields. */
export function mergeAddresses(current: unknown, patch: unknown): ProfileAddresses {
  const result = normalizeAddresses(current), source = object(patch);
  for (const kind of ['permanent', 'current'] as const) {
    const provided = object(source[kind]);
    for (const key of ['streetAddress', 'postOffice', 'policeStation', 'district'] as const) {
      if (typeof provided[key] === 'string') result[kind][key] = provided[key];
    }
  }
  return normalizeAddresses(result);
}
