/// <reference lib="webworker" />

// ---------- Types ----------
type Mode = "ALL" | "ANY";

interface NodeT {
  id: string;
  group: number;
}

interface LinkT {
  source: string;
  target: string;
  value?: number;
}

interface GraphT {
  nodes: NodeT[];
  links: LinkT[];
}

// ---------- Global state inside worker ----------
let featureToChunks: Map<string, Set<string>> | null = null;
let featureIds: string[] = [];
let chunkIds: string[] = [];

// Just for debugging if you want to log what was chosen
let FILE_GROUP: number | null = null;
let CHUNK_GROUP: number | null = null;

console.log("[worker] loaded");

// ---------- Group detection ----------

function detectGroups(
  nodes: NodeT[],
  links: LinkT[],
  hintFileGroup?: number,
  hintChunkGroup?: number
): { fileGroup: number; chunkGroup: number } {
  const groups = Array.from(new Set(nodes.map((n) => n.group)));

  // If caller supplied explicit groups, trust them
  if (typeof hintFileGroup === "number" && typeof hintChunkGroup === "number") {
    console.log("[worker] using hinted groups", {
      fileGroup: hintFileGroup,
      chunkGroup: hintChunkGroup,
    });
    return { fileGroup: hintFileGroup, chunkGroup: hintChunkGroup };
  }

  // 1) Try to infer from ID prefixes
  const idsByGroup = new Map<number, string[]>();
  for (const n of nodes) {
    if (!idsByGroup.has(n.group)) idsByGroup.set(n.group, []);
    idsByGroup.get(n.group)!.push(n.id);
  }

  let fileHint: number | undefined;
  let chunkHint: number | undefined;

  for (const g of groups) {
    const ids = idsByGroup.get(g)!;
    const fileLike = ids.some(
      (id) => id.startsWith("file_name_") || /\.(wav|mp3|flac|ogg)$/i.test(id)
    );
    const chunkLike = ids.some((id) => id.startsWith("chunk_id_"));

    if (fileLike && fileHint === undefined) fileHint = g;
    if (chunkLike && chunkHint === undefined) chunkHint = g;
  }

  if (fileHint !== undefined && chunkHint !== undefined) {
    console.log("[worker] detected groups from prefixes", {
      fileGroup: fileHint,
      chunkGroup: chunkHint,
    });
    return { fileGroup: fileHint, chunkGroup: chunkHint };
  }

  // 2) Very simple structural heuristic as a fallback
  const groupOf = new Map<string, number>();
  for (const n of nodes) groupOf.set(n.id, n.group);

  const neighborGroups = new Map<number, Set<number>>();
  for (const { source, target } of links) {
    const gs = groupOf.get(source);
    const gt = groupOf.get(target);
    if (gs == null || gt == null || gs === gt) continue;
    if (!neighborGroups.has(gs)) neighborGroups.set(gs, new Set());
    if (!neighborGroups.has(gt)) neighborGroups.set(gt, new Set());
    neighborGroups.get(gs)!.add(gt);
    neighborGroups.get(gt)!.add(gs);
  }

  // chunk group = group with highest degree (connected to many others)
  let chunkGroup = groups[0];
  let bestDeg = -1;
  for (const g of groups) {
    const deg = neighborGroups.get(g)?.size ?? 0;
    if (deg > bestDeg) {
      bestDeg = deg;
      chunkGroup = g;
    }
  }

  // file group = some other group; pick the one with fewest neighbors
  let fileGroup = groups[0];
  let bestScore = Infinity;
  for (const g of groups) {
    if (g === chunkGroup) continue;
    const deg = neighborGroups.get(g)?.size ?? 0;
    if (deg < bestScore) {
      bestScore = deg;
      fileGroup = g;
    }
  }

  console.log("[worker] detected groups from structure", {
    fileGroup,
    chunkGroup,
  });

  return { fileGroup, chunkGroup };
}

// ---------- Index building ----------

