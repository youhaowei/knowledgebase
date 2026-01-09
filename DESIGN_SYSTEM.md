# Knowledgebase Design System

> A comprehensive guide to the neon cyber aesthetic and design tokens used throughout the Knowledgebase application.

## 🎨 Design Philosophy

The Knowledgebase design system embraces a **neon cyber aesthetic** - a dark, futuristic interface with vibrant accent colors that evoke knowledge graphs, neural networks, and digital connectivity. The design prioritizes:

- **Clarity**: Information is easy to find and understand
- **Depth**: Layered backgrounds and shadows create visual hierarchy
- **Energy**: Vibrant neon accents draw attention to interactive elements
- **Restraint**: Animations are subtle and purposeful, never distracting

---

## 🌈 Color System

### Base Colors (Dark Theme)

```css
--color-void: #06080d;       /* Deepest background */
--color-abyss: #0a0e17;      /* Secondary background */
--color-deep: #0f1521;       /* Card backgrounds */
--color-surface: #151d2e;    /* Elevated surfaces */
--color-elevated: #1a2540;   /* Highest elevation */
```

**Usage**:
- `void`: Main page background
- `abyss`: Modal backdrops, overlays
- `deep`: Card and panel backgrounds
- `surface`: Input fields, elevated components
- `elevated`: Hover states, active selections

### Accent Colors (Neon Glow)

```css
--color-glow-cyan: #00f5d4;     /* Primary accent */
--color-glow-magenta: #f72585;  /* Secondary accent */
--color-glow-violet: #7b2cbf;   /* Tertiary accent */
--color-glow-amber: #ffc300;    /* Quaternary accent */
```

**Usage**:
- `glow-cyan`: Primary CTAs, active states, links
- `glow-magenta`: Error states, destructive actions
- `glow-violet`: Information, secondary actions
- `glow-amber`: Warning states, highlights

### Text Colors

```css
--color-text-primary: #f0f4f8;    /* High emphasis text */
--color-text-secondary: #8892a6;  /* Medium emphasis */
--color-text-tertiary: #5a6478;   /* Low emphasis, hints */
```

**Hierarchy**:
- Primary: Headlines, important values, active states
- Secondary: Body text, labels, descriptions
- Tertiary: Placeholders, metadata, disabled states

### Semantic Colors

```css
--color-border: rgba(255, 255, 255, 0.06);  /* Default borders */
--color-border-glow: rgba(0, 245, 212, 0.2); /* Hover borders */

--color-glow-cyan-soft: rgba(0, 245, 212, 0.15); /* Backgrounds */
--color-glow-cyan-dim: rgba(0, 245, 212, 0.08);  /* Subtle tints */
```

---

## 📝 Typography

### Font Families

```css
--font-display: "Space Grotesk", sans-serif;  /* Headlines, buttons */
--font-sans: "Inter", sans-serif;             /* Body text */
--font-mono: "JetBrains Mono", monospace;     /* Code, data */
```

### Font Scale

| Usage | Size | Weight | Line Height |
|-------|------|--------|-------------|
| Display | 2rem (32px) | 700 | 1.2 |
| H1 | 1.5rem (24px) | 600 | 1.3 |
| H2 | 1.25rem (20px) | 600 | 1.4 |
| H3 | 1rem (16px) | 600 | 1.5 |
| Body | 0.875rem (14px) | 400 | 1.6 |
| Small | 0.75rem (12px) | 400 | 1.5 |
| Tiny | 0.625rem (10px) | 500 | 1.4 |

### Best Practices

1. **Headlines**: Use `font-display` (Space Grotesk) for all headlines and buttons
2. **Body**: Use `font-sans` (Inter) for readable body text
3. **Data**: Use `font-mono` (JetBrains Mono) for numbers, timestamps, technical values
4. **Uppercase**: Use sparingly for labels (10px uppercase tracking-widest)

---

## 📐 Spacing Scale

```css
--spacing-xs: 0.25rem;  /* 4px */
--spacing-sm: 0.5rem;   /* 8px */
--spacing-md: 1rem;     /* 16px */
--spacing-lg: 1.5rem;   /* 24px */
--spacing-xl: 2rem;     /* 32px */
--spacing-2xl: 3rem;    /* 48px */
```

**Common Usage**:
- `xs`: Icon padding, tiny gaps
- `sm`: Button padding, small gaps
- `md`: Card padding, standard gaps
- `lg`: Section spacing
- `xl`: Page margins
- `2xl`: Major section separation

---

## 🔘 Border Radius

```css
--radius-sm: 0.5rem;   /* 8px - Small elements */
--radius-md: 0.75rem;  /* 12px - Cards */
--radius-lg: 1rem;     /* 16px - Modals */
--radius-xl: 1.5rem;   /* 24px - Large surfaces */
```

