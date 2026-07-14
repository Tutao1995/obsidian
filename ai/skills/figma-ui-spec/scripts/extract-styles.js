#!/usr/bin/env node

// Extract precise style data from Figma JSON file.
// Usage: node extract-styles.js <input.json> [output.md]
//
// The input JSON is the response from Figma REST API:
//   GET /v1/files/{key}/nodes?ids={nodeId}
//
// It auto-detects the root node from the JSON structure.
// No dependencies — pure Node.js.

'use strict';

const fs = require('fs');
const path = require('path');

const inputPath = process.argv[2];
const outputPath = process.argv[3] || path.join(path.dirname(inputPath || '.'), 'styles_extracted.md');

if (!inputPath) {
  console.error('Usage: node extract-styles.js <input.json> [output.md]');
  process.exit(1);
}

const raw = fs.readFileSync(inputPath, 'utf8').replace(/^\uFEFF/, '');
const json = JSON.parse(raw);

// Auto-detect root node: json.nodes.{firstKey}.document
let rootNode;
if (json.nodes) {
  const firstKey = Object.keys(json.nodes)[0];
  rootNode = json.nodes[firstKey].document;
} else if (json.document) {
  rootNode = json.document;
} else {
  rootNode = json;
}

const styles = {
  colors: {},     // hex -> [locations]
  fonts: [],
  borders: [],
  shadows: [],
  gradients: [],
  radii: [],
  dimensions: [],
};

function toHex(color) {
  if (!color) return null;
  const r = Math.round(color.r * 255);
  const g = Math.round(color.g * 255);
  const b = Math.round(color.b * 255);
  const a = color.a !== undefined ? color.a : 1;
  if (a < 1) {
    return `rgba(${r}, ${g}, ${b}, ${Math.round(a * 100) / 100})`;
  }
  return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0').toUpperCase()).join('');
}

function walk(node, depth, parentPath) {
  if (!node) return;
  const name = node.name || '';
  const type = node.type || '';
  const currentPath = parentPath ? `${parentPath} > ${name}` : name;

  // Fills (colors / gradients)
  if (Array.isArray(node.fills)) {
    for (const fill of node.fills) {
      if (fill.type === 'SOLID' && fill.color) {
        const hex = toHex(fill.color);
        if (hex) {
          if (!styles.colors[hex]) styles.colors[hex] = [];
          styles.colors[hex].push(`${currentPath} (${type})`);
        }
      } else if (fill.type === 'GRADIENT_LINEAR' || fill.type === 'GRADIENT_RADIAL') {
        const stops = (fill.gradientStops || []).map(s => {
          const c = toHex(s.color);
          const pos = Math.round(s.position * 100);
          return `${c} ${pos}%`;
        });
        styles.gradients.push({ node: currentPath, type: fill.type, stops: stops.join(', ') });
      }
    }
  }

  // Strokes
  if (Array.isArray(node.strokes)) {
    for (const stroke of node.strokes) {
      if (stroke.type === 'SOLID' && stroke.color) {
        styles.borders.push({
          node: currentPath,
          color: toHex(stroke.color),
          weight: `${node.strokeWeight || 1}px`,
        });
      }
    }
  }

  // Text styles
  if (type === 'TEXT' && node.style) {
    const s = node.style;
    const chars = node.characters || '';
    styles.fonts.push({
      node: currentPath,
      text: chars.substring(0, 30),
      fontFamily: s.fontFamily,
      fontSize: s.fontSize,
      fontWeight: s.fontWeight,
      lineHeight: s.lineHeightPx ? `${s.lineHeightPx}px` : 'auto',
      letterSpacing: s.letterSpacing || 0,
      textAlign: s.textAlignHorizontal,
      fillColor: (Array.isArray(node.fills) && node.fills[0] && node.fills[0].color)
        ? toHex(node.fills[0].color) : '',
    });
  }

  // Effects (shadows)
  if (Array.isArray(node.effects)) {
    for (const effect of node.effects) {
      if (effect.type && effect.type.includes('SHADOW') && effect.visible !== false) {
        styles.shadows.push({
          node: currentPath,
          type: effect.type,
          color: toHex(effect.color),
          offsetX: `${(effect.offset && effect.offset.x) || 0}px`,
          offsetY: `${(effect.offset && effect.offset.y) || 0}px`,
          radius: `${effect.radius || 0}px`,
          spread: `${effect.spread || 0}px`,
        });
      }
    }
  }

  // Corner radius
  if (node.cornerRadius && node.cornerRadius > 0) {
    styles.radii.push({ node: currentPath, radius: `${node.cornerRadius}px` });
  }

  // Dimensions & padding (frames/components only)
  const bb = node.absoluteBoundingBox;
  if (bb && (type === 'FRAME' || type === 'COMPONENT' || type === 'INSTANCE')) {
    const dim = {
      node: currentPath,
      width: `${Math.round(bb.width)}px`,
      height: `${Math.round(bb.height)}px`,
    };
    if (node.paddingTop || node.paddingRight || node.paddingBottom || node.paddingLeft) {
      dim.padding = `${node.paddingTop || 0} ${node.paddingRight || 0} ${node.paddingBottom || 0} ${node.paddingLeft || 0}`;
    }
    if (node.itemSpacing) {
      dim.gap = `${node.itemSpacing}px`;
    }
    styles.dimensions.push(dim);
  }

  // Recurse
  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      walk(child, depth + 1, currentPath);
    }
  }
}

