function activeRailSectionsForScroll<T>(
  sortedSections: T[],
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number,
  sectionTop: (section: T) => number,
) {
  if (scrollTop <= 0 || scrollHeight <= clientHeight + 1) return [];

  return sortedSections.filter(
    (section) => sectionTop(section) <= scrollTop + 1,
  );
}

export { activeRailSectionsForScroll };
