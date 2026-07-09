import { lazy, type ComponentType, type LazyExoticComponent } from "react";
import { Box, type LucideIcon } from "lucide-react";

export interface ToolDefinition {
  /** URL segment for the tool: /tools/<id> */
  id: string;
  name: string;
  description: string;
  /** Broad math area, used for grouping/filtering on the home page */
  category: string;
  icon: LucideIcon;
  component: LazyExoticComponent<ComponentType>;
}

/**
 * All tools available in the app. To add a new tool:
 *   1. Create a folder under src/tools/<your-tool>/ with an index.tsx default-exporting the tool component.
 *   2. Add an entry here. The route and home page card are generated from it.
 */
export const tools: ToolDefinition[] = [
  {
    id: "linear-algebra",
    name: "Matrix Meets Vector",
    description:
      "Interactive 3D linear algebra playground. Drag vectors, apply matrix transformations, and explore eigenvalues, SVD, and matrix properties in real time.",
    category: "Linear Algebra",
    icon: Box,
    component: lazy(() => import("./linear-algebra")),
  },
];

export function getTool(id: string): ToolDefinition | undefined {
  return tools.find((tool) => tool.id === id);
}
