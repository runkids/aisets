export type TagItem = {
  tag: string;
  count: number;
  categories: string[];
  projects: string[];
};

export type TagListResponse = {
  tags: TagItem[];
  total: number;
  totalTaggedAssets: number;
  topCategory: string;
  translations?: Record<string, string>;
  categoryTranslations?: Record<string, string>;
};

export type AICategoryItem = {
  category: string;
  assetCount: number;
  tagCount: number;
  projectCount: number;
  topTags: string[];
};

export type AICategoryListResponse = {
  categories: AICategoryItem[];
  total: number;
  totalCategorizedAssets: number;
  translations?: Record<string, string>;
  tagTranslations?: Record<string, string>;
};
