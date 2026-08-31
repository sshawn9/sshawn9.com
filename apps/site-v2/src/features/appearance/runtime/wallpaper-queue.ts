export type RandomSource = () => number;

export function shuffleWallpaperIds(ids: readonly string[], random: RandomSource): string[] {
  const shuffled = [...ids];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex]!, shuffled[index]!];
  }
  return shuffled;
}

export function restoreWallpaperQueue(
  storedIds: readonly string[],
  availableIds: readonly string[],
  currentId: string | undefined,
): string[] {
  const available = new Set(availableIds);
  const seen = new Set<string>();
  return storedIds.filter((id) => {
    if (id === currentId || !available.has(id) || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

export function reconcileWallpaperQueue(
  queueIds: readonly string[],
  previousIds: readonly string[],
  nextIds: readonly string[],
  currentId: string | undefined,
  random: RandomSource,
): string[] {
  const retained = restoreWallpaperQueue(queueIds, nextIds, currentId);
  const previous = new Set(previousIds);
  const retainedSet = new Set(retained);
  const added = nextIds.filter(
    (id) => id !== currentId && !previous.has(id) && !retainedSet.has(id),
  );
  return [...retained, ...shuffleWallpaperIds(added, random)];
}

export function replenishWallpaperQueue(
  availableIds: readonly string[],
  currentId: string | undefined,
  random: RandomSource,
): string[] {
  return shuffleWallpaperIds(
    availableIds.filter((id) => id !== currentId),
    random,
  );
}
