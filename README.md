# InteractiveVis_NatGeo

React app for exploring the output of the `acoustic_knowledge_discovery` pipeline. Upload a graph JSON, select features, and quickly find the chunk IDs connected to them.

## Prerequisites
- Node 20+ and npm installed.
- A graph JSON exported from the `acoustic_knowledge_discovery` pipeline (see format below).

## How to Install
1) Clone: `git clone https://github.com/SiyaKamboj/InteractiveVis_NatGeo.git`
2) Install deps: `cd InteractiveVis_NatGeo/chunk-finder && npm install`
3) Run the dev server: `npm run dev`
4) Open the printed URL (usually http://localhost:5173/) in your browser.

## Using the app
1) Click **Upload graph JSON** and select your graph file.
2) Use the search box to filter feature nodes, then check the ones you care about.
3) Choose matching mode:
   - **ALL** — chunks connected to every selected feature.
   - **ANY** — chunks connected to at least one selected feature.
4) Click **Find chunks**.
5) Copy the results or download them as `chunks.csv`.

You can re-upload a new graph at any time; it resets the selection and results.

## Expected graph format
The app auto-detects which node group represents files vs chunks using ID prefixes. Your JSON should be an object with `nodes` and `links`:
```json
{
  "nodes": [
    { "id": "file_name_example.wav", "group": 0 },
    { "id": "chunk_id_123", "group": 3 },
    { "id": "some_feature", "group": 2 }
  ],
  "links": [
    { "source": "file_name_example.wav", "target": "chunk_id_123" },
    { "source": "some_feature", "target": "file_name_example.wav" }
  ]
}
```
- Files should have IDs like `file_name_...` or end with common audio extensions (`.wav`, `.mp3`, `.flac`, `.ogg`).
- Chunks should have IDs like `chunk_id_...`.
- Everything else is treated as a feature node.

<!-- ## Additional scripts
- `npm run build` — type-check and build for production.
- `npm run preview` — serve the production build locally.
- `npm run lint` — run ESLint. -->

## Troubleshooting
- If the worker never becomes ready, double-check your JSON is valid and matches the expected ID patterns above.
<!-- - If dependencies fail to install, ensure you are on Node 20+ and delete `node_modules` before reinstalling.  -->
