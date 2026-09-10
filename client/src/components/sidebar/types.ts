/** Icon data object from @hugeicons/core-free-icons (type is not exported by the package). */
export type HugeIconData = readonly (readonly [string, { readonly [key: string]: string | number }])[];

export type PrimarySection = {
  id: string;
  label: string;
  icon: HugeIconData;
  href: string;
  adminOnly?: boolean;
};

export type SubNavItem = {
  id: string;
  label: string;
  href: string;
  count?: number;
};

export type SectionConfig = {
  primary: PrimarySection;
  getSubItems: (counts: Record<string, number>) => SubNavItem[];
};
