// --- helpers for detection ---
function autoDetectGroups(nodes: NodeT[], links: LinkT[]) {
  // Count groups and quick prefix/extension hints
  const idsByGroup = new Map<number, string[]>();
  for (const n of nodes) {
    if (!idsByGroup.has(n.group)) idsByGroup.set(n.group, []);
    idsByGroup.get(n.group)!.push(n.id);
  }

  const groups = [...idsByGroup.keys()];

  // 1) Prefix/extension-based hints
  let fileGroupHint: number ;
  let chunkGroupHint: number;

  for (const g of groups) {
    const ids = idsByGroup.get(g)!;
    const fileLike = ids.some(id => id.startsWith("file_name_"));
    const chunkLike = ids.some(id => id.startsWith("chunk_id_"));
    if (fileLike) fileGroupHint = g;
    if (chunkLike) chunkGroupHint = g;
  }



  // 2) Structural heuristic
  // Build group–group adjacency and edge counts
  const groupNeighbors = new Map<number, Set<number>>();
  const groupEdgeCountTo = new Map<string, number>(); // key "g1|g2" with g1<g2

  const incEdge = (a: number, b: number) => {
    if (!groupNeighbors.has(a)) groupNeighbors.set(a, new Set());
    if (!groupNeighbors.has(b)) groupNeighbors.set(b, new Set());
    groupNeighbors.get(a)!.add(b);
    groupNeighbors.get(b)!.add(a);
    const g1 = Math.min(a, b), g2 = Math.max(a, b);
    const k = `${g1}|${g2}`;
    groupEdgeCountTo.set(k, (groupEdgeCountTo.get(k) ?? 0) + 1);
  };

  // Build a quick node->group map
  const groupOf = new Map<string, number>();
  for (const n of nodes) groupOf.set(n.id, n.group);

  for (const { source, target } of links) {
    const gs = groupOf.get(source);
    const gt = groupOf.get(target);
    if (gs == null || gt == null) continue;
    if (gs === gt) continue;          // ignore intra-group edges for structure
    incEdge(gs, gt);
  }

  // Pick chunkGroup as the group connected to the most distinct other groups
  let chunkGroup = chunkGroupHint ?? groups[0];
  let bestDeg = -1;
  for (const g of groups) {
    const deg = groupNeighbors.get(g)?.size ?? 0;
    if (deg > bestDeg) { bestDeg = deg; chunkGroup = g; }
  }

  // Score each group as a file candidate
  // Favor strong connection to chunkGroup, penalize connections elsewhere.
  let fileGroup = fileGroupHint ?? groups[0];
  let bestScore = -Infinity;
  for (const g of groups) {
    if (g === chunkGroup) continue;
    const g1 = Math.min(g, chunkGroup), g2 = Math.max(g, chunkGroup);
    const toChunk = groupEdgeCountTo.get(`${g1}|${g2}`) ?? 0;
    const deg = (groupNeighbors.get(g)?.size ?? 0);
    const fileLikeBoost = (idsByGroup.get(g)!.some(id => id.startsWith("file_name_") || FILE_RE.test(id)) ? 1 : 0);

    // Heuristic: strong toChunk, few other neighbors, bonus if file-like names
    const score = 3 * toChunk - 2 * Math.max(0, deg - 1) + 2 * fileLikeBoost;
    if (score > bestScore) { bestScore = score; fileGroup = g; }
  }

  return { fileGroup, chunkGroup };
}

// --- kinds based on detected groups ---
function buildKinds(nodes: NodeT[], fileGroup: number, chunkGroup: number) {
  const groupOf = new Map<string, number>();
  for (const n of nodes) groupOf.set(n.id, n.group);
  const kindOf = (id: string): "file" | "chunk" | "feature" => {
    const g = groupOf.get(id);
    if (g === fileGroup) return "file";
    if (g === chunkGroup) return "chunk";
    return "feature";
  };
  return { groupOf, kindOf };
}

// --- feature→chunks index ---
function buildFeatureToChunks(g: GraphT, fileGroup: number, chunkGroup: number) {
  const { kindOf } = buildKinds(g.nodes, fileGroup, chunkGroup);
  const map = new Map<string, Set<string>>();
  for (const { source, target } of g.links) {
    const ks = kindOf(source);
    const kt = kindOf(target);
    if (ks === "feature" && kt === "chunk") {
      if (!map.has(source)) map.set(source, new Set());
      map.get(source)!.add(target);
    } else if (kt === "feature" && ks === "chunk") {
      if (!map.has(target)) map.set(target, new Set());
      map.get(target)!.add(source);
    }
  }
  return map;
}
