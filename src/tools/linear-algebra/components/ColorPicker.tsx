import React, { useState, useRef, useEffect } from 'react';
import { COLOR_PALETTE_BASIC, COLOR_PALETTE_EXTENDED, COLOR_PALETTE_PASTEL } from '../lib/colors';
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface ColorPickerProps {
  currentColor: string;
  onChange: (color: string) => void;
  className?: string;
}

// Helper function to convert hex to RGB
const hexToRgb = (hex: string): { r: number; g: number; b: number } | null => {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16),
      }
    : null;
};

// Helper function to convert RGB to hex
const rgbToHex = (r: number, g: number, b: number): string => {
  return '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
};

// Convert RGB to HSV
const rgbToHsv = (r: number, g: number, b: number): { h: number; s: number; v: number } => {
  r /= 255;
  g /= 255;
  b /= 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  
  let h = 0;
  const s = max === 0 ? 0 : d / max;
  const v = max;

  if (max !== min) {
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      case b:
        h = (r - g) / d + 4;
        break;
    }
    h /= 6;
  }

  return { h: h * 360, s: s * 100, v: v * 100 };
};

// Convert HSV to RGB
const hsvToRgb = (h: number, s: number, v: number): { r: number; g: number; b: number } => {
  h /= 360;
  s /= 100;
  v /= 100;

  let r = 0, g = 0, b = 0;

  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);

  switch (i % 6) {
    case 0:
      r = v; g = t; b = p;
      break;
    case 1:
      r = q; g = v; b = p;
      break;
    case 2:
      r = p; g = v; b = t;
      break;
    case 3:
      r = p; g = q; b = v;
      break;
    case 4:
      r = t; g = p; b = v;
      break;
    case 5:
      r = v; g = p; b = q;
      break;
  }

  return {
    r: Math.round(r * 255),
    g: Math.round(g * 255),
    b: Math.round(b * 255)
  };
};

