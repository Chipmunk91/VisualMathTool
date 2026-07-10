# Visual Math Tools 🧮✨

A collection of interactive math visualization tools that turn abstract concepts into engaging visual experiences, inspired by the educational philosophy of 3Blue1Brown.

**100% serverless** — a pure static site built with Vite + React. No backend, no database, nothing to deploy but static files.

## 🧰 Tools

### Matrix Meets Vector (`/tools/linear-algebra`)

Interactive 3D linear algebra visualization:

- **Interactive 3D Visualization**: Move vectors with a Unity/Blender-style translate gizmo — click a vector's tip to select it, then drag the axis handles
- **Animated Transformations**: Scrub or play the transformation from identity to your matrix and watch space morph continuously
- **The Grid Transforms**: For a non-identity matrix, the reference grid itself is replaced by its image under the transformation — space visibly shears, rotates, and squashes
- **Basis Vectors as Teachers**: î, ĵ, k̂ transform live, and the matrix table's column headers show that each column is exactly where a basis vector lands
- **Determinant Volume**: The unit cube carried through the transformation — volume = |det|, with an orientation-flip indicator for negative determinants
- **Eigenvector Axes**: Real eigenvectors drawn as axes in the scene — the directions that only stretch, never rotate
- **Preset Transformations**: One-click rotation, shear, reflection, projection, and scaling matrices
- **Real Eigendecomposition & SVD**: Computed with math.js `eigs` — including complex eigenvalues for rotations
- **Matrix Classification**: Automatic detection of special matrix types (diagonal, symmetric, orthogonal, ...)
- **Mathematical Expression Support**: Use fractions, powers, and expressions in inputs

### Equation Playground (`/tools/equation-builder`)

One large equation whose symbols are live objects — solve it by physically moving them:

- **Touchable Symbols**: Every term is an interactive object that highlights on hover
- **Drag Across the Equals Sign**: Move a term to the other side and its sign flips; like terms combine automatically
- **Divide to Finish**: When the equation reaches a·x = b, the coefficient becomes clickable — divide both sides to solve
- **Minimal by Design**: Just the equation on a clean page, with preset equations to practice on

More tools (calculus, probability, complex numbers, ...) coming soon.

## 🚀 Getting Started

### Test in the browser — no local setup needed

- **Live site (GitHub Pages)**: every push to `main` automatically builds and deploys via [`deploy.yml`](.github/workflows/deploy.yml). One-time setup: in the repo's **Settings → Pages**, set *Source* to **GitHub Actions**. The site then lives at `https://chipmunk91.github.io/VisualMathTool/`.
- **CI on every push**: [`ci.yml`](.github/workflows/ci.yml) type-checks and builds each commit, and uploads the built site as a downloadable artifact — a red ❌ / green ✓ on the commit tells you if the branch is healthy.
- **Instant dev sandbox**: open the repo in [StackBlitz](https://stackblitz.com/github/Chipmunk91/VisualMathTool) (runs the Vite dev server entirely in your browser) or a [GitHub Codespace](https://github.com/codespaces) — edit and hot-reload without installing anything.

### Local development (optional)

Requires Node.js v18+.

```bash
npm install
npm run dev        # start the dev server with hot reload
npm run build      # production build to dist/
npm run preview    # serve the production build locally
npm run check      # type-check with tsc
```

The production build in `dist/` is fully static and relocatable (relative base + hash routing), so it can be dropped onto any static host — GitHub Pages, Netlify, Vercel, S3, or a plain file server.

## 🏗️ Project Structure

```
index.html              # single entry page
public/                 # static assets (favicons)
src/
  main.tsx              # React entry point
  App.tsx               # router + shared tool shell (header, suspense)
  pages/                # top-level pages (Home, NotFound)
  components/ui/        # shared UI primitives (shadcn-style)
  lib/                  # shared utilities
  tools/
    registry.ts         # ← the tool registry: one entry per tool
    linear-algebra/     # Matrix Meets Vector
      index.tsx         # tool entry component
      components/       # tool-specific components (3D scene, inputs, analysis)
      lib/              # tool-specific math, parsing, colors, stores
```

## ➕ Adding a New Tool

1. Create `src/tools/<your-tool>/index.tsx` that default-exports a React component. The component is rendered inside a full-height shell (`h-full` container below a slim header) — everything else is up to you.
2. Register it in `src/tools/registry.ts`:

```ts
{
  id: "your-tool",              // route becomes /tools/your-tool
  name: "Your Tool",
  description: "What it does.",
  category: "Calculus",
  icon: TrendingUp,             // any lucide-react icon
  component: lazy(() => import("./your-tool")),
}
```

That's it — the route and the home page card are generated from the registry. Tools are lazy-loaded, so each one only downloads when opened.

Keep tool-specific code (components, stores, math helpers) inside the tool's own folder; promote something to `src/components/` or `src/lib/` only when a second tool needs it.

## 🛠️ Tech Stack

- **React 18** + **TypeScript** + **Vite**
- **Three.js** via @react-three/fiber and @react-three/drei (3D rendering)
- **Zustand** (state management)
- **mathjs** (math parsing and computation)
- **Tailwind CSS** + shadcn-style UI primitives
- **wouter** (tiny hash-based router)

## 🤝 Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). The easiest contribution: add a new tool (see above).

## 📄 License

MIT — see [LICENSE](LICENSE).
