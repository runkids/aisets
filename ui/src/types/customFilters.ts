export type CustomAssetFilterField =
  | "path"
  | "folder"
  | "extension"
  | "project"
  | "bytes"
  | "status"
  | "duplicate"
  | "nearDuplicate"
  | "optimizable"
  | "ocrText"
  | "ocrLanguage"
  | "ocrScript"
  | "ocrConfidence"
  | "ocrStatus"
  | "ocrSource"
  | "aiCategory"
  | "aiTag"
  | "aiDescription"
  | "aiStatus"
  | "aiContainsFace"
  | "aiSceneType";

export type CustomAssetFilterOperator =
  | "contains"
  | "regex"
  | "prefix"
  | "suffix"
  | "equals"
  | "oneOf"
  | "gte"
  | "lte"
  | "is";

export type CustomAssetFilterClause = {
  field: CustomAssetFilterField;
  operator: CustomAssetFilterOperator;
  value: string;
};

export type CustomAssetFilterGroup = {
  clauses: CustomAssetFilterClause[];
};

export type CustomAssetFilter = {
  id: string;
  name: string;
  enabled: boolean;
  groups: CustomAssetFilterGroup[];
};
