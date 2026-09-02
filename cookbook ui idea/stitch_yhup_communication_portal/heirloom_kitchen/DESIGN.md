---
name: Heirloom Kitchen
colors:
  surface: '#fff8f5'
  surface-dim: '#f5d3c1'
  surface-bright: '#fff8f5'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#fff1ea'
  surface-container: '#ffeadf'
  surface-container-high: '#ffe3d4'
  surface-container-highest: '#fedcca'
  on-surface: '#29170d'
  on-surface-variant: '#574239'
  inverse-surface: '#402c20'
  inverse-on-surface: '#ffede5'
  outline: '#8a7267'
  outline-variant: '#dec0b4'
  surface-tint: '#a14100'
  primary: '#a14100'
  on-primary: '#ffffff'
  primary-container: '#ef7a3c'
  on-primary-container: '#5a2100'
  inverse-primary: '#ffb693'
  secondary: '#3f6833'
  on-secondary: '#ffffff'
  secondary-container: '#bdedaa'
  on-secondary-container: '#436d37'
  tertiary: '#00677d'
  on-tertiary: '#ffffff'
  tertiary-container: '#00a9ca'
  on-tertiary-container: '#003845'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#ffdbcc'
  primary-fixed-dim: '#ffb693'
  on-primary-fixed: '#351000'
  on-primary-fixed-variant: '#7a2f00'
  secondary-fixed: '#c0f0ad'
  secondary-fixed-dim: '#a4d393'
  on-secondary-fixed: '#022100'
  on-secondary-fixed-variant: '#28501e'
  tertiary-fixed: '#b2ebff'
  tertiary-fixed-dim: '#57d6f8'
  on-tertiary-fixed: '#001f27'
  on-tertiary-fixed-variant: '#004e5e'
  background: '#fff8f5'
  on-background: '#29170d'
  surface-variant: '#fedcca'
  turmeric-yellow: '#EAB308'
  espresso-brown: '#2D1B10'
  warm-cream: '#FDF8F2'
  hatch-placeholder: '#E5E1DB'
typography:
  display-h1:
    fontFamily: Plus Jakarta Sans
    fontSize: 24px
    fontWeight: '700'
    lineHeight: 32px
  display-h1-mobile:
    fontFamily: Plus Jakarta Sans
    fontSize: 22px
    fontWeight: '700'
    lineHeight: 28px
  headline-h2:
    fontFamily: Plus Jakarta Sans
    fontSize: 18px
    fontWeight: '600'
    lineHeight: 24px
  body-lg:
    fontFamily: Work Sans
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  body-md:
    fontFamily: Work Sans
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  meta-small:
    fontFamily: Work Sans
    fontSize: 12px
    fontWeight: '500'
    lineHeight: 16px
    letterSpacing: 0.02em
  label-mono:
    fontFamily: JetBrains Mono
    fontSize: 11px
    fontWeight: '500'
    lineHeight: 14px
    letterSpacing: 0.05em
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  grid-base: 4px
  gutter: 12px
  margin-mobile: 16px
  margin-desktop: 24px
  cell-padding: 16px
---

## Brand & Style

The design system embodies the warmth and organization of a well-loved home kitchen. It targets home cooks who balance the chaos of daily meal prep with a desire for culinary structure. The brand personality is **nurturing, efficient, and tactile**, evoking the emotional response of a slow-cooked meal shared with family.

The design style is a **Crisp Bento Minimalism**. It leverages the structural clarity of the "Bento Box" layout—organizing complex recipe data into discrete, functional cells—but rejects the overly rounded "pillowy" aesthetics of modern tech. Instead, it uses tighter radii (4-6px) to mimic the precision of professional kitchenware and tiles. The interface should feel like a clean countertop: everything has a place, and the tools are sharp.

## Colors

This design system moves away from clinical whites and greys in favor of a "Kitchen-Warm" palette. 

