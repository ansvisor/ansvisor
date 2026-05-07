"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { useBrandStore } from "@/stores/use-brand-store";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { Check, ChevronsUpDown, Plus } from "lucide-react";

interface BrandSwitcherProps {
  collapsed?: boolean;
}

export function BrandSwitcher({ collapsed = false }: BrandSwitcherProps) {
  const t = useTranslations("brands");
  const router = useRouter();
  const { brands, activeBrandId, setActiveBrand } = useBrandStore();

  const activeBrand = brands.find((b) => b.id === activeBrandId) ?? null;

  const initials = (name: string) =>
    name
      .split(" ")
      .map((w) => w[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);

  if (brands.length === 0) {
    return (
      <button
        onClick={() => router.push("/dashboard/brands/new")}
        className={cn(
          "flex w-full items-center gap-2 rounded-md border border-dashed px-2 py-2 text-sm text-muted-foreground transition-colors hover:border-primary hover:text-primary",
          collapsed && "justify-center px-0"
        )}
        title={collapsed ? t("addBrand") : undefined}
      >
        <Plus className="h-4 w-4 shrink-0" />
        {!collapsed && (
          <span className="truncate text-xs">{t("addBrand")}</span>
        )}
      </button>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          "flex w-full items-center gap-2 rounded-md px-2 py-2 text-sm transition-colors hover:bg-accent focus-visible:outline-none",
          collapsed && "justify-center px-0"
        )}
        aria-label={t("switchBrand")}
      >
        <Avatar className="h-6 w-6 shrink-0 rounded-md bg-zinc-50 dark:bg-zinc-100">
          <AvatarImage
            src={activeBrand?.logoUrl}
            alt={activeBrand?.name}
            className="object-contain p-0.5"
          />
          <AvatarFallback className="rounded-md bg-primary text-primary-foreground text-xs font-semibold">
            {activeBrand ? initials(activeBrand.name) : "?"}
          </AvatarFallback>
        </Avatar>

        {!collapsed && (
          <>
            <span className="flex-1 truncate text-left text-sm font-medium">
              {activeBrand?.name ?? t("selectBrand")}
            </span>
            <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          </>
        )}
      </DropdownMenuTrigger>

      <DropdownMenuContent
        className="w-56"
        align="start"
        side="bottom"
        sideOffset={4}
      >
        <DropdownMenuGroup>
          <DropdownMenuLabel className="text-xs text-muted-foreground">
            {t("switchBrand")}
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />

        {brands.map((brand) => {
          const isActive = brand.id === activeBrandId;
          const primaryDomain = brand.domains.find((d) => d.isPrimary);

          return (
            <DropdownMenuItem
              key={brand.id}
              onClick={() => setActiveBrand(brand.id)}
              className="flex items-center gap-2"
            >
              <Avatar className="h-5 w-5 shrink-0 rounded-md bg-zinc-50 dark:bg-zinc-100">
                <AvatarImage
                  src={brand.logoUrl}
                  alt={brand.name}
                  className="object-contain p-0.5"
                />
                <AvatarFallback className="rounded-md bg-primary/10 text-primary text-xs font-semibold">
                  {initials(brand.name)}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 overflow-hidden">
                <p className="truncate text-sm font-medium">{brand.name}</p>
                {primaryDomain && (
                  <p className="truncate text-xs text-muted-foreground">
                    {primaryDomain.domain}
                  </p>
                )}
              </div>
              {isActive && <Check className="h-3.5 w-3.5 shrink-0 text-primary" />}
            </DropdownMenuItem>
          );
        })}

        <DropdownMenuSeparator />

        <DropdownMenuItem
          onClick={() => router.push("/dashboard/brands")}
          className="flex items-center gap-2 text-muted-foreground"
        >
          <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md border">
            <Plus className="h-3 w-3" />
          </div>
          <span className="text-sm">{t("addBrand")}</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
