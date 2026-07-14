#!/usr/bin/env node

// Enhanced Figma style extractor — core logic adapted from Framelink (MIT).
// Covers: colors, gradients, fonts, layout (Auto Layout → Flexbox), shadows,
// blur, borders, border-radius, dimensions, padding, and gap.
//
// Usage:
//   node figma-extract.js --token=<FIGMA_TOKEN> --file=<FILE_KEY> [--node=<NODE_ID>] [--out=<output.md>]
//   node figma-extract.js <input.json> [output.md]      (offline mode, same as extract-styles.js)
//
// No third-party dependencies — pure Node.js (>=18 for global fetch).
// MIT License — see https://github.com/GLips/Figma-Context-MCP

'use strict';

const fs = require('fs');
const path = require('path');

// ─── CLI ────────────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { token: null, file: null, node: null, out: null, input: null };

  for (const a of args) {
    if (a.startsWith('--token=')) opts.token = a.slice(8);
    else if (a.startsWith('--file='))  opts.file  = a.slice(7);
    else if (a.startsWith('--node='))  opts.node  = a.slice(7);
    else if (a.startsWith('--out='))   opts.out   = a.slice(6);
    else if (!opts.input) opts.input = a;
    else if (!opts.out)   opts.out   = a;
  }

  // Offline mode: first positional arg is a JSON file
  if (opts.input && !opts.token) {
    return { mode: 'offline', ...opts };
  }
  if (opts.token && opts.file) {
    return { mode: 'api', ...opts };
  }

  console.error(
    'Usage:\n' +
    '  node figma-extract.js --token=<TOKEN> --file=<KEY> [--node=<ID>] [--out=<file.md>]\n' +
    '  node figma-extract.js <input.json> [output.md]'
  );
  process.exit(1);
}

// ─── Figma REST API ─────────────────────────────────────────────────────────

async function fetchFigmaNodes(token, fileKey, nodeId) {
  const base = 'https://api.figma.com/v1';
  const url = nodeId
    ? `${base}/files/${fileKey}/nodes?ids=${encodeURIComponent(nodeId)}`
    : `${base}/files/${fileKey}`;
  const res = await fetch(url, { headers: { 'X-Figma-Token': token } });
  if (!res.ok) throw new Error(`Figma API ${res.status}: ${res.statusText}`);
  return res.json();
}

// ─── Color helpers (from Framelink style.ts) ────────────────────────────────

function toHex(color) {
  if (!color) return null;
  const r = Math.round(color.r * 255);
  const g = Math.round(color.g * 255);
  const b = Math.round(color.b * 255);
  return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1).toUpperCase();
}