function buildFeatureIndex(
  graph: GraphT,
  fileGroup: number,
  chunkGroup: number
): void {
  const groupOf = new Map<string, number>();
  for (const n of graph.nodes) groupOf.set(n.id, n.group);

  const map = new Map<string, Set<string>>();
  const feats: string[] = [];
  const chunks: string[] = [];

  for (const n of graph.nodes) {
    if (n.group === chunkGroup) {
      chunks.push(n.id);
    } else if (n.group !== fileGroup) {
      // everything that is not file and not chunk is treated as feature
      feats.push(n.id);
    }
  }

  for (const { source, target } of graph.links) {
    const gs = groupOf.get(source);
    const gt = groupOf.get(target);
    if (gs == null || gt == null) continue;

    const sourceIsFile = gs === fileGroup;
    const sourceIsChunk = gs === chunkGroup;
    const targetIsFile = gt === fileGroup;
    const targetIsChunk = gt === chunkGroup;

    const sourceIsFeature = !sourceIsFile && !sourceIsChunk;
    const targetIsFeature = !targetIsFile && !targetIsChunk;

    // feature ↔ chunk edges (undirected)
    if (sourceIsFeature && targetIsChunk) {
      if (!map.has(source)) map.set(source, new Set());
      map.get(source)!.add(target);
    } else if (targetIsFeature && sourceIsChunk) {
      if (!map.has(target)) map.set(target, new Set());
      map.get(target)!.add(source);
    }
  }

  featureToChunks = map;
  featureIds = feats;
  chunkIds = chunks;

  console.log("[worker] index built", {
    fileGroup,
    chunkGroup,
    featureCount: featureIds.length,
    chunkCount: chunkIds.length,
    featureKeysInMap: featureToChunks.size,
  });

  if (featureToChunks.size > 0) {
    const [k, v] = featureToChunks.entries().next().value as [
      string,
      Set<string>
    ];
    console.log(
      "[worker] sample feature mapping",
      k,
      "->",
      v.size,
      "chunks"
    );
  }
}

// ---------- Chunk computation ----------

function computeChunks(selected: string[], mode: Mode): string[] {
  if (!featureToChunks) {
    console.log("[worker] compute: no index yet");
    return [];
  }

  console.log("[worker] computeChunks", { selected, mode });

  const sets: Set<string>[] = selected.map(
    (f) => featureToChunks!.get(f) ?? new Set<string>()
  );

  console.log(
    "[worker] per-feature set sizes",
    sets.map((s) => s.size)
  );

  if (sets.length === 0) return [];

  let result: Set<string>;

  if (mode === "ALL") {
    // intersection
    sets.sort((a, b) => a.size - b.size);
    result = new Set<string>(sets[0]);
    for (let i = 1; i < sets.length; i++) {
      const next = new Set<string>();
      for (const x of result) if (sets[i].has(x)) next.add(x);
      result = next;
    }
  } else {
    // ANY: union
    result = new Set<string>();
    for (const s of sets) for (const x of s) result.add(x);
  }

  const out = Array.from(result).sort();
  console.log("[worker] computeChunks result size", out.length);
  return out;
}

// ---------- Message handler ----------

// eslint-disable-next-line no-restricted-globals
self.onmessage = (ev: MessageEvent) => {
  const msg = ev.data;
  console.log("[worker] onmessage", msg.type);

  try {
    if (msg.type === "initFromText") {
      const text: string = msg.text;
      const hintFileGroup: number | undefined = msg.fileGroup;
      const hintChunkGroup: number | undefined = msg.chunkGroup;

      console.log(
        "[worker] initFromText: text length",
        text ? text.length : null
      );

      const parsed = JSON.parse(text) as GraphT;

      console.log("[worker] parsed graph", {
        nodes: parsed.nodes.length,
        links: parsed.links.length,
        sampleNode: parsed.nodes[0],
        sampleLink: parsed.links[0],
      });

      const { fileGroup, chunkGroup } = detectGroups(
        parsed.nodes,
        parsed.links,
        hintFileGroup,
        hintChunkGroup
      );
      FILE_GROUP = fileGroup;
      CHUNK_GROUP = chunkGroup;

      buildFeatureIndex(parsed, fileGroup, chunkGroup);

      (postMessage as any)({
        type: "ready",
        featureIds,
        chunkCount: chunkIds.length,
        fileGroup,
        chunkGroup,
      });
    } else if (msg.type === "compute") {
      const selected: string[] = msg.selected ?? [];
      const mode: Mode = msg.mode === "ALL" ? "ALL" : "ANY";
      const chunks = computeChunks(selected, mode);
      (postMessage as any)({ type: "result", chunks });
    }
  } catch (e: any) {
    console.error("[worker] error", e);
    (postMessage as any)({
      type: "error",
      error: e?.message ?? String(e),
    });
  }
};
