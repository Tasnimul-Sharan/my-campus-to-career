export const TALENT_CATEGORIES = [
  { slug: 'software-it', name: 'Software & IT', description: 'Software development, data, IT support and digital systems.' },
  { slug: 'design-creative', name: 'Design & Creative', description: 'Visual design, product design and creative work.' },
  { slug: 'marketing-sales', name: 'Marketing & Sales', description: 'Marketing, sales, customer growth and brand communications.' },
  { slug: 'accounting-finance', name: 'Accounting & Finance', description: 'Accounting, finance, business analysis and operations.' },
  { slug: 'engineering', name: 'Engineering', description: 'Engineering disciplines, technical projects and applied problem solving.' },
  { slug: 'content-communication', name: 'Content & Communication', description: 'Writing, media, communication and content production.' },
  { slug: 'exploring', name: 'Exploring career paths', description: 'Students discovering their career direction and transferable skills.' },
] as const;

export const TALENT_CATEGORY_SLUGS = TALENT_CATEGORIES.map(category => category.slug);

export const TALENT_AVAILABILITIES = [
  { value: 'INTERNSHIP', label: 'Internship' },
  { value: 'FULL_TIME', label: 'Full-time' },
  { value: 'PART_TIME', label: 'Part-time' },
  { value: 'OPEN_TO_OPPORTUNITIES', label: 'Open to opportunities' },
] as const;