function toRGBA(color, opacity = 1) {
  if (!color) return null;
  const r = Math.round(color.r * 255);
  const g = Math.round(color.g * 255);
  const b = Math.round(color.b * 255);
  const a = Math.round(opacity * (color.a !== undefined ? color.a : 1) * 100) / 100;
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

function parseFillColor(fill) {
  if (!fill || !fill.color) return null;
  const opacity = fill.opacity !== undefined ? fill.opacity : 1;
  const a = (fill.color.a !== undefined ? fill.color.a : 1) * opacity;
  if (a < 1) return toRGBA(fill.color, opacity);
  return toHex(fill.color);
}

// ─── Gradient → CSS (from Framelink style.ts) ───────────────────────────────

function gradientToCss(fill) {
  const stops = (fill.gradientStops || [])
    .sort((a, b) => a.position - b.position)
    .map(s => `${toRGBA(s.color)} ${Math.round(s.position * 100)}%`)
    .join(', ');

  const handles = fill.gradientHandlePositions;
  if (fill.type === 'GRADIENT_LINEAR') {
    let angle = 0;
    if (handles && handles.length >= 2) {
      const dx = handles[1].x - handles[0].x;
      const dy = handles[1].y - handles[0].y;
      angle = Math.round(Math.atan2(dy, dx) * (180 / Math.PI) + 90);
    }
    return `linear-gradient(${angle}deg, ${stops})`;
  }
  if (fill.type === 'GRADIENT_RADIAL') {
    let pos = '50% 50%';
    if (handles && handles.length >= 1) {
      pos = `${Math.round(handles[0].x * 100)}% ${Math.round(handles[0].y * 100)}%`;
    }
    return `radial-gradient(circle at ${pos}, ${stops})`;
  }
  if (fill.type === 'GRADIENT_ANGULAR') {
    let from = '0deg', pos = '50% 50%';
    if (handles && handles.length >= 2) {
      const dx = handles[1].x - handles[0].x;
      const dy = handles[1].y - handles[0].y;
      from = `${Math.round(Math.atan2(dy, dx) * (180 / Math.PI) + 90)}deg`;
      pos = `${Math.round(handles[0].x * 100)}% ${Math.round(handles[0].y * 100)}%`;
    }
    return `conic-gradient(from ${from} at ${pos}, ${stops})`;
  }
  if (fill.type === 'GRADIENT_DIAMOND') {
    let pos = '50% 50%';
    if (handles && handles.length >= 1) {
      pos = `${Math.round(handles[0].x * 100)}% ${Math.round(handles[0].y * 100)}%`;
    }
    return `radial-gradient(ellipse at ${pos}, ${stops})`;
  }
  return `linear-gradient(0deg, ${stops})`;
}

// ─── Layout → Flexbox (from Framelink layout.ts) ────────────────────────────

function parseLayout(node) {
  if (!node.layoutMode || node.layoutMode === 'NONE') return null;

  const mode = node.layoutMode === 'HORIZONTAL' ? 'row' : 'column';
  const layout = { display: 'flex', flexDirection: mode };

  // justify-content (primary axis)
  const pa = node.primaryAxisAlignItems;
  if (pa === 'MAX')           layout.justifyContent = 'flex-end';
  else if (pa === 'CENTER')   layout.justifyContent = 'center';
  else if (pa === 'SPACE_BETWEEN') layout.justifyContent = 'space-between';

  // align-items (cross axis)
  const ca = node.counterAxisAlignItems;
  if (ca === 'MAX')           layout.alignItems = 'flex-end';
  else if (ca === 'CENTER')   layout.alignItems = 'center';
  else if (ca === 'BASELINE') layout.alignItems = 'baseline';

  // wrap
  if (node.layoutWrap === 'WRAP') layout.flexWrap = 'wrap';

  // gap
  if (node.itemSpacing) layout.gap = `${node.itemSpacing}px`;
  if (node.layoutWrap === 'WRAP' && node.counterAxisSpacing) {
    layout.gap = node.itemSpacing
      ? `${node.counterAxisSpacing}px ${node.itemSpacing}px`
      : `${node.counterAxisSpacing}px`;
  }

  // padding
  const pt = node.paddingTop || 0, pr = node.paddingRight || 0;
  const pb = node.paddingBottom || 0, pl = node.paddingLeft || 0;
  if (pt || pr || pb || pl) {
    layout.padding = cssShorthand(pt, pr, pb, pl);
  }

  // overflow
  if (node.overflowDirection) {
    const dirs = [];
    if (node.overflowDirection.includes('HORIZONTAL')) dirs.push('x');
    if (node.overflowDirection.includes('VERTICAL'))   dirs.push('y');
    if (dirs.length) layout.overflow = dirs.join(' ');
  }

  return layout;
}

function cssShorthand(top, right, bottom, left) {
  if (top === right && right === bottom && bottom === left) return `${top}px`;
  if (right === left) {
    if (top === bottom) return `${top}px ${right}px`;
    return `${top}px ${right}px ${bottom}px`;
  }
  return `${top}px ${right}px ${bottom}px ${left}px`;
}

// ─── Effects → CSS (from Framelink effects.ts) ──────────────────────────────

function parseEffects(effects) {
  if (!Array.isArray(effects)) return null;
  const visible = effects.filter(e => e.visible !== false);
  if (!visible.length) return null;

  const result = {};

  // box-shadow / text-shadow
  const shadows = visible
    .filter(e => e.type === 'DROP_SHADOW' || e.type === 'INNER_SHADOW')
    .map(e => {
      const inset = e.type === 'INNER_SHADOW' ? 'inset ' : '';
      const ox = (e.offset && e.offset.x) || 0;
      const oy = (e.offset && e.offset.y) || 0;
      const blur = e.radius || 0;
      const spread = e.spread || 0;
      return `${inset}${ox}px ${oy}px ${blur}px ${spread}px ${toRGBA(e.color)}`;
    });
  if (shadows.length) result.boxShadow = shadows.join(', ');

  // filter: blur
  const layerBlurs = visible
    .filter(e => e.type === 'LAYER_BLUR')
    .map(e => `blur(${e.radius}px)`);
  if (layerBlurs.length) result.filter = layerBlurs.join(' ');

  // backdrop-filter
  const bgBlurs = visible
    .filter(e => e.type === 'BACKGROUND_BLUR')
    .map(e => `blur(${e.radius}px)`);
  if (bgBlurs.length) result.backdropFilter = bgBlurs.join(' ');

  return Object.keys(result).length ? result : null;
}

// ─── Text style (from Framelink text.ts) ────────────────────────────────────

function parseTextStyle(node) {
  if (node.type !== 'TEXT' || !node.style) return null;
  const s = node.style;
  const ts = {};

  if (s.fontFamily)   ts.fontFamily = s.fontFamily;
  if (s.fontSize)     ts.fontSize = `${s.fontSize}px`;
  if (s.fontWeight)   ts.fontWeight = s.fontWeight;
  if (s.letterSpacing && s.fontSize) {
    ts.letterSpacing = `${round2((s.letterSpacing / s.fontSize) * 100)}%`;
  }

  // line-height: respect unit
  if (s.lineHeightUnit === 'PIXELS' && s.lineHeightPx) {
    ts.lineHeight = `${round2(s.lineHeightPx)}px`;
  } else if (s.lineHeightUnit === 'FONT_SIZE_%' && s.lineHeightPercentFontSize) {
    ts.lineHeight = `${round2(s.lineHeightPercentFontSize)}%`;
  } else if (s.lineHeightUnit !== 'INTRINSIC_%' && s.lineHeightPx && s.fontSize) {
    ts.lineHeight = `${round2(s.lineHeightPx / s.fontSize)}em`;
  }

  if (s.textAlignHorizontal) ts.textAlign = s.textAlignHorizontal.toLowerCase();
  if (s.textCase && s.textCase !== 'ORIGINAL') ts.textTransform = s.textCase.toLowerCase();

  // text color from fills
  if (Array.isArray(node.fills) && node.fills.length) {
    const visibleFill = node.fills.find(f => f.visible !== false);
    if (visibleFill) ts.color = parseFillColor(visibleFill);
  }

  ts.text = (node.characters || '').substring(0, 60);

  return ts;
}

function round2(n) { return Math.round(n * 100) / 100; }

function formatNumber(n) {
  if (typeof n !== 'number' || Number.isNaN(n)) return null;
  const rounded = round2(n);
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}

function truncateText(text, max) {
  if (!text) return '';
  const chars = Array.from(String(text));
  return chars.length > max ? `${chars.slice(0, max).join('')}...` : chars.join('');
}

function truncateCssValue(value, max = 80) {
  if (!value) return null;
  return value.length > max ? `${value.slice(0, max - 3)}...` : value;
}

function stripPx(value) {
  return String(value).replace(/px/g, '');
}

function formatCompactShorthand(top, right, bottom, left) {
  const shorthand = cssShorthand(top || 0, right || 0, bottom || 0, left || 0);
  return stripPx(shorthand).replace(/\s+/g, ',');
}

function formatSizing(node) {
  if (!node.layoutSizingHorizontal && !node.layoutSizingVertical) return null;
  const horizontal = (node.layoutSizingHorizontal || 'FIXED').toLowerCase();
  const vertical = (node.layoutSizingVertical || 'FIXED').toLowerCase();
  return `${horizontal}×${vertical}`;
}

function formatDimensions(node) {
  const bb = node.absoluteBoundingBox;
  if (!bb) return null;
  return `${Math.round(bb.width)}×${Math.round(bb.height)}`;
}

function formatBackground(node) {
  if (!Array.isArray(node.fills)) return null;
  const fill = node.fills.find(f => f && f.visible !== false);
  if (!fill) return null;
  if (fill.type === 'SOLID' && fill.color) {
    return parseFillColor(fill);
  }
  if (fill.type && fill.type.startsWith('GRADIENT')) {
    return truncateCssValue(gradientToCss(fill));
  }
  return null;
}

function formatBorder(node) {
  if (!Array.isArray(node.strokes)) return null;
  const stroke = node.strokes.find(s => s && s.visible !== false && s.type === 'SOLID' && s.color);
  if (!stroke) return null;

  let weight = node.strokeWeight || 1;
  if (node.individualStrokeWeights) {
    const w = node.individualStrokeWeights;
    const values = [w.top || 0, w.right || 0, w.bottom || 0, w.left || 0];
    const nonZero = values.filter(v => v > 0);
    weight = nonZero.length ? Math.max(...nonZero) : 0;
  }
  if (!weight) return null;
  return `${parseFillColor(stroke)}/${formatNumber(weight)}px`;
}

function formatRadius(node) {
  if (typeof node.cornerRadius === 'number' && node.cornerRadius > 0) {
    return formatNumber(node.cornerRadius);
  }
  if (Array.isArray(node.rectangleCornerRadii)) {
    const [tl, tr, br, bl] = node.rectangleCornerRadii;
    if (tl || tr || br || bl) {
      return formatCompactShorthand(tl, tr, br, bl);
    }
  }
  return null;
}

function formatOpacity(node) {
  if (typeof node.opacity !== 'number' || node.opacity === 1) return null;
  return String(round2(node.opacity));
}

function formatShadow(node) {
  const fx = parseEffects(node.effects);
  if (!fx || !fx.boxShadow) return null;
  return fx.boxShadow.includes('inset ') ? 'shadow:inset' : 'shadow';
}

function formatLayoutTokens(node) {
  const tokens = [];
  const layout = parseLayout(node);
  if (layout) {
    tokens.push(layout.flexDirection);
    if (layout.justifyContent && layout.justifyContent !== 'flex-start') {
      tokens.push(layout.justifyContent);
    }
    if (layout.alignItems && layout.alignItems !== 'flex-start') {
      tokens.push(layout.alignItems);
    }
    if (layout.flexWrap === 'wrap') {
      tokens.push('wrap');
    }
    if (layout.gap) {
      tokens.push(`gap:${stripPx(layout.gap).replace(/\s+/g, ',')}`);
    }
    if (layout.padding) {
      tokens.push(`pad:${stripPx(layout.padding).replace(/\s+/g, ',')}`);
    }
  }
  const sizing = formatSizing(node);
  if (sizing) tokens.push(sizing);
  return tokens;
}

function formatTextTokens(node) {
  const tokens = [];
  const content = truncateText((node.characters || '').replace(/\s+/g, ' ').trim(), 40);
  tokens.push(`"${content}"`);
  const style = parseTextStyle(node);
  const size = style && style.fontSize ? stripPx(style.fontSize) : null;
  const weight = style && style.fontWeight ? String(style.fontWeight) : null;
  const color = style && style.color ? style.color : null;
  if (size || weight || color) {
    tokens.push(`${size || '?'}px/${weight || '?'}${color ? `/${color}` : ''}`);
  }
  return tokens;
}

const SVG_NODE_TYPES = new Set([
  'IMAGE-SVG',
  'VECTOR',
  'BOOLEAN_OPERATION',
  'STAR',
  'LINE',
  'ELLIPSE',
  'REGULAR_POLYGON',
  'RECTANGLE',
]);

function hasImageFill(node) {
  return Array.isArray(node.fills) && node.fills.some(fill => fill && fill.type === 'IMAGE');
}

function isSvgLeafType(type) {
  return SVG_NODE_TYPES.has(type);
}

function shouldCollapseToSvg(node) {
  if (!Array.isArray(node.children) || !node.children.length) return false;
  if (!['FRAME', 'GROUP', 'INSTANCE', 'BOOLEAN_OPERATION'].includes(node.type)) return false;
  if (hasImageFill(node)) return false;
  const visibleChildren = node.children.filter(child => child && child.visible !== false);
  if (!visibleChildren.length) return false;
  return visibleChildren.every(child => {
    return isSvgLeafType(child.type) || shouldCollapseToSvg(child);
  });
}

function formatNodeLabel(node) {
  const collapsedSvg = node.type === 'VECTOR' || isSvgLeafType(node.type) || shouldCollapseToSvg(node);
  const type = collapsedSvg ? 'IMAGE-SVG' : (node.type || 'UNKNOWN');
  const tokens = [];
  const dimensions = formatDimensions(node);
  if (dimensions) tokens.push(dimensions);

  if (type === 'TEXT') {
    tokens.push(...formatTextTokens(node));
  } else if (type === 'IMAGE-SVG') {
    const opacity = formatOpacity(node);
    if (opacity) tokens.push(`opacity:${opacity}`);
  } else {
    const layoutTokens = formatLayoutTokens(node);
    if (layoutTokens.length) tokens.push(layoutTokens.join('/'));
    const background = formatBackground(node);
    if (background) tokens.push(`bg:${background}`);
    const border = formatBorder(node);
    if (border) tokens.push(`border:${border}`);
    const radius = formatRadius(node);
    if (radius) tokens.push(`r:${radius}`);
    const shadow = formatShadow(node);
    if (shadow) tokens.push(shadow);
    const opacity = formatOpacity(node);
    if (opacity) tokens.push(`opacity:${opacity}`);
  }

  return `${node.name || '(unnamed)'} [${type}]${tokens.length ? ` ${tokens.join(' ')}` : ''}`;
}

function buildTreeLines(node, prefix = '', isLast = true, isRoot = false) {
  if (!node) return [];
  const hiddenRoot = isRoot && node.visible === false;
  const hiddenNonRoot = !isRoot && node.visible === false;
  if (hiddenNonRoot) return [];

  const lines = [];
  const collapsedSvg = node.type === 'VECTOR' || isSvgLeafType(node.type) || shouldCollapseToSvg(node);

  if (!hiddenRoot) {
    const branch = isRoot ? '' : `${prefix}${isLast ? '└─ ' : '├─ '}`;
    lines.push(`${branch}${formatNodeLabel(node)}`);
  }

  if (collapsedSvg) return lines;
  if (!Array.isArray(node.children) || !node.children.length) return lines;

  const nextPrefix = isRoot ? '' : `${prefix}${isLast ? '    ' : '│   '}`;
  const visibleChildren = node.children.filter(child => child && child.visible !== false);
  for (let i = 0; i < visibleChildren.length; i++) {
    lines.push(...buildTreeLines(visibleChildren[i], nextPrefix, i === visibleChildren.length - 1, false));
  }
  return lines;
}

function generateTree(root) {
  return buildTreeLines(root, '', true, true).join('\n');
}

function inferTreePath(stylesPath) {
  if (!stylesPath) return null;
  if (stylesPath === '-') return '-';

  const dir = path.dirname(stylesPath);
  const ext = path.extname(stylesPath);
  const base = path.basename(stylesPath, ext);
  const treeBase = base.endsWith('_styles') ? `${base.slice(0, -7)}_tree` : `${base}_tree`;
  return path.join(dir, `${treeBase}.txt`);
}

// ─── Node walker ────────────────────────────────────────────────────────────

const collected = {
  colors: {},       // hex/rgba → [locations]
  gradients: [],
  fonts: [],        // unique text styles
  layouts: [],
  shadows: [],
  borders: [],
  radii: [],
  dimensions: [],
  effects: [],      // filter / backdrop-filter
};

function shortPath(p) {
  const parts = p.split(' > ');
  return parts.length <= 2 ? p : parts.slice(-2).join(' > ');
}

function walk(node, parentPath, isRoot) {
  if (!node) return;
  // Skip invisible nodes, but always process the root (user-specified target)
  // and nodes with children (Figma components often mark parents invisible)
  if (node.visible === false && !isRoot && !(Array.isArray(node.children) && node.children.length)) return;

  const name = node.name || '';
  const type = node.type || '';
  const cur = parentPath ? `${parentPath} > ${name}` : name;

  // ── Fills ──
  if (Array.isArray(node.fills)) {
    for (const fill of node.fills) {
      if (fill.visible === false) continue;
      if (fill.type === 'SOLID' && fill.color) {
        const c = parseFillColor(fill);
        if (c) {
          if (!collected.colors[c]) collected.colors[c] = [];
          collected.colors[c].push(shortPath(cur));
        }
      } else if (fill.type && fill.type.startsWith('GRADIENT')) {
        collected.gradients.push({ node: shortPath(cur), css: gradientToCss(fill) });
      }
    }
  }

  // ── Strokes ──
  if (Array.isArray(node.strokes)) {
    for (const stroke of node.strokes) {
      if (stroke.visible === false) continue;
      if (stroke.type === 'SOLID' && stroke.color) {
        const weight = node.strokeWeight || 1;
        let weightStr = `${weight}px`;
        // individual stroke weights
        if (node.individualStrokeWeights) {
          const w = node.individualStrokeWeights;
          weightStr = cssShorthand(w.top || 0, w.right || 0, w.bottom || 0, w.left || 0);
        }
        const dashStr = Array.isArray(node.strokeDashes) && node.strokeDashes.length
          ? ` dashed(${node.strokeDashes.join(' ')})`
          : '';
        collected.borders.push({
          node: shortPath(cur),
          color: parseFillColor(stroke),
          weight: weightStr + dashStr,
        });
      }
    }
  }

  // ── Text ──
  const ts = parseTextStyle(node);
  if (ts) collected.fonts.push({ ...ts, path: shortPath(cur) });

  // ── Layout ──
  const layout = parseLayout(node);
  if (layout) {
    collected.layouts.push({ node: shortPath(cur), ...layout });
  }

  // ── Effects ──
  const fx = parseEffects(node.effects);
  if (fx) {
    if (fx.boxShadow) {
      collected.shadows.push({
        node: shortPath(cur),
        type: node.type === 'TEXT' ? 'text-shadow' : 'box-shadow',
        css: fx.boxShadow,
      });
    }
    if (fx.filter) collected.effects.push({ node: shortPath(cur), prop: 'filter', css: fx.filter });
    if (fx.backdropFilter) collected.effects.push({ node: shortPath(cur), prop: 'backdrop-filter', css: fx.backdropFilter });
  }

  // ── Border radius ──
  if (node.cornerRadius && node.cornerRadius > 0) {
    collected.radii.push({ node: shortPath(cur), css: `${node.cornerRadius}px` });
  } else if (Array.isArray(node.rectangleCornerRadii)) {
    const [tl, tr, br, bl] = node.rectangleCornerRadii;
    if (tl || tr || br || bl) {
      collected.radii.push({ node: shortPath(cur), css: `${tl}px ${tr}px ${br}px ${bl}px` });
    }
  }

  // ── Dimensions ──
  const bb = node.absoluteBoundingBox;
  if (bb && (type === 'FRAME' || type === 'COMPONENT' || type === 'INSTANCE' || type === 'COMPONENT_SET')) {
    const dim = {
      node: shortPath(cur),
      width: `${Math.round(bb.width)}px`,
      height: `${Math.round(bb.height)}px`,
    };
    // sizing
    const sh = node.layoutSizingHorizontal;
    const sv = node.layoutSizingVertical;
    if (sh) dim.hSizing = sh.toLowerCase();
    if (sv) dim.vSizing = sv.toLowerCase();

    // padding & gap (only if no layout already captured)
    if (!layout) {
      const pt = node.paddingTop || 0, pr = node.paddingRight || 0;
      const pb = node.paddingBottom || 0, pl = node.paddingLeft || 0;
      if (pt || pr || pb || pl) dim.padding = cssShorthand(pt, pr, pb, pl);
      if (node.itemSpacing) dim.gap = `${node.itemSpacing}px`;
    }

    collected.dimensions.push(dim);
  }

  // ── Opacity ──
  // (included in dimensions for relevant nodes)

  // ── Recurse ──
  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      walk(child, cur, false);
    }
  }
}

