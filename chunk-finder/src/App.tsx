import React, { useMemo, useRef, useState, useEffect } from "react";

type Mode2 = "ALL" | "ANY";
// @ts-ignore
import WorkerURL from "./chunkWorker.ts?worker&url";

export default function ChunkFinder() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [worker, setWorker] = useState<Worker | null>(null);

  const [err, setErr] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [requireAll, setRequireAll] = useState(true);
  const [results, setResults] = useState<string[]>([]);
  const [isComputing, setIsComputing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressMsg, setProgressMsg] = useState("");
  // const [fileGroup, setFileGroup] = useState(0);
  // const [chunkGroup, setChunkGroup] = useState(3);

  const [featureIds, setFeatureIds] = useState<string[]>([]);
  const [chunkCount, setChunkCount] = useState<number>(0);

  // useEffect(() => {
  //   const w = new Worker(WorkerURL, { type: "module" });
  //   w.onmessage = (ev: MessageEvent) => {
  //     const msg = ev.data;
  //     if (msg.type === "progress") { setProgress(msg.pct); setProgressMsg(msg.msg); }
  //     else if (msg.type === "ready") { setFeatureIds([]); setChunkCount(msg.chunkCount ?? 0); }
  //     else if (msg.type === "result") { setResults(msg.chunks as string[]); setIsComputing(false); }
  //     else if (msg.type === "error") { setErr(msg.error); setIsComputing(false); }
  //   };
  //   setWorker(w);
  //   return () => { w.terminate(); };
  // }, []);

  useEffect(() => {
    const w = new Worker(WorkerURL, { type: "module" });
    console.log("[UI] worker created", w);

    w.onmessage = (ev: MessageEvent) => {
      const msg = ev.data;
      console.log("[UI] message from worker:", msg);   // <--- add this

      if (msg.type === "progress") { setProgress(msg.pct); setProgressMsg(msg.msg); }
      // else if (msg.type === "ready") { 
      //   setFeatureIds(msg.featureIds ?? []);          // we'll send this from worker
      //   setChunkCount(msg.chunkCount ?? 0); 
      // }
      else if (msg.type === "ready") {
        console.log("[UI] ready from worker", msg);
        setFeatureIds(msg.featureIds ?? []);
        setChunkCount(msg.chunkCount ?? 0);
      }
      else if (msg.type === "result") { setResults(msg.chunks as string[]); setIsComputing(false); }
      else if (msg.type === "error") { setErr(msg.error); setIsComputing(false); }
    };
    setWorker(w);
    return () => { w.terminate(); };
  }, []);


  const filteredFeatures = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return featureIds;
    return featureIds.filter(id => id.toLowerCase().includes(q));
  }, [featureIds, query]);

  // async function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
  //   setErr(null); setResults([]); setSelected(new Set());
  //   const f = e.target.files?.[0];
  //   if (!f || !worker) return;
  //   const text = await f.text();
  //   //worker.postMessage({ type: "initFromText", text, fileGroup, chunkGroup });
  //   worker.postMessage({ type: "initFromText", text });
  //   //if (fileInputRef.current) fileInputRef.current.value = "";
  // }
  async function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    setErr(null); setResults([]); setSelected(new Set());
    const f = e.target.files?.[0];
    if (!f || !worker) {
      console.log("[UI] no file or no worker", { f, worker });
      return;
    }
    const text = await f.text();
    console.log("[UI] sending initFromText, length", text.length);
    worker.postMessage({ type: "initFromText", text });
  }


  async function compute() {
    if (!worker) return;
    const sel = Array.from(selected);
    if (sel.length === 0) { setResults([]); return; }
    setIsComputing(true); setProgress(5); setProgressMsg("Queued…");
    worker.postMessage({ type: "compute", selected: sel, mode: (requireAll ? "ALL" : "ANY") satisfies Mode2 });
  }

  function toggle(id: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function copyToClipboard() {
    if (results.length === 0) return;
    navigator.clipboard.writeText(results.join("\n"));
  }

  function downloadCSV() {
    if (results.length === 0) return;
    const header = "chunk_id";
    const body = results.map(r => JSON.stringify(r)).join("\n");
    const blob = new Blob([header + "\n" + body + "\n"], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "chunks.csv"; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="min-h-screen p-6 bg-gray-50 text-gray-900">
      <div className="mx-auto max-w-6xl">
        <h1 className="text-2xl font-semibold mb-4">Chunk Finder (Worker)</h1>
        <div className="grid md:grid-cols-3 gap-6">
          <div className="md:col-span-1 space-y-4">
            <div className="rounded-2xl border bg-white p-4 shadow-sm space-y-3">
              <label className="block text-sm font-medium mb-2">Upload graph JSON</label>
              <input ref={fileInputRef} type="file" accept="application/json,.json" onChange={onUpload} className="block w-full text-sm" />
              {/* <div className="flex gap-2 mt-3 text-sm">
                <div>
                  <label>File group</label>
                  <input type="number" value={fileGroup} onChange={e => setFileGroup(Number(e.target.value))} className="ml-2 w-16 border rounded" />
                </div>
                <div>
                  <label>Chunk group</label>
                  <input type="number" value={chunkGroup} onChange={e => setChunkGroup(Number(e.target.value))} className="ml-2 w-16 border rounded" />
                </div>
              </div> */}
              {err && <p className="text-red-600 text-sm mt-2">{err}</p>}
            </div>

            <div className="rounded-2xl border bg-white p-4 shadow-sm">
              <div className="mt-3 space-y-2 text-sm">
                <label className="flex items-center gap-2">
                  <input type="radio" name="mode" checked={requireAll} onChange={() => setRequireAll(true)} />
                  Must be connected to <b>ALL</b> selected features
                </label>
                <label className="flex items-center gap-2">
                  <input type="radio" name="mode" checked={!requireAll} onChange={() => setRequireAll(false)} />
                  Connected to <b>ANY</b> selected features
                </label>
              </div>
              <button onClick={compute} disabled={!worker || isComputing} className="mt-3 px-3 py-2 rounded-xl bg-blue-600 text-white disabled:bg-gray-300">{isComputing ? "Working…" : "Find chunks"}</button>
              <div className="mt-3">
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-gray-700">{progressMsg}</span>
                  <span className="text-gray-500">{progress}%</span>
                </div>
                <div className="w-full h-2 rounded-full bg-gray-200 overflow-hidden">
                  <div className="h-2 bg-blue-600" style={{ width: `${progress}%` }} />
                </div>
              </div>
            </div>
          </div>

          <div className="md:col-span-2 space-y-6">
            <div className="rounded-2xl border bg-white p-4 shadow-sm">
              <div className="flex items-center gap-2 mb-3">
                <input type="text" placeholder="Search features" value={query} onChange={e => setQuery(e.target.value)} className="w-full rounded-xl border px-3 py-2 text-sm" />
              </div>
              <div className="h-64 overflow-auto border rounded-xl p-3 text-sm">
                {filteredFeatures.length === 0 && (<p className="text-gray-500">No feature nodes yet (upload file)</p>)}
                <ul className="space-y-1">
                  {filteredFeatures.map(id => (
                    <li key={id} className="flex items-start gap-2">
                      <input type="checkbox" checked={selected.has(id)} onChange={() => toggle(id)} className="mt-1" />
                      <span className="break-all">{id}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <p className="text-xs text-gray-600 mt-2">Features: {featureIds.length} · Chunks: {chunkCount}</p>
            </div>

            <div className="rounded-2xl border bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-medium">Results</h2>
                <div className="flex items-center gap-2">
                  <button onClick={copyToClipboard} disabled={results.length === 0} className="px-2.5 py-1.5 rounded-xl border text-sm disabled:opacity-50">Copy</button>
                  <button onClick={downloadCSV} disabled={results.length === 0} className="px-2.5 py-1.5 rounded-xl border text-sm disabled:opacity-50">Download CSV</button>
                </div>
              </div>
              <p className="text-xs text-gray-600 mt-1">{results.length} chunks</p>
              <textarea readOnly value={results.join("\n")} className="mt-2 w-full h-60 rounded-xl border p-3 text-xs font-mono" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
