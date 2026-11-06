import { ProductsSkeleton } from '@/components/brand-visibility/tab-skeleton';

/** The Product Visibility tab's shape while its route loads; the header and tabs above are already up. */
export default function ProductsLoading() {
  return <ProductsSkeleton />;
}
