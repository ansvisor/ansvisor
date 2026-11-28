const { apiRequest } = require('./lib/api');

async function listBrands(z, bundle) {
  const result = await apiRequest(z, bundle, 'brands');
  return Array.isArray(result && result.brands) ? result.brands : [];
}

async function findBrand(z, bundle) {
  const query = String((bundle.inputData && bundle.inputData.query) || '').trim().toLowerCase();
  if (!query) return [];
  const brands = await listBrands(z, bundle);
  return brands.filter((brand) => {
    const name = String(brand.name || '').toLowerCase();
    const slug = String(brand.slug || '').toLowerCase();
    return name.includes(query) || slug.includes(query);
  });
}

module.exports = {
  listBrands,
  findBrand,
  searches: {
    find_brand: {
      key: 'find_brand',
      noun: 'Brand',
      display: { label: 'Find Brand', description: 'Finds a brand by its name or slug.' },
      operation: {
        perform: findBrand,
        inputFields: [{ key: 'query', label: 'Brand name or slug', type: 'string', required: true }],
        sample: { id: 'brand-123', name: 'Acme', slug: 'acme' },
      },
    },
  },
};
