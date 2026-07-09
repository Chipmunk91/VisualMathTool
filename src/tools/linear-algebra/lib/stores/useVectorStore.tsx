import { create } from "zustand";
import { getRandomColor } from "../colors";
import { useMatrixStore } from "./useMatrixStore";

export interface Vector {
  id: string;
  components: number[];
  // Optional original expressions entered by user
  componentExpressions?: string[];
  color: string;
  label: string;
  visible: boolean;
  // For showing original and transformed vectors
  isTransformed: boolean;
  originalId?: string;
  // For controlling transparency
  opacity?: number;
}

interface VectorStore {
  vectors: Vector[];
  addVector: (components: number[], expressions?: string[]) => void;
  removeVector: (id: string) => void;
  updateVector: (id: string, components: number[], expression?: string, index?: number) => void;
  updateVectorLabel: (id: string, label: string) => void;
  updateVectorColor: (id: string, color: string) => void;
  toggleVectorVisibility: (id: string) => void;
  setTransformedVectors: (originalVectors: Vector[], transformedVectors: (Vector | null)[]) => void;
  clearTransformedVectors: () => void;
}

export const useVectorStore = create<VectorStore>((set) => ({
  vectors: [],
  
  addVector: (components, expressions) => {
    const id = `vector-${Date.now()}`;
    
    // Get current vector numbers from existing vector names (v1, v2, etc.)
    const getCurrentVectorNumbers = (vectors: Vector[]) => {
      const usedNumbers = new Set<number>();
      vectors.forEach(v => {
        if (v.isTransformed) return; // Skip transformed vectors
        
        // Extract number from vector label (v1, v2, etc.)
        const match = v.label.match(/^v(\d+)$/);
        if (match) {
          const num = parseInt(match[1], 10);
          if (!isNaN(num)) {
            usedNumbers.add(num);
          }
        }
      });
      return usedNumbers;
    };
    
    // Find the next available vector number
    const getNextVectorNumber = (usedNumbers: Set<number>) => {
      let nextNum = 1;
      while (usedNumbers.has(nextNum)) {
        nextNum++;
      }
      return nextNum;
    };
    
    // Get the current state to access vectors
    const currentVectors = useVectorStore.getState().vectors;
    const usedNumbers = getCurrentVectorNumbers(currentVectors);
    const nextNumber = getNextVectorNumber(usedNumbers);
    
    // Get colors of existing vectors
    const existingColors = currentVectors
      .filter(v => !v.isTransformed)
      .map(v => v.color);
    
    // Create the new vector with sequential naming and a unique color
    const newVector: Vector = {
      id,
      components,
      componentExpressions: expressions, // Store original expressions if provided
      color: getRandomColor(existingColors),
      label: `v${nextNumber}`,
      visible: true,
      isTransformed: false,
    };
    
    console.log("Adding new vector to store:", newVector);
    
    set((state) => ({
      vectors: [...state.vectors, newVector]
    }));
    
    console.log("Vector added, store now has vectors:", useVectorStore.getState().vectors);
  },
  
  removeVector: (id) => {
    set((state) => ({
      vectors: state.vectors.filter((v) => v.id !== id && v.originalId !== id)
    }));
  },
  
  updateVector: (id, components, expression, index) => {
    set((state) => ({
      vectors: state.vectors.map((v) => {
        if (v.id === id) {
          // If we're updating a specific component's expression
          if (expression !== undefined && index !== undefined) {
            // Initialize expressions array if it doesn't exist
            const componentExpressions = v.componentExpressions ? 
              [...v.componentExpressions] : 
              [...v.components.map(c => c.toString())];
            
            // Update the expression at the specified index
            componentExpressions[index] = expression;
            
            return { 
              ...v, 
              components, 
              componentExpressions
            };
          }
          // Otherwise just update the component values
          return { ...v, components };
        }
        return v;
      })
    }));
  },
  
  updateVectorLabel: (id, label) => {
    set((state) => {
      const updatedVectors = state.vectors.map((v) => {
        // Update original vector label
        if (v.id === id) {
          return { ...v, label };
        }
        // Update transformed vector label - append "- T" suffix
        if (v.originalId === id) {
          return { ...v, label: `${label} - T` };
        }
        return v;
      });
      return { vectors: updatedVectors };
    });
  },
  
  updateVectorColor: (id, color) => {
    set((state) => {
      const updatedVectors = state.vectors.map((v) => {
        // Update original vector color
        if (v.id === id) {
          return { ...v, color };
        }
        // Also update transformed vector color
        if (v.originalId === id) {
          return { ...v, color };
        }
        return v;
      });
      return { vectors: updatedVectors };
    });
  },
  
  toggleVectorVisibility: (id) => {
    set((state) => {
      // Find the target vector
      const targetVector = state.vectors.find(v => v.id === id);
      if (!targetVector) return { vectors: state.vectors };
      
      // Get the new visibility state (toggled)
      const newVisibility = !targetVector.visible;
      
      // Return updated vectors array
      return {
        vectors: state.vectors.map((v) => {
          // Handle original vector
          if (v.id === id) {
            return { ...v, visible: newVisibility };
          }
          
          // Handle transformed vectors (if we're toggling an original vector)
          if (!targetVector.isTransformed && v.originalId === id) {
            return { ...v, visible: newVisibility };
          }
          
          // Handle original vectors (if we're toggling a transformed vector)
          if (targetVector.isTransformed && targetVector.originalId === v.id) {
            return { ...v, visible: newVisibility };
          }
          
          // Handle other transformed vectors of the same original (if toggling a transformed vector)
          if (targetVector.isTransformed && v.isTransformed && v.originalId === targetVector.originalId) {
            return { ...v, visible: newVisibility };
          }
          
          // Don't change other vectors
          return v;
        })
      };
    });
  },
  
  setTransformedVectors: (originalVectors, transformedVectors) => {
    // Add debug logs
    console.log("Setting transformed vectors:", transformedVectors.length);
    
    // Filter out null values which represent incompatible transformations
    const validTransformedVectors = transformedVectors.filter(v => v !== null);
    
    // Check for incompatible vectors
    if (transformedVectors.length > validTransformedVectors.length) {
      const numInvalid = transformedVectors.length - validTransformedVectors.length;
      console.log(`${numInvalid} vector(s) cannot be transformed with the current matrix dimensions.`);
      
      // Get matrix dimension for detailed reporting
      const { matrix } = useMatrixStore.getState();
      const [rows, cols] = matrix.dimension.split('x').map(Number);
      
      // Compare with original vectors to find which ones are incompatible
      // Extract originalIds from validTransformedVectors
      const validOriginalIds = validTransformedVectors
        .map(v => v.originalId)
        .filter(id => id !== undefined);
        
      // Find vectors that didn't get transformed successfully
      originalVectors.forEach(v => {
        if (!validOriginalIds.includes(v.id)) {
          console.log(`- Vector "${v.label}" (${v.components.length}D) is incompatible with the current ${matrix.dimension} matrix. A ${matrix.dimension} matrix requires vectors with ${cols} components.`);
        }
      });
    }
    
    set((state) => {
      try {
        // First, remove all existing transformed vectors
        const nonTransformedVectors = state.vectors.filter(v => !v.isTransformed);
        
        // Create a map of originalId to visibility for faster lookup
        const originalVisibilityMap = new Map();
        nonTransformedVectors.forEach(v => {
          originalVisibilityMap.set(v.id, v.visible);
        });
        
        // Sync visibility for each transformed vector
        const syncedTransformedVectors = validTransformedVectors.map(transformed => {
          // Get visibility from map with default true
          const visibility = transformed.originalId ? 
            (originalVisibilityMap.get(transformed.originalId) ?? true) : 
            true;
          
          // Return transformed vector with matched visibility
          return {
            ...transformed,
            visible: visibility
          };
        });
        
        // Return updated state
        const newState = {
          vectors: [...nonTransformedVectors, ...syncedTransformedVectors]
        };
        
        // Double check for duplicates
        const uniqueIds = new Set();
        const hasDuplicates = newState.vectors.some(v => {
          if (uniqueIds.has(v.id)) return true;
          uniqueIds.add(v.id);
          return false;
        });
        
        // If duplicates found, log warning and filter them out
        if (hasDuplicates) {
          console.warn("Duplicate vector IDs detected - filtering duplicates");
          
          // Keep only the first occurrence of each vector ID
          const uniqueVectors: any[] = [];
          const seenIds = new Set();
          
          newState.vectors.forEach(v => {
            if (!seenIds.has(v.id)) {
              uniqueVectors.push(v);
              seenIds.add(v.id);
            }
          });
          
          return { vectors: uniqueVectors };
        }
        
        return newState;
      } catch (error) {
        console.error("Error in setTransformedVectors:", error);
        // Return unchanged state on error
        return state;
      }
    });
  },
  
  clearTransformedVectors: () => {
    console.log("Clearing transformed vectors");
    
    // Use state directly with the set function
    set(state => {
      // Check if there are any transformed vectors to clear
      const hasTransformedVectors = state.vectors.some(v => v.isTransformed);
      
      // Only update state if there are transformed vectors to clear
      if (hasTransformedVectors) {
        const originalVectors = state.vectors.filter(v => !v.isTransformed);
        return { vectors: originalVectors };
      } 
      
      console.log("No transformed vectors to clear, skipping update");
      return state; // Return unchanged state
    });
  }
}));
