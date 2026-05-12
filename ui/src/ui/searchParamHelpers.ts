export function drawerSearchParams(prev: URLSearchParams, id: string) {
  const next = new URLSearchParams(prev);
  const hadFocusAsset = next.has("focusAsset");
  if (id) next.set("asset", id);
  else next.delete("asset");
  if (hadFocusAsset) next.delete("focusAsset");
  return next;
}

export function clearBrowseSearchParams(prev: URLSearchParams) {
  const next = new URLSearchParams(prev);
  next.delete("focusAsset");
  next.delete("q");
  return next;
}