- **Primary (Orange):** Used for high-intent actions—specifically 'Add to Meal' CTAs, active navigation states, and primary buttons. It represents the heat of the stove and the energy of cooking.
- **Secondary (Green):** Reserved for semantic culinary cues, such as "Main" ingredient tags and dietary badges (Vegan/Vegetarian). It signifies fresh produce and successful completion.
- **Background (Warm Cream):** Replaces stark white to reduce eye strain during long cooking sessions and to give the app a paper-like, "recipe card" feel.
- **Text (Espresso Brown):** Used for all typography. It provides high contrast against the cream background while feeling softer and more organic than pure black.
- **Tertiary (Turmeric Yellow):** A specialized accent color reserved exclusively for time-sensitive elements (the timer tool) and critical system alerts.

## Typography

The typography strategy balances modern legibility with a slight technical edge. 

- **Plus Jakarta Sans** provides a welcoming, rounded feel for major headings, keeping the app approachable. 
- **Work Sans** is used for all body copy and recipe details due to its exceptional readability and neutral character, essential for complex ingredient lists. 
- **JetBrains Mono** is utilized for metadata and labels (like cook times and portions), providing a "digital scale" or "receipt" aesthetic that differentiates data from narrative text.

On mobile devices, display headings scale down slightly to ensure bento cells remain balanced and text-heavy recipe blocks don't become overly long.

## Layout & Spacing

The layout is a **Fixed Bento Grid** model. Content is contained within rectangular "cells" that follow a strict 4px base unit. 

- **Mobile:** Single column flow where bento cells stack vertically. Horizontal scrolling is used for filter chips and recipe tabs to maximize vertical real estate.
- **Desktop/Tablet:** A 12-column grid allowing for complex "3-panel" layouts. The Meal Planner utilizes these panels to show the Daily View (Left), Calendar (Center), and Recipe Bank (Right) simultaneously.
- **The Bento Logic:** Cells should span 1, 2, or 3 columns depending on the information density (e.g., a Recipe Highlight occupies a larger span than a specific Meal Slot). 
- **Gutters:** A consistent 12px gutter maintains the "tight" look of the design system without making the content feel cramped.

## Elevation & Depth

This design system uses **Bold Borders** and **Tonal Layers** rather than traditional shadows. To maintain the crisp, flat "Kitchen Tile" aesthetic:

- **Borders:** All cells and inputs use a 1px hairline border in Espresso Brown (at 15-20% opacity) or a tonal variant of the cream background.
- **Tonal Depth:** Depth is achieved by placing Warm Cream cells on top of slightly darker/desaturated surface containers. 
- **Zero Shadows:** Avoid ambient shadows. The hierarchy is established through contrast and the physical containment of the bento grid. 
- **Placeholders:** Use a 45-degree diagonal hatch pattern (`hatch-placeholder`) for empty image states, reinforcing the technical/architectural feel of the grid.

## Shapes

The shape language is **Crisp and Functional**. Following the "Soft" setting (0.25rem / 4px base), all bento cells, buttons, and input fields must use a consistent 4-6px radius. This intentionally breaks from the "Pill-shaped" trend of modern mobile apps to create a more professional, "instrument-like" feel appropriate for kitchen tools.

- **Primary Buttons:** 4px radius.
- **Chips & Tags:** 4px radius.
- **Bento Cells:** 6px radius for larger containers to provide a subtle visual softening at scale.

## Components

- **Bento Cells:** The primary container. All cards (Recipe, Meal, Grocery Category) must utilize the 6px radius and 1px border.
- **Buttons:** 
  - *Primary:* Orange (#EF7A3C) background with White text. 
  - *Add-to-Meal:* Floating Action Button (FAB) or cell-anchored icon using the Primary Orange.
- **Chips:** 
  - *Filter Chips:* Warm Cream background with Espresso Brown text and border. Active state: Orange background.
  - *Ingredient Tags:* Use Green (#4F7942) for "Main" and a neutral Espresso border for "Swap".
- **Input Fields (Notion-Style):** In "Read Mode," inputs are invisible (plain text). In "Edit Mode," they gain a subtle border and 4px radius, but maintain the same typography and positioning to prevent layout shift.
- **Timer Pill:** A floating turmeric yellow (#EAB308) pill with Espresso text that docks to the bottom of the screen when a timer is active.
- **Checkboxes/Radios:** Use the Secondary Green (#4F7942) for checked/active states.
- **Progress Indicators:** Use a thin, Turmeric Yellow bar for active cooking timers or step progress.