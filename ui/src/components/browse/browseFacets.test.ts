import { describe, expect, it } from "vitest";
import { facetOptions, projectFacetIds } from "./browseFacets";
import type { AssetItem } from "../../types";

function makeItem(projectName: string): AssetItem {
  return {
    id: projectName,
    projectId: projectName,
    projectName,
    repoPath: `${projectName}/asset.png`,
    localPath: `/tmp/${projectName}/asset.png`,
    ext: ".png",
    bytes: 1,
    modifiedUnix: 0,
    contentHash: projectName,
    hashAlgorithm: "sha1",
    image: {
      format: "png",
      width: 1,
      height: 1,
      animated: false,
      alpha: true,
      pages: 1,
    },
    url: `/assets/${projectName}.png`,
    thumbnailUrl: `/assets/${projectName}.png`,
    usedBy: [],
    references: [],
    duplicateGroupId: null,
    duplicates: [],
    similar: [],
    preferredDuplicatePath: null,
    optimizationRecommendations: [],
  };
}

describe("projectFacetIds", () => {
  it("keeps registered all-project options even when a project has no matching assets", () => {
    expect(
      projectFacetIds({
        items: [makeItem("workspace")],
        projectNames: ["001", "workspace"],
        projectFilterName: "",
      }),
    ).toEqual(["001", "workspace"]);
  });

  it("keeps a selected Project Switcher scope narrowed to that project", () => {
    expect(
      projectFacetIds({
        items: [makeItem("workspace")],
        projectNames: ["001", "workspace"],
        projectFilterName: "workspace",
      }),
    ).toEqual(["workspace"]);
  });
});

describe("facetOptions", () => {
  it("keeps zero-count options visible", () => {
    expect(
      facetOptions(["001", "workspace"], [makeItem("workspace")], "projectName")
        .options,
    ).toEqual([
      { id: "workspace", count: 1 },
      { id: "001", count: 0 },
    ]);
  });
});