walk(rootNode, 0, '');

// --- Generate Markdown ---

function shortPath(p) {
  const parts = p.split(' > ');
  return parts.slice(-2).join(' > ');
}

let md = '# Figma 精确样式数据\n\n';

// Colors
md += '## 颜色 (Colors)\n\n';
md += '| HEX/RGBA | 使用位置 (前3个) |\n';
md += '|----------|------------------|\n';
const sortedColors = Object.entries(styles.colors).sort((a, b) => b[1].length - a[1].length);
for (const [hex, locations] of sortedColors) {
  const locs = locations.slice(0, 3).join('; ');
  md += `| \`${hex}\` (${locations.length}处) | ${locs} |\n`;
}

// Fonts - unique
md += '\n## 字体 (Fonts)\n\n';
md += '| 文本内容 | 字体 | 字号 | 字重 | 行高 | 颜色 |\n';
md += '|---------|------|------|------|------|------|\n';
const seenFonts = new Set();
const uniqueFonts = styles.fonts.filter(f => {
  const key = `${f.fontFamily}-${f.fontSize}-${f.fontWeight}`;
  if (seenFonts.has(key)) return false;
  seenFonts.add(key);
  return true;
}).sort((a, b) => b.fontSize - a.fontSize);
for (const f of uniqueFonts) {
  md += `| ${f.text} | ${f.fontFamily} | ${f.fontSize}px | ${f.fontWeight} | ${f.lineHeight} | \`${f.fillColor}\` |\n`;
}

// All text nodes
md += '\n### 全部文本节点\n\n';
md += '| 文本 | 字体 | 大小 | 字重 | 行高 | 颜色 | 路径 |\n';
md += '|------|------|------|------|------|------|------|\n';
for (const f of styles.fonts) {
  md += `| ${f.text} | ${f.fontFamily} | ${f.fontSize}px | ${f.fontWeight} | ${f.lineHeight} | \`${f.fillColor}\` | ${shortPath(f.node)} |\n`;
}

// Gradients
if (styles.gradients.length > 0) {
  md += '\n## 渐变 (Gradients)\n\n';
  md += '| 节点 | 类型 | 色标 |\n';
  md += '|------|------|------|\n';
  for (const g of styles.gradients) {
    md += `| ${shortPath(g.node)} | ${g.type} | ${g.stops} |\n`;
  }
}

// Shadows
if (styles.shadows.length > 0) {
  md += '\n## 阴影 (Shadows)\n\n';
  md += '| 节点 | 类型 | 颜色 | X偏移 | Y偏移 | 模糊 | 扩展 |\n';
  md += '|------|------|------|-------|-------|------|------|\n';
  for (const s of styles.shadows) {
    md += `| ${shortPath(s.node)} | ${s.type} | \`${s.color}\` | ${s.offsetX} | ${s.offsetY} | ${s.radius} | ${s.spread} |\n`;
  }
}

// Border Radius
if (styles.radii.length > 0) {
  md += '\n## 圆角 (Border Radius)\n\n';
  md += '| 节点 | 圆角 |\n';
  md += '|------|------|\n';
  const seenRadii = new Set();
  for (const r of styles.radii) {
    const key = `${shortPath(r.node)}-${r.radius}`;
    if (seenRadii.has(key)) continue;
    seenRadii.add(key);
    md += `| ${shortPath(r.node)} | ${r.radius} |\n`;
  }
}

// Borders
if (styles.borders.length > 0) {
  md += '\n## 边框 (Borders)\n\n';
  md += '| 节点 | 颜色 | 宽度 |\n';
  md += '|------|------|------|\n';
  for (const b of styles.borders.slice(0, 20)) {
    md += `| ${shortPath(b.node)} | \`${b.color}\` | ${b.weight} |\n`;
  }
}

// Key Dimensions
md += '\n## 关键尺寸 (Key Dimensions)\n\n';
md += '| 节点 | 宽度 | 高度 | 内边距 | 间距 |\n';
md += '|------|------|------|--------|------|\n';
const keyDims = styles.dimensions.filter(d => d.padding || d.gap).slice(0, 40);
for (const d of keyDims) {
  md += `| ${shortPath(d.node)} | ${d.width} | ${d.height} | ${d.padding || '-'} | ${d.gap || '-'} |\n`;
}

fs.writeFileSync(outputPath, md, 'utf8');

console.log(`Done! Output: ${outputPath}`);
console.log(`Colors: ${Object.keys(styles.colors).length}`);
console.log(`Fonts: ${styles.fonts.length}`);
console.log(`Gradients: ${styles.gradients.length}`);
console.log(`Shadows: ${styles.shadows.length}`);
console.log(`Borders: ${styles.borders.length}`);
console.log(`Radii: ${styles.radii.length}`);
console.log(`Dimensions: ${styles.dimensions.length}`);
