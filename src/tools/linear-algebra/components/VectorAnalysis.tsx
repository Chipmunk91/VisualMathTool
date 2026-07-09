import React, { useMemo } from "react";
import { useVectorStore, Vector } from "../lib/stores/useVectorStore";
import { 
  calculateMagnitude, 
  dotProduct, 
  crossProduct, 
  vectorDistance,
  angleBetweenVectors
} from "../lib/math";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const VectorAnalysis = () => {
  // Get all vectors from the store with a single subscription
  const allVectors = useVectorStore(state => state.vectors);
  
  // Memoize the filtered vectors to prevent infinite re-renders
  const vectors = useMemo(() => 
    allVectors.filter(v => !v.isTransformed), 
    [allVectors]
  );

  const transformedVectors = useMemo(() => 
    allVectors.filter(v => v.isTransformed),
    [allVectors]
  );

  // Memoize the transformation map to prevent recreating it every render
  const transformationMap = useMemo(() => {
    const map = new Map<string, Vector[]>();
    transformedVectors.forEach(tv => {
      if (tv.originalId) {
        if (!map.has(tv.originalId)) {
          map.set(tv.originalId, []);
        }
        map.get(tv.originalId)?.push(tv);
      }
    });
    return map;
  }, [transformedVectors]);

  // Check if we have at least one vector
  if (vectors.length === 0) {
    return (
      <Card className="mb-4">
        <CardHeader className="pb-2">
          <CardTitle className="text-lg">Vector Analysis</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-center text-muted-foreground">
            Add vectors to see analysis here
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="mb-4 overflow-auto">
      <CardHeader className="pb-2">
        <CardTitle className="text-lg">Vector Analysis</CardTitle>
      </CardHeader>
      <CardContent className="overflow-y-auto">
        {/* Individual Vector Analysis */}
        <div className="space-y-4">
          {vectors.map(vector => {
            const magnitude = calculateMagnitude(vector.components);
            const transformedVector = transformationMap.get(vector.id)?.[0];
            
            return (
              <div key={vector.id} className="border border-border rounded-md p-3">
                <div className="flex items-center gap-2 mb-2">
                  <div 
                    className="w-3 h-3 rounded-full" 
                    style={{ backgroundColor: vector.color }}
                  />
                  <h3 className="font-medium">{vector.label}</h3>
                </div>
                
                <div className="grid sm:grid-cols-2 gap-2 text-sm">
                  <div className="bg-muted p-2 rounded-md">
                    <p className="font-medium">Magnitude:</p>
                    <p>{magnitude.toFixed(4)}</p>
                  </div>
                  
                  <div className="bg-muted p-2 rounded-md">
                    <p className="font-medium">Components:</p>
                    <p className="break-all">[{vector.components.map(c => c.toFixed(2)).join(", ")}]</p>
                  </div>
                  
                  {transformedVector && (
                    <>
                      <div className="bg-muted p-2 rounded-md">
                        <p className="font-medium">Transformed:</p>
                        <p className="break-all">[{transformedVector.components.map(c => c.toFixed(2)).join(", ")}]</p>
                      </div>
                      
                      <div className="bg-muted p-2 rounded-md">
                        <p className="font-medium">Transformation Magnitude:</p>
                        <p>{calculateMagnitude(transformedVector.components).toFixed(4)}</p>
                      </div>
                      
                      <div className="bg-muted p-2 rounded-md">
                        <p className="font-medium">Distance from Original:</p>
                        <p>
                          {vectorDistance(vector.components, transformedVector.components)?.toFixed(4) || "N/A"}
                        </p>
                      </div>
                      
                      <div className="bg-muted p-2 rounded-md">
                        <p className="font-medium">Angle with Original:</p>
                        <p>
                          {(() => {
                            const angle = angleBetweenVectors(vector.components, transformedVector.components);
                            if (angle === null) return "N/A";
                            // Convert radians to degrees and format
                            return `${(angle * (180 / Math.PI)).toFixed(2)}°`;
                          })()}
                        </p>
                      </div>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        
        {/* Vector Pair Analysis */}
        {vectors.length >= 2 && (
          <div className="mt-6">
            <h3 className="font-medium mb-2">Vector Relationships</h3>
            <div className="space-y-2">
              {vectors.flatMap((v1, i) => 
                vectors.slice(i + 1).map(v2 => {
                  const dot = dotProduct(v1.components, v2.components);
                  const cross = v1.components.length === 3 && v2.components.length === 3 
                    ? crossProduct(v1.components, v2.components) 
                    : null;
                  const angle = angleBetweenVectors(v1.components, v2.components);
                  const distance = vectorDistance(v1.components, v2.components);
                  
                  return (
                    <div key={`${v1.id}-${v2.id}`} className="border border-border rounded-md p-3">
                      <div className="flex flex-wrap justify-between items-center mb-2 gap-2">
                        <div className="flex items-center gap-2">
                          <div 
                            className="w-3 h-3 rounded-full" 
                            style={{ backgroundColor: v1.color }}
                          />
                          <span>{v1.label}</span>
                        </div>
                        <span className="text-sm">and</span>
                        <div className="flex items-center gap-2">
                          <div 
                            className="w-3 h-3 rounded-full" 
                            style={{ backgroundColor: v2.color }}
                          />
                          <span>{v2.label}</span>
                        </div>
                      </div>
                      
                      <div className="grid sm:grid-cols-2 gap-2 text-sm">
                        <div className="bg-muted p-2 rounded-md">
                          <p className="font-medium">Dot Product:</p>
                          <p>{dot?.toFixed(4) || "N/A"}</p>
                        </div>
                        
                        <div className="bg-muted p-2 rounded-md">
                          <p className="font-medium">Angle (degrees):</p>
                          <p>{angle ? (angle * (180 / Math.PI)).toFixed(2) + "°" : "N/A"}</p>
                        </div>
                        
                        <div className="bg-muted p-2 rounded-md">
                          <p className="font-medium">Distance:</p>
                          <p>{distance?.toFixed(4) || "N/A"}</p>
                        </div>
                        
                        {cross && (
                          <div className="bg-muted p-2 rounded-md">
                            <p className="font-medium">Cross Product:</p>
                            <p className="break-all">[{cross.map(c => c.toFixed(2)).join(", ")}]</p>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default VectorAnalysis;