// ─── Markdown output ────────────────────────────────────────────────────────

function generateMarkdown() {
  let md = '# Figma Style Extraction\n\n';
  md += '> Extracted with figma-extract.js (core logic from [Framelink](https://github.com/GLips/Figma-Context-MCP), MIT)\n\n';

  // ── Colors ──
  md += '## Colors\n\n';
  md += '| Color | Count | Used at |\n|-------|-------|---------|\n';
  const sortedColors = Object.entries(collected.colors).sort((a, b) => b[1].length - a[1].length);
  for (const [color, locs] of sortedColors) {
    md += `| \`${color}\` | ${locs.length} | ${locs.slice(0, 3).join('; ')} |\n`;
  }

  // ── Fonts ──
  if (collected.fonts.length) {
    md += '\n## Typography\n\n';
    md += '| Text | Font | Size | Weight | Line Height | Letter Spacing | Color |\n';
    md += '|------|------|------|--------|-------------|----------------|-------|\n';
    const seen = new Set();
    const unique = collected.fonts.filter(f => {
      const key = `${f.fontFamily}-${f.fontSize}-${f.fontWeight}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).sort((a, b) => parseInt(b.fontSize) - parseInt(a.fontSize));
    for (const f of unique) {
      md += `| ${f.text || ''} | ${f.fontFamily || ''} | ${f.fontSize || ''} | ${f.fontWeight || ''} | ${f.lineHeight || 'auto'} | ${f.letterSpacing || '0'} | \`${f.color || ''}\` |\n`;
    }
  }

  // ── Layout (NEW vs extract-styles.js) ──
  if (collected.layouts.length) {
    md += '\n## Layout (Auto Layout → Flexbox)\n\n';
    md += '| Node | Direction | Justify | Align | Gap | Padding | Wrap |\n';
    md += '|------|-----------|---------|-------|-----|---------|------|\n';
    for (const l of collected.layouts) {
      md += `| ${l.node} | ${l.flexDirection} | ${l.justifyContent || 'flex-start'} | ${l.alignItems || 'flex-start'} | ${l.gap || '-'} | ${l.padding || '-'} | ${l.flexWrap || 'no'} |\n`;
    }
  }

  // ── Shadows (CSS-ready) ──
  if (collected.shadows.length) {
    md += '\n## Shadows\n\n';
    md += '| Node | Property | CSS |\n|------|----------|-----|\n';
    for (const s of collected.shadows) {
      md += `| ${s.node} | ${s.type} | \`${s.css}\` |\n`;
    }
  }

  // ── Effects (filter / backdrop-filter) ──
  if (collected.effects.length) {
    md += '\n## Effects\n\n';
    md += '| Node | Property | CSS |\n|------|----------|-----|\n';
    for (const e of collected.effects) {
      md += `| ${e.node} | ${e.prop} | \`${e.css}\` |\n`;
    }
  }

  // ── Gradients ──
  if (collected.gradients.length) {
    md += '\n## Gradients\n\n';
    md += '| Node | CSS |\n|------|-----|\n';
    for (const g of collected.gradients) {
      md += `| ${g.node} | \`${g.css}\` |\n`;
    }
  }

  // ── Borders ──
  if (collected.borders.length) {
    md += '\n## Borders\n\n';
    md += '| Node | Color | Width |\n|------|-------|-------|\n';
    for (const b of collected.borders.slice(0, 30)) {
      md += `| ${b.node} | \`${b.color}\` | ${b.weight} |\n`;
    }
  }

  // ── Border Radius ──
  if (collected.radii.length) {
    md += '\n## Border Radius\n\n';
    md += '| Node | CSS |\n|------|-----|\n';
    const seen = new Set();
    for (const r of collected.radii) {
      const key = `${r.node}-${r.css}`;
      if (seen.has(key)) continue;
      seen.add(key);
      md += `| ${r.node} | \`${r.css}\` |\n`;
    }
  }

  // ── Dimensions ──
  if (collected.dimensions.length) {
    md += '\n## Dimensions\n\n';
    md += '| Node | Width | Height | H-Sizing | V-Sizing | Padding | Gap |\n';
    md += '|------|-------|--------|----------|----------|---------|-----|\n';
    for (const d of collected.dimensions.slice(0, 50)) {
      md += `| ${d.node} | ${d.width} | ${d.height} | ${d.hSizing || '-'} | ${d.vSizing || '-'} | ${d.padding || '-'} | ${d.gap || '-'} |\n`;
    }
  }

  return md;
}

// ─── Root node detection ────────────────────────────────────────────────────

function findRoot(json) {
  if (json.nodes) {
    const firstKey = Object.keys(json.nodes)[0];
    return json.nodes[firstKey].document;
  }
  if (json.document) return json.document;
  return json;
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs();
  let json;

  if (opts.mode === 'api') {
    console.log(`Fetching from Figma API: file=${opts.file} node=${opts.node || 'root'}...`);
    json = await fetchFigmaNodes(opts.token, opts.file, opts.node);
  } else {
    const raw = fs.readFileSync(opts.input, 'utf8').replace(/^\uFEFF/, '');
    json = JSON.parse(raw);
  }

  const root = findRoot(json);
  walk(root, '', true);

  const md = generateMarkdown();
  const tree = generateTree(root);
  const outPath = opts.out || (opts.input
    ? path.join(path.dirname(opts.input), 'styles_extracted.md')
    : 'figma_styles.md');

  if (outPath === '-') {
    process.stdout.write(`${md}\n\n${tree}\n`);
  } else {
    const treePath = inferTreePath(outPath);
    fs.writeFileSync(outPath, md, 'utf8');
    fs.writeFileSync(treePath, tree, 'utf8');
    console.log(`Done! Output: ${outPath}`);
    console.log(`Tree:  ${treePath}`);
  }
  console.log(`  Colors:     ${Object.keys(collected.colors).length}`);
  console.log(`  Fonts:      ${collected.fonts.length}`);
  console.log(`  Layouts:    ${collected.layouts.length}`);
  console.log(`  Shadows:    ${collected.shadows.length}`);
  console.log(`  Gradients:  ${collected.gradients.length}`);
  console.log(`  Borders:    ${collected.borders.length}`);
  console.log(`  Radii:      ${collected.radii.length}`);
  console.log(`  Dimensions: ${collected.dimensions.length}`);
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