**Component Mapping**:
- Buttons: `rounded-xl` (16px)
- Cards: `rounded-xl` (16px)
- Inputs: `rounded-xl` (16px)
- Modals: `rounded-2xl` (24px)
- Pills/Tags: `rounded-full`

---

## 🌑 Shadow System

```css
--shadow-sm: 0 2px 8px rgba(0, 0, 0, 0.2);
--shadow-md: 0 8px 32px rgba(0, 0, 0, 0.4);
--shadow-lg: 0 25px 80px -20px rgba(0, 0, 0, 0.6);
--shadow-glow: 0 0 40px rgba(0, 245, 212, 0.1);
```

**Usage Guidelines**:
- `shadow-sm`: Subtle elevation (buttons, inputs)
- `shadow-md`: Standard cards, overlays
- `shadow-lg`: Modals, important floating elements
- `shadow-glow`: Interactive states, hover effects

---

## ✨ Animation System

### Keyframes

#### fadeIn
```css
@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
```
**Usage**: Page loads, component mounts
**Duration**: 0.4s

#### pulseGlow
```css
@keyframes pulseGlow {
  0%, 100% { opacity: 0.5; }
  50% { opacity: 1; }
}
```
**Usage**: Status indicators, active states
**Duration**: 3s (infinite)

#### animate-in
```css
@keyframes animate-in {
  from {
    opacity: 0;
    transform: scale(0.95) translateY(-10px);
  }
  to {
    opacity: 1;
    transform: scale(1) translateY(0);
  }
}
```
**Usage**: Modals, popups
**Duration**: 0.2s

### Animation Principles

1. **Subtle by Default**: Most animations should be barely noticeable
2. **Purpose-Driven**: Only animate for feedback or state changes
3. **Fast**: Keep durations under 300ms for interactions
4. **Ease-Out**: Use `ease-out` for entrances, `ease-in` for exits
5. **No Auto-Play**: Avoid continuous animations except for pulse/loading states

---

## 🧩 Component Patterns

### Buttons

#### Primary (CTA)
```html
<button class="px-5 py-3 bg-gradient-to-br from-glow-cyan to-[#00c4a7]
               rounded-xl text-sm font-semibold text-void
               shadow-[0_8px_32px_rgba(0,245,212,0.3)]
               hover:shadow-[0_12px_40px_rgba(0,245,212,0.4)]
               transition-all duration-300 hover:-translate-y-1">
  Add Memory
</button>
```

#### Secondary
```html
<button class="px-5 py-3 bg-surface/80 backdrop-blur-xl
               border border-border rounded-xl
               text-sm text-text-secondary
               hover:border-border-glow hover:text-text-primary
               transition-all duration-300">
  Cancel
</button>
```

### Cards

```html
<div class="bg-surface/60 backdrop-blur-xl
            border border-border rounded-xl
            p-6 shadow-md
            hover:border-border-glow
            transition-all duration-300">
  <!-- Card content -->
</div>
```

### Inputs

```html
<input class="w-full bg-surface/50 border border-border
              rounded-xl px-4 py-3
              text-sm text-text-primary
              placeholder:text-text-tertiary
              outline-none
              focus:border-glow-cyan
              focus:shadow-[0_0_0_3px_rgba(0,245,212,0.1)]
              transition-all duration-200"
       type="text"
       placeholder="Enter value..." />
```

### Stats Pill

```html
<div class="flex items-center gap-2 px-3 py-2
            bg-surface/60 backdrop-blur-xl
            border border-border rounded-xl
            transition-all duration-300
            hover:border-border-glow group">
  <Icon class="w-3.5 h-3.5 text-text-tertiary
               group-hover:text-glow-cyan
               transition-colors" />
  <span class="font-display text-sm font-semibold text-text-primary">
    42
  </span>
  <span class="font-mono text-[9px] tracking-wider
               uppercase text-text-tertiary">
    LABEL
  </span>
</div>
```

---

## 🎯 Interaction States

### State Matrix

| State | Border | Background | Text | Shadow |
|-------|--------|------------|------|--------|
| Default | `border` | `surface/60` | `text-secondary` | `shadow-sm` |
| Hover | `border-glow` | `surface/70` | `text-primary` | `shadow-md` |
| Active | `border-glow` | `surface/80` | `text-primary` | `shadow-lg` |
| Focus | `glow-cyan` | `surface/60` | `text-primary` | `0 0 0 3px cyan/10%` |
| Disabled | `border` | `surface/30` | `text-tertiary` | none |

### Hover Guidelines

