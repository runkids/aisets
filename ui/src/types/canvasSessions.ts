export type CanvasSessionMeta = {
  id: string;
  workspaceId: string;
  name: string;
  cardCount: number;
  hasThumbnail: boolean;
  createdAt: string;
  updatedAt: string;
};

export type CanvasSessionFull = CanvasSessionMeta & {
  stateJson: string;
};
