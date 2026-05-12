export type SemanticLoadingStyle = "beam" | "constellation" | "swarm";
export type LoadingVisual = SemanticLoadingStyle;
export type SemanticSearchPhase = "idle" | "searching" | "results";

export const LOADING_POOL: LoadingVisual[] = ["beam", "constellation", "swarm"];