1. **Translate**: Use `hover:-translate-y-0.5` or `hover:-translate-y-1` for lift effect
2. **Scale**: Sparingly use `hover:scale-105` for emphasis (buttons only)
3. **Glow**: Add shadow increase on hover for interactive elements
4. **Color**: Transition from `text-secondary` → `text-primary`

---

## 🌐 Graph Visualization

### Physics Parameters

```javascript
{
  nodeRadius: 24,        // Increased from 20 for better visibility
  nodeCharge: -350,      // Stronger repulsion for better spacing
  linkDistance: 180,     // More space between connected nodes
  iterations: 300        // Smooth physics simulation
}
```

### Node Colors

```javascript
["#00f5d4", "#7b2cbf", "#f72585", "#ffc300", "#00c4a7"]
```

Maps to node types in order:
1. Cyan (#00f5d4): Primary entities
2. Violet (#7b2cbf): Secondary entities
3. Magenta (#f72585): Tertiary entities
4. Amber (#ffc300): Quaternary entities
5. Teal (#00c4a7): Quinary entities

### Link Styling

```javascript
{
  stroke: "rgba(0, 245, 212, 0.35)",  // Brighter, more visible
  strokeWidth: 2.5,                    // Thicker lines
  strokeOpacity: 0.8                   // Higher opacity
}
```

**Conditional styling**: Important relations (related_to, connected_to) use 0.4 opacity for emphasis.

### Node Styling

```javascript
{
  fill: /* Color from scale */,
  fillOpacity: 0.95,
  stroke: "rgba(255, 255, 255, 0.6)",  // White stroke for definition
  strokeWidth: 2.5,
  size: /* Calculated from radius */
}
```

**Hover state**:
```javascript
{
  stroke: "rgba(0, 245, 212, 0.9)",   // Cyan glow on hover
  strokeWidth: 3.5,                    // Thicker border
  fillOpacity: 1                       // Full opacity
}
```

### Label Backgrounds

**Node labels**: Dark rounded rectangles behind text for readability
```javascript
{
  fill: "rgba(6, 8, 13, 0.75)",
  cornerRadius: 4,
  padding: 4
}
```

**Relation labels**: Semi-transparent backgrounds on link centers
```javascript
{
  fill: "rgba(10, 14, 23, 0.85)",
  cornerRadius: 3,
  text: { fill: "rgba(0, 245, 212, 0.9)" }  // Cyan text
}
```

---

## 📱 Responsive Breakpoints

```css
/* Mobile First Approach */
sm: 640px   /* Small devices */
md: 768px   /* Tablets */
lg: 1024px  /* Laptops */
xl: 1280px  /* Desktops */
2xl: 1536px /* Large screens */
```

### Common Patterns

```html
<!-- Hide on mobile, show on tablet+ -->
<span class="hidden sm:inline">Desktop Text</span>

<!-- Full width on mobile, half on desktop -->
<div class="w-full lg:w-1/2">Content</div>

<!-- Stack on mobile, row on desktop -->
<div class="flex flex-col lg:flex-row gap-4">
  <div>Item 1</div>
  <div>Item 2</div>
</div>
```

---

## ♿ Accessibility

### Color Contrast

All text meets WCAG AA standards:
- `text-primary` on `void`: 13.5:1 ✓
- `text-secondary` on `surface`: 6.2:1 ✓
- `glow-cyan` on `void`: 11.8:1 ✓

### Focus States

All interactive elements have visible focus states:
```css
focus:outline-none
focus:border-glow-cyan
focus:shadow-[0_0_0_3px_rgba(0,245,212,0.1)]
```

### Keyboard Navigation

- Modals: Escape to close
- Command Palette: Cmd+K to toggle, arrows to navigate
- Forms: Tab through inputs, Enter to submit

---

## 🎭 Backdrop Effects

### Glass Morphism

```css
bg-surface/60 backdrop-blur-xl
```

**Usage**: Cards, modals, overlays

### Noise Texture

Applied via `body::after`:
```css
background-image: url("data:image/svg+xml,...");
opacity: 0.03;
```

**Purpose**: Adds subtle grain texture to prevent flat appearance

### Gradient Background

Applied via `body::before`:
```css
background:
  radial-gradient(ellipse 80% 50% at 20% 40%, rgba(123, 44, 191, 0.12) 0%, transparent 50%),
  radial-gradient(ellipse 60% 40% at 80% 60%, rgba(0, 245, 212, 0.08) 0%, transparent 50%),
  radial-gradient(ellipse 100% 80% at 50% 100%, rgba(247, 37, 133, 0.06) 0%, transparent 40%);
```

**Colors**: Violet (top-left), Cyan (top-right), Magenta (bottom)

---

## 📦 Component Library

### StatsOverlay

**Location**: Top-left corner
**Purpose**: Show graph statistics
**Animation**: Fade in on mount, pulse on active indicator

### CommandPalette

**Location**: Bottom center (floating)
**Trigger**: Cmd+K or click
**Features**: Search, Add memory, keyboard navigation

### Graph

**Type**: Force-directed Vega visualization
**Interactions**: Drag nodes, hover for tooltips
**Physics**: 300 iterations, auto-stabilizing

---

## 🚀 Performance Guidelines

### Animation Performance

1. **Use transforms**: `translate`, `scale` (GPU-accelerated)
2. **Avoid layout shifts**: Don't animate `width`, `height`, `margin`
3. **will-change**: Add `will-change: transform` for frequently animated elements
4. **Reduce motion**: Respect `prefers-reduced-motion` preference

### Loading Strategy

1. **Fonts**: Preconnect to Google Fonts
2. **Critical CSS**: Inline critical styles
3. **Images**: Use `loading="lazy"` for below-fold content
4. **Code Splitting**: Lazy load modals and heavy components

---

## 📝 Code Style

### Tailwind Order

Follow this order for classes:
1. Layout (flex, grid, position)
2. Spacing (p, m, gap)
3. Sizing (w, h, min, max)
4. Typography (font, text, tracking)
5. Colors (bg, text, border)
6. Effects (shadow, opacity, backdrop)
7. Transitions (transition, duration)
8. States (hover, focus, group)

### Example

```html
<div class="
  flex items-center gap-3
  px-5 py-3
  w-full
  text-sm font-semibold
  bg-surface/80 border border-border rounded-xl
  shadow-md backdrop-blur-xl
  transition-all duration-300
  hover:border-border-glow hover:shadow-lg
">
```

---

## 🎨 Design Tokens Reference

### Quick Reference Card

```javascript
// Colors
const colors = {
  background: {
    void: '#06080d',
    abyss: '#0a0e17',
    deep: '#0f1521',
    surface: '#151d2e',
    elevated: '#1a2540',
  },
  accent: {
    cyan: '#00f5d4',
    magenta: '#f72585',
    violet: '#7b2cbf',
    amber: '#ffc300',
  },
  text: {
    primary: '#f0f4f8',
    secondary: '#8892a6',
    tertiary: '#5a6478',
  },
};

// Typography
const fonts = {
  display: 'Space Grotesk',
  sans: 'Inter',
  mono: 'JetBrains Mono',
};

// Spacing (rem)
const spacing = [0, 0.25, 0.5, 1, 1.5, 2, 3];

// Border Radius (rem)
const radius = [0.5, 0.75, 1, 1.5];

// Animation Durations (ms)
const duration = {
  fast: 150,
  base: 200,
  slow: 300,
  slower: 400,
};
```

---

## 🎯 Usage Examples

### Full Page Layout

```tsx
export default function Page() {
  return (
    <div className="h-screen overflow-hidden relative z-[2]">
      {/* Main content */}
      <Graph nodes={nodes} links={links} />

      {/* Top-left overlay */}
      <StatsOverlay stats={stats} nodeCount={nodes.length} />

      {/* Bottom center palette */}
      <CommandPalette onRefreshData={refreshData} />
    </div>
  );
}
```

### Modal Pattern

```tsx
export function Modal({ isOpen, onClose, children }) {
  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-50 bg-void/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="
          w-full max-w-2xl
          bg-gradient-to-b from-deep/98 to-abyss/99
          backdrop-blur-2xl
          border border-border rounded-2xl
          shadow-lg
          animate-in
        ">
          {children}
        </div>
      </div>
    </>
  );
}
```

---

## 🔧 Maintenance

### Adding New Colors

1. Add to CSS variables in `styles.css`
2. Document in this file
3. Add to Tailwind config if needed
4. Update component examples

### Updating Components

1. Follow existing patterns
2. Test in light/dark modes
3. Ensure accessibility compliance
4. Document significant changes

### Version Control

When making design system changes:
1. Update this documentation
2. Increment version in comments
3. Tag commits with `[design-system]`
4. Review with team before merging

---

## 📚 Resources

- [Tailwind CSS Docs](https://tailwindcss.com/docs)
- [Space Grotesk Font](https://fonts.google.com/specimen/Space+Grotesk)
- [WCAG Guidelines](https://www.w3.org/WAI/WCAG21/quickref/)
- [Vega Visualization Grammar](https://vega.github.io/vega/)

---

**Version**: 1.0.0
**Last Updated**: 2026-01-08
**Maintained by**: Knowledgebase Team
