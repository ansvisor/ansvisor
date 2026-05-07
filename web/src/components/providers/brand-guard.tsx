"use client";

import { useSyncExternalStore, useCallback } from "react";
import { useBrandStore } from "@/stores/use-brand-store";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "@/i18n/navigation";
import { Building2, Plus, ChevronRight } from "lucide-react";
import { usePathname } from "@/i18n/navigation";

const BRAND_EXEMPT_PATHS = [
  "/dashboard/brands",
  "/dashboard/settings",
  "/dashboard/onboarding",
];

function isExempt(pathname: string) {
  return BRAND_EXEMPT_PATHS.some(
    (p) => pathname === p || pathname.startsWith(p + "/"),
  );
}

const emptySubscribe = () => () => {};

export function BrandGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const brands = useBrandStore((s) => s.brands);
  const activeBrandId = useBrandStore((s) => s.activeBrandId);
  const setActiveBrand = useBrandStore((s) => s.setActiveBrand);
  const hydrated = useSyncExternalStore(
    emptySubscribe,
    useCallback(() => true, []),
    useCallback(() => false, []),
  );

  if (isExempt(pathname)) {
    return <>{children}</>;
  }

  if (!hydrated) {
    return <BrandGuardSkeleton />;
  }

  if (brands.length === 0) {
    return <NoBrandsState />;
  }

  const activeBrand = brands.find((b) => b.id === activeBrandId);

  if (!activeBrand) {
    return (
      <BrandSelector
        brands={brands}
        onSelect={(id) => setActiveBrand(id)}
      />
    );
  }

  return <>{children}</>;
}

function BrandGuardSkeleton() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-80" />
      </div>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i}>
            <CardContent className="pt-6 space-y-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-8 w-16" />
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function NoBrandsState() {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-muted">
        <Building2 className="h-8 w-8 text-muted-foreground" />
      </div>
      <h2 className="text-xl font-semibold">No brands yet</h2>
      <p className="mt-2 max-w-sm text-sm text-muted-foreground">
        Create your first brand to start tracking how AI engines talk about you.
      </p>
      <Link href="/dashboard/brands/new" className="mt-6">
        <Button className="gap-2">
          <Plus className="h-4 w-4" />
          Create Brand
        </Button>
      </Link>
    </div>
  );
}

function BrandSelector({
  brands,
  onSelect,
}: {
  brands: { id: string; name: string; logoUrl?: string }[];
  onSelect: (id: string) => void;
}) {
  const initials = (name: string) =>
    name
      .split(" ")
      .map((w) => w[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);

  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-muted">
        <Building2 className="h-8 w-8 text-muted-foreground" />
      </div>
      <h2 className="text-xl font-semibold">Select a brand</h2>
      <p className="mt-2 max-w-sm text-sm text-muted-foreground">
        Choose which brand you want to work with.
      </p>

      <div className="mt-8 grid w-full max-w-md gap-3">
        {brands.map((brand) => (
          <Card
            key={brand.id}
            className="cursor-pointer transition-colors hover:bg-accent"
            onClick={() => onSelect(brand.id)}
          >
            <CardContent className="flex items-center gap-3 p-4">
              <Avatar className="h-9 w-9 rounded-md bg-zinc-50 dark:bg-zinc-100">
                <AvatarImage
                  src={brand.logoUrl}
                  alt={brand.name}
                  className="object-contain p-1"
                />
                <AvatarFallback className="rounded-md bg-primary text-primary-foreground text-sm font-semibold">
                  {initials(brand.name)}
                </AvatarFallback>
              </Avatar>
              <span className="flex-1 text-left text-sm font-medium">
                {brand.name}
              </span>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