const ColorPicker = ({ currentColor, onChange, className = '' }: ColorPickerProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [colorMode, setColorMode] = useState<'rgb' | 'hsv'>('rgb'); // Default to RGB mode
  
  // RGB values for advanced picker
  const [red, setRed] = useState(0);
  const [green, setGreen] = useState(0);
  const [blue, setBlue] = useState(0);
  
  // HSV values
  const [hue, setHue] = useState(0);
  const [saturation, setSaturation] = useState(0);
  const [value, setValue] = useState(0);
  
  const [hexValue, setHexValue] = useState('#000000');

  // Canvas refs for color pickers
  const colorGradientRef = useRef<HTMLCanvasElement>(null);
  const grayscaleRef = useRef<HTMLCanvasElement>(null);
  
  // Group our color palettes
  const colorPalettes = [
    COLOR_PALETTE_BASIC,
    COLOR_PALETTE_EXTENDED,
    COLOR_PALETTE_PASTEL
  ];
  
  // Handle color selection from palette
  const handleColorSelect = (color: string) => {
    onChange(color);
    setIsOpen(false);
  };
  
  // Update RGB values when current color changes
  useEffect(() => {
    const rgb = hexToRgb(currentColor);
    if (rgb) {
      setRed(rgb.r);
      setGreen(rgb.g);
      setBlue(rgb.b);
      
      // Also update HSV
      const hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
      setHue(hsv.h);
      setSaturation(hsv.s);
      setValue(hsv.v);
      
      setHexValue(currentColor);
    }
  }, [currentColor]);
  
  // Update RGB and hex when HSV changes
  useEffect(() => {
    if (colorMode === 'hsv') {
      const rgb = hsvToRgb(hue, saturation, value);
      setRed(rgb.r);
      setGreen(rgb.g);
      setBlue(rgb.b);
      
      const newHexValue = rgbToHex(rgb.r, rgb.g, rgb.b);
      setHexValue(newHexValue);
    }
  }, [colorMode, hue, saturation, value]);
  
  // Update HSV and hex when RGB changes
  useEffect(() => {
    if (colorMode === 'rgb') {
      const hsv = rgbToHsv(red, green, blue);
      setHue(hsv.h);
      setSaturation(hsv.s);
      setValue(hsv.v);
      
      const newHexValue = rgbToHex(red, green, blue);
      setHexValue(newHexValue);
    }
  }, [colorMode, red, green, blue]);
  
  // Handle changes to RGB inputs
  const handleRgbChange = (component: 'r' | 'g' | 'b', value: number) => {
    // Clamp value between 0 and 255
    const clampedValue = Math.max(0, Math.min(255, value));
    
    if (component === 'r') setRed(clampedValue);
    if (component === 'g') setGreen(clampedValue);
    if (component === 'b') setBlue(clampedValue);
    
    // If in RGB mode, this will trigger the useEffect to update HSV
    if (colorMode === 'rgb') {
      const newHexValue = rgbToHex(
        component === 'r' ? clampedValue : red,
        component === 'g' ? clampedValue : green,
        component === 'b' ? clampedValue : blue
      );
      setHexValue(newHexValue);
    }
  };
  
  // Handle changes to HSV inputs
  const handleHsvChange = (component: 'h' | 's' | 'v', newValue: number) => {
    // Clamp values to appropriate ranges
    let clampedValue = newValue;
    if (component === 'h') clampedValue = Math.max(0, Math.min(360, newValue));
    if (component === 's' || component === 'v') clampedValue = Math.max(0, Math.min(100, newValue));
    
    if (component === 'h') setHue(clampedValue);
    if (component === 's') setSaturation(clampedValue);
    if (component === 'v') setValue(clampedValue);
  };

  // Handle changes to hex input
  const handleHexChange = (value: string) => {
    // Ensure it starts with a hash
    if (!value.startsWith('#')) {
      value = '#' + value;
    }
    
    // Validate the hex color
    const isValidHex = /^#[0-9A-F]{6}$/i.test(value);
    
    if (isValidHex) {
      setHexValue(value);
      const rgb = hexToRgb(value);
      if (rgb) {
        setRed(rgb.r);
        setGreen(rgb.g);
        setBlue(rgb.b);
        
        // Also update HSV
        const hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
        setHue(hsv.h);
        setSaturation(hsv.s);
        setValue(hsv.v);
      }
    } else {
      // Just update the displayed value for now
      setHexValue(value);
    }
  };

  // Apply the selected color from the advanced picker
  const applyAdvancedColor = () => {
    const newColor = rgbToHex(red, green, blue);
    onChange(newColor);
    setShowAdvanced(false);
    setIsOpen(false);
  };
  
  // Draw the color gradient canvas when component mounts or shows
  useEffect(() => {
    if (!showAdvanced) return;
    
    setTimeout(() => {
      // Draw color gradient
      if (colorGradientRef.current) {
        console.log("Drawing color gradient...");
        const canvas = colorGradientRef.current;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        
        if (ctx) {
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          
          if (colorMode === 'hsv') {
            // For HSV mode, draw a hue-saturation grid with current value
            for (let x = 0; x < canvas.width; x++) {
              for (let y = 0; y < canvas.height; y++) {
                const s = x / canvas.width * 100;
                const v = 100 - (y / canvas.height * 100);
                const rgb = hsvToRgb(hue, s, v);
                
                ctx.fillStyle = `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;
                ctx.fillRect(x, y, 1, 1);
              }
            }
          } else {
            // For RGB mode
            // Create rainbow gradient horizontally
            const horizontalGradient = ctx.createLinearGradient(0, 0, canvas.width, 0);
            horizontalGradient.addColorStop(0, '#FF0000'); // Red
            horizontalGradient.addColorStop(0.17, '#FFFF00'); // Yellow
            horizontalGradient.addColorStop(0.33, '#00FF00'); // Green
            horizontalGradient.addColorStop(0.5, '#00FFFF'); // Cyan
            horizontalGradient.addColorStop(0.67, '#0000FF'); // Blue
            horizontalGradient.addColorStop(0.83, '#FF00FF'); // Magenta
            horizontalGradient.addColorStop(1, '#FF0000'); // Back to Red
            
            ctx.fillStyle = horizontalGradient;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            
            // Create white to black gradient vertically
            const verticalGradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
            verticalGradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
            verticalGradient.addColorStop(0.5, 'rgba(255, 255, 255, 0)');
            verticalGradient.addColorStop(0.5, 'rgba(0, 0, 0, 0)');
            verticalGradient.addColorStop(1, 'rgba(0, 0, 0, 1)');
            
            ctx.globalCompositeOperation = 'multiply';
            ctx.fillStyle = verticalGradient;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.globalCompositeOperation = 'source-over';
          }
        }
      }
      
      // Draw grayscale or hue gradient depending on mode
      if (grayscaleRef.current) {
        console.log("Drawing grayscale/hue gradient...");
        const canvas = grayscaleRef.current;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        
        if (ctx) {
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          
          if (colorMode === 'hsv') {
            // Draw hue gradient
            for (let y = 0; y < canvas.height; y++) {
              const h = (canvas.height - y) / canvas.height * 360;
              const rgb = hsvToRgb(h, 100, 100);
              
              ctx.fillStyle = `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;
              ctx.fillRect(0, y, canvas.width, 1);
            }
          } else {
            // Draw grayscale gradient
            const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
            gradient.addColorStop(0, 'rgb(255, 255, 255)'); // White
            gradient.addColorStop(1, 'rgb(0, 0, 0)'); // Black
            
            ctx.fillStyle = gradient;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
          }
        }
      }
    }, 50); // Small delay to ensure canvas is ready
  }, [showAdvanced, colorMode, hue]);
  
  // Handle click on color gradient
  const handleGradientClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (colorGradientRef.current) {
      const canvas = colorGradientRef.current;
      const rect = canvas.getBoundingClientRect();
      const x = Math.max(0, Math.min(canvas.width, e.clientX - rect.left));
      const y = Math.max(0, Math.min(canvas.height, e.clientY - rect.top));
      
      if (colorMode === 'hsv') {
        // In HSV mode, x = saturation, y = value
        const newS = (x / canvas.width) * 100;
        const newV = 100 - (y / canvas.height) * 100;
        
        setSaturation(newS);
        setValue(newV);
        console.log("HSV gradient picked:", hue, newS, newV);
      } else {
        // In RGB mode, get color from canvas
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (ctx) {
          const imageData = ctx.getImageData(x, y, 1, 1).data;
          console.log("RGB gradient picked:", imageData[0], imageData[1], imageData[2]);
          setRed(imageData[0]);
          setGreen(imageData[1]);
          setBlue(imageData[2]);
        }
      }
    }
  };
  
  // Handle click on grayscale/hue gradient
  const handleGrayscaleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (grayscaleRef.current) {
      const canvas = grayscaleRef.current;
      const rect = canvas.getBoundingClientRect();
      const y = Math.max(0, Math.min(canvas.height, e.clientY - rect.top));
      
      if (colorMode === 'hsv') {
        // In HSV mode, this is the hue picker
        const newHue = (canvas.height - y) / canvas.height * 360;
        setHue(newHue);
        console.log("Hue picked:", newHue);
      } else {
        // In RGB mode, this is the grayscale picker
        const value = Math.round((canvas.height - y) / canvas.height * 255);
        console.log("Grayscale picked:", value);
        setRed(value);
        setGreen(value);
        setBlue(value);
      }
    }
  };
  
  // Trigger ref for the color swatch
  const triggerRef = useRef<HTMLDivElement>(null);
  
  return (
    <>
      <Popover open={isOpen} onOpenChange={setIsOpen}>
        <PopoverTrigger asChild>
          <div 
            ref={triggerRef}
            className={`w-6 h-6 rounded-full cursor-pointer border border-gray-300 transition-all hover:scale-110 ${className}`} 
            style={{ backgroundColor: currentColor }}
            onClick={() => setIsOpen(true)}
            aria-label="Select color"
          />
        </PopoverTrigger>
        <PopoverContent className="w-auto p-2 bg-white shadow-lg rounded-lg">
          <div className="flex flex-col gap-1">
            {colorPalettes.map((palette, paletteIndex) => (
              <div key={paletteIndex} className="flex flex-wrap gap-1 justify-center mb-1">
                {palette.map((color, colorIndex) => (
                  <div
                    key={`${paletteIndex}-${colorIndex}-${color}`}
                    className={`w-6 h-6 rounded-full cursor-pointer transition-transform hover:scale-125 ${
                      currentColor === color ? 'ring-2 ring-black ring-offset-1' : ''
                    }`}
                    style={{ backgroundColor: color }}
                    onClick={() => handleColorSelect(color)}
                    aria-label={color}
                  />
                ))}
              </div>
            ))}
            
            {/* Custom color selector with advanced colors button */}
            <div className="flex justify-end mt-1">
              <div 
                className="flex items-center justify-center w-6 h-6 rounded-full border border-gray-300 cursor-pointer"
                aria-label="More colors"
                onClick={() => setShowAdvanced(true)}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  className="w-4 h-4"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                </svg>
              </div>
            </div>
          </div>
        </PopoverContent>
      </Popover>
      
      {/* Advanced Color Picker Dialog */}
      <Dialog open={showAdvanced} onOpenChange={setShowAdvanced}>
        <DialogContent className="sm:max-w-[540px] max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Advanced Color Picker</DialogTitle>
            <DialogDescription>
              Select a custom color using the color picker, sliders, or hex input.
            </DialogDescription>
          </DialogHeader>
          
          <div className="flex flex-col lg:flex-row gap-4">
            <div className="w-full lg:w-1/2">
              <div className="mb-2 flex justify-between items-center">
                <Label>Color Mode:</Label>
                <Select value={colorMode} onValueChange={(value) => setColorMode(value as 'rgb' | 'hsv')}>
                  <SelectTrigger className="w-32">
                    <SelectValue placeholder="Color Mode" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="rgb">RGB</SelectItem>
                    <SelectItem value="hsv">HSV</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              
              {/* Color gradient and controls in first column */}
              <div className="flex gap-2 mb-4">
                <canvas 
                  ref={colorGradientRef} 
                  width={200} 
                  height={240} 
                  onClick={handleGradientClick}
                  className="cursor-crosshair border border-gray-300 rounded-md"
                />
                <canvas 
                  ref={grayscaleRef} 
                  width={30} 
                  height={240} 
                  onClick={handleGrayscaleClick}
                  className="cursor-pointer border border-gray-300 rounded-md"
                />
              </div>
            </div>
            
            {/* Color controls in second column */}
            <div className="w-full lg:w-1/2 flex flex-col gap-3">
              {/* Preview box and hex input */}
              <div className="flex items-center gap-2 mb-3">
                <div 
                  className="w-16 h-16 rounded-md border border-gray-300"
                  style={{ backgroundColor: hexValue }}
                />
                <div className="flex flex-col gap-1">
                  <Label htmlFor="hex-color">Hex Color</Label>
                  <Input 
                    id="hex-color"
                    type="text" 
                    value={hexValue} 
                    onChange={(e) => handleHexChange(e.target.value)}
                    className="w-32"
                  />
                </div>
              </div>
              
              {/* RGB or HSV sliders */}
              <div className="space-y-2">
                {colorMode === 'rgb' ? (
                  // RGB sliders
                  <>
                    <div className="grid grid-cols-[1fr_60px] items-center gap-2">
                      <div>
                        <Label htmlFor="red">Red</Label>
                        <Input 
                          id="red"
                          type="range" 
                          min="0" 
                          max="255" 
                          value={red}
                          onChange={(e) => handleRgbChange('r', parseInt(e.target.value))}
                        />
                      </div>
                      <Input 
                        type="number" 
                        min="0" 
                        max="255" 
                        value={red}
                        onChange={(e) => handleRgbChange('r', parseInt(e.target.value))}
                      />
                    </div>
                    <div className="grid grid-cols-[1fr_60px] items-center gap-2">
                      <div>
                        <Label htmlFor="green">Green</Label>
                        <Input 
                          id="green"
                          type="range" 
                          min="0" 
                          max="255" 
                          value={green}
                          onChange={(e) => handleRgbChange('g', parseInt(e.target.value))}
                        />
                      </div>
                      <Input 
                        type="number" 
                        min="0" 
                        max="255" 
                        value={green}
                        onChange={(e) => handleRgbChange('g', parseInt(e.target.value))}
                      />
                    </div>
                    <div className="grid grid-cols-[1fr_60px] items-center gap-2">
                      <div>
                        <Label htmlFor="blue">Blue</Label>
                        <Input 
                          id="blue"
                          type="range" 
                          min="0" 
                          max="255" 
                          value={blue}
                          onChange={(e) => handleRgbChange('b', parseInt(e.target.value))}
                        />
                      </div>
                      <Input 
                        type="number" 
                        min="0" 
                        max="255" 
                        value={blue}
                        onChange={(e) => handleRgbChange('b', parseInt(e.target.value))}
                      />
                    </div>
                  </>
                ) : (
                  // HSV sliders
                  <>
                    <div className="grid grid-cols-[1fr_60px] items-center gap-2">
                      <div>
                        <Label htmlFor="hue">Hue</Label>
                        <Input 
                          id="hue"
                          type="range" 
                          min="0" 
                          max="360" 
                          value={hue}
                          onChange={(e) => handleHsvChange('h', parseInt(e.target.value))}
                        />
                      </div>
                      <Input 
                        type="number" 
                        min="0" 
                        max="360" 
                        value={Math.round(hue)}
                        onChange={(e) => handleHsvChange('h', parseInt(e.target.value))}
                      />
                    </div>
                    <div className="grid grid-cols-[1fr_60px] items-center gap-2">
                      <div>
                        <Label htmlFor="saturation">Saturation</Label>
                        <Input 
                          id="saturation"
                          type="range" 
                          min="0" 
                          max="100" 
                          value={saturation}
                          onChange={(e) => handleHsvChange('s', parseInt(e.target.value))}
                        />
                      </div>
                      <Input 
                        type="number" 
                        min="0" 
                        max="100" 
                        value={Math.round(saturation)}
                        onChange={(e) => handleHsvChange('s', parseInt(e.target.value))}
                      />
                    </div>
                    <div className="grid grid-cols-[1fr_60px] items-center gap-2">
                      <div>
                        <Label htmlFor="value">Value</Label>
                        <Input 
                          id="value"
                          type="range" 
                          min="0" 
                          max="100" 
                          value={value}
                          onChange={(e) => handleHsvChange('v', parseInt(e.target.value))}
                        />
                      </div>
                      <Input 
                        type="number" 
                        min="0" 
                        max="100" 
                        value={Math.round(value)}
                        onChange={(e) => handleHsvChange('v', parseInt(e.target.value))}
                      />
                    </div>
                  </>
                )}
              </div>
              
              {/* Apply button */}
              <button
                onClick={applyAdvancedColor}
                className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 mt-4"
              >
                Apply Color
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default ColorPicker;