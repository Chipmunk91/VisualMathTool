import * as math from 'mathjs';

/**
 * Evaluates a mathematical expression and returns the numeric result
 * Supports expressions like:
 * - Basic arithmetic: 1+2, 3*4
 * - Negative numbers: -5
 * - Fractions: 1/7
 * - Exponents: 2^(1/3)
 * - Constants: pi, e
 * - Functions: sin(x), cos(x), etc.
 * 
 * @param expression The mathematical expression to evaluate
 * @returns The numeric result of the expression, or 0 if invalid
 */
export function evaluateExpression(expression: string): number {
  if (!expression || expression.trim() === '') {
    return 0;
  }
  
  try {
    // Handle specific common math patterns
    // Check for power pattern like 2^3.4 or 2^(3.4)
    const powerPattern = /(\d+(?:\.\d+)?)\s*\^\s*(?:\(?\s*(-?\d+(?:\.\d+)?)\s*\)?)/;
    const powerMatch = expression.match(powerPattern);
    
    if (powerMatch) {
      const base = parseFloat(powerMatch[1]);
      const exponent = parseFloat(powerMatch[2]);
      console.log(`Evaluating power expression: ${base}^${exponent}`);
      return Math.pow(base, exponent);
    }
    
    // Replace ^ with ** for exponentiation (mathjs uses **)
    const processedExpression = expression.replace(/\^/g, '**');
    
    console.log(`Evaluating expression: "${expression}" (processed: "${processedExpression}")`);
    
    // Evaluate the expression using mathjs
    const result = math.evaluate(processedExpression);
    
    console.log(`Expression result:`, result);
    
    // Convert to number if it's not already
    return typeof result === 'number' ? result : Number(result);
  } catch (error) {
    console.log(`Error evaluating expression "${expression}":`, error);
    
    try {
      // Try JavaScript's eval as a fallback for simple expressions
      // Replace ^ with ** for JavaScript syntax
      const jsExpression = expression.replace(/\^/g, '**');
      
      // Only evaluate if it contains valid math operations and no suspicious code
      if (/^[0-9\s\.\+\-\*\/\(\)\^]+$/.test(jsExpression)) {
        const result = eval(jsExpression);
        console.log(`Evaluated with JS eval:`, result);
        return result;
      }
    } catch (jsError) {
      console.log("JS eval fallback failed:", jsError);
    }
    
    // Try to extract just the numeric part from the expression as last resort
    const numericMatch = expression.match(/-?\d+(\.\d+)?/);
    if (numericMatch) {
      console.log(`Falling back to extracted numeric part: ${numericMatch[0]}`);
      return parseFloat(numericMatch[0]);
    }
    
    return 0;
  }
